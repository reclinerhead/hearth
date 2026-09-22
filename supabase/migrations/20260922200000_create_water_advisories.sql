-- Water advisory watcher (issue #331).
--
-- Four tables that let Hearth watch a municipality's boil-water-advisory
-- page and notify an admin-managed email list when a district-wide
-- advisory is issued, updated, or lifted. Advisories are PWSID-scoped —
-- an advisory affects everyone on the utility, not one house — so they
-- follow the shared-cache posture of water_systems / water_system_*:
-- service-role writes, globally readable to authenticated users, no
-- anon policy.
--
--   water_advisory_sources        — one row per watched city (PWSID):
--                                   which adapter reads it, its config,
--                                   and the watcher's health bookkeeping
--   water_advisories              — one row per advisory URL the watcher
--                                   has ever seen for that source
--   water_advisory_subscribers    — the admin-managed email list
--   water_advisory_notifications  — the idempotency log: one row per
--                                   (advisory, subscriber, channel, event,
--                                   content_hash) so a retried run can
--                                   never double-send
--
-- The subscriber list and the notification log are admin-only from a
-- session: the policies gate on hearth.is_admin(), a SECURITY DEFINER
-- helper that reads public.profiles.is_admin for auth.uid(). The cron
-- and the tokenized confirm/unsubscribe routes use the service-role
-- client (no session), which bypasses RLS.

-- =========================================================================
-- hearth.is_admin()  — reusable RLS predicate
-- =========================================================================
-- SECURITY DEFINER so the check doesn't depend on the caller's own
-- public.profiles policy (which already allows reading one's own row,
-- but a definer function keeps the predicate cheap and stable if that
-- policy ever changes). search_path pinned per the Supabase guidance
-- for definer functions.

create or replace function hearth.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function hearth.is_admin() from public;
grant execute on function hearth.is_admin() to authenticated, service_role;

comment on function hearth.is_admin() is
  'True when the calling session belongs to a public.profiles row with is_admin = true. Used as the RLS predicate for admin-only tables. Issue #331.';

-- =========================================================================
-- hearth.water_advisory_sources
-- =========================================================================
-- "Cities we have on file" for the admin page. `kind` selects the parsing
-- adapter in lib/water-advisories/adapters/; `config` is adapter-specific
-- (for opencities_list: { "list_url": "...", "system_wide_phrases": [...] }).
-- The CHECK on `kind` is widened when a new adapter lands (issue #337
-- adds 'rss').

create table hearth.water_advisory_sources (
  pwsid text primary key
    references hearth.water_systems(pwsid) on delete cascade,

  kind text not null
    check (kind in ('opencities_list')),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,

  -- Watcher health. consecutive_failures drives the "watcher is blind"
  -- alarm email; failure_alerted_at makes that alarm fire once per
  -- outage (and a recovery note once when it clears).
  last_run_at timestamptz,
  last_ok_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  failure_alerted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table hearth.water_advisory_sources is
  'One row per municipality the water advisory watcher polls, keyed by PWSID. kind + config select and configure the parsing adapter. Service-role writes; authenticated SELECT. Issue #331.';

-- =========================================================================
-- hearth.water_advisories
-- =========================================================================
-- One row per advisory URL. Lifted notices are usually NEW entries on
-- the city site (a separate URL), so they land as their own rows with
-- status 'lifted'; an in-place edit of an existing entry shows up as a
-- content_hash change (an 'updated' event) or a status flip.

create table hearth.water_advisories (
  id uuid primary key default gen_random_uuid(),

  pwsid text not null
    references hearth.water_advisory_sources(pwsid) on delete cascade,

  source_url text not null unique,
  title text not null,
  summary text not null default '',

  status text not null
    check (status in ('active', 'scheduled', 'lifted', 'unknown')),
  scope text not null
    check (scope in ('system_wide', 'localized', 'unknown')),

  -- The city's own "Published on" date when the detail page prints one.
  published_on date,

  -- True when the advisory's URL was carried on the site-wide emergency
  -- banner at the last run — an independent "this is big" signal.
  on_emergency_banner boolean not null default false,

  -- SHA-256 over the normalized title + summary; drives 'updated' events.
  content_hash text not null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),

  -- Parsed fields exactly as captured on the last run, for debugging
  -- parser drift without re-fetching.
  raw jsonb not null default '{}'::jsonb
);

create index water_advisories_pwsid_first_seen_desc
  on hearth.water_advisories (pwsid, first_seen_at desc);

comment on table hearth.water_advisories is
  'Every advisory the watcher has seen, one row per source URL. Status/scope are classified by lib/water-advisories/classify.ts. Service-role writes; authenticated SELECT. Issue #331.';

-- =========================================================================
-- hearth.water_advisory_subscribers
-- =========================================================================
-- The admin-managed email list. Double opt-in: rows start 'pending' and
-- only become 'confirmed' when the tokenized confirmation link is hit.
-- Address fields are stored now (the admin enters them) and used by a
-- later street-matching increment; notification scope today is
-- district-wide only.

create table hearth.water_advisory_subscribers (
  id uuid primary key default gen_random_uuid(),

  pwsid text not null
    references hearth.water_advisory_sources(pwsid) on delete cascade,

  name text not null,
  email text not null,

  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'unsubscribed')),

  -- Capability tokens for the unauthenticated confirm / unsubscribe
  -- routes. 192 bits of randomness, base64url. Never rendered in the app.
  confirm_token text not null unique,
  unsubscribe_token text not null unique,

  created_by uuid
    references auth.users(id) on delete set null,
  -- Display label for the "{who} added you to this list" line in every
  -- email. Captured at insert (the admin's OAuth display name) because
  -- public.profiles carries no name and the cron has no session to ask.
  added_by_label text not null default 'a Hearth admin',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);

create unique index water_advisory_subscribers_pwsid_email_key
  on hearth.water_advisory_subscribers (pwsid, lower(email));

comment on table hearth.water_advisory_subscribers is
  'Admin-managed email list per watched city. Double opt-in via confirm_token; one-click unsubscribe via unsubscribe_token. Admin-only from a session (hearth.is_admin()); service-role for the cron and token routes. Issue #331.';

-- =========================================================================
-- hearth.water_advisory_notifications
-- =========================================================================
-- Idempotency log. The watcher inserts a row BEFORE calling the email
-- provider and updates it with the result afterwards; the unique key
-- means a crash mid-batch and a retried run cannot send twice.

create table hearth.water_advisory_notifications (
  id uuid primary key default gen_random_uuid(),

  advisory_id uuid not null
    references hearth.water_advisories(id) on delete cascade,
  subscriber_id uuid not null
    references hearth.water_advisory_subscribers(id) on delete cascade,

  channel text not null
    check (channel in ('email', 'push')),
  event text not null
    check (event in ('issued', 'updated', 'lifted')),
  content_hash text not null,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  error text,

  unique (advisory_id, subscriber_id, channel, event, content_hash)
);

comment on table hearth.water_advisory_notifications is
  'One row per attempted notification. The unique key is the idempotency guard: row first, then send, then record the result. Issue #331.';

-- =========================================================================
-- RLS
-- =========================================================================

-- Shared-cache posture: globally readable to signed-in users, no anon
-- policy, writes only via service-role (the cron).
alter table hearth.water_advisory_sources enable row level security;
create policy water_advisory_sources_select_all
  on hearth.water_advisory_sources
  for select
  to authenticated
  using (true);

alter table hearth.water_advisories enable row level security;
create policy water_advisories_select_all
  on hearth.water_advisories
  for select
  to authenticated
  using (true);

-- Admin-only tables. The schema's default privileges grant
-- `authenticated` ALL on new tables; these policies are what actually
-- restrict rows to admins.
alter table hearth.water_advisory_subscribers enable row level security;
create policy water_advisory_subscribers_admin_select
  on hearth.water_advisory_subscribers
  for select to authenticated
  using (hearth.is_admin());
create policy water_advisory_subscribers_admin_insert
  on hearth.water_advisory_subscribers
  for insert to authenticated
  with check (hearth.is_admin());
create policy water_advisory_subscribers_admin_update
  on hearth.water_advisory_subscribers
  for update to authenticated
  using (hearth.is_admin())
  with check (hearth.is_admin());
create policy water_advisory_subscribers_admin_delete
  on hearth.water_advisory_subscribers
  for delete to authenticated
  using (hearth.is_admin());

alter table hearth.water_advisory_notifications enable row level security;
create policy water_advisory_notifications_admin_select
  on hearth.water_advisory_notifications
  for select to authenticated
  using (hearth.is_admin());

-- The realtime grant migration handed `anon` table-level SELECT by
-- default; keep anon's grants no wider than its (nonexistent) policies.
revoke select on hearth.water_advisory_sources from anon;
revoke select on hearth.water_advisories from anon;
revoke select on hearth.water_advisory_subscribers from anon;
revoke select on hearth.water_advisory_notifications from anon;

-- =========================================================================
-- Seed: City of Kalamazoo
-- =========================================================================
-- Granicus OpenCities list page. "City of Kalamazoo water customers" is
-- the city's own district-wide phrasing; the generic phrase list lives
-- in lib/water-advisories/classify.ts.

insert into hearth.water_advisory_sources (pwsid, kind, config)
values (
  'MI0003520',
  'opencities_list',
  jsonb_build_object(
    'list_url',
    'https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories',
    'system_wide_phrases',
    jsonb_build_array('City of Kalamazoo water customers')
  )
);
