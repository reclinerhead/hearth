-- Extend public.profiles with Hearth user state. The profiles table is
-- auto-populated by handle_new_user() on signup; this migration adds
-- the columns and backfills defaults for any existing rows.
--
-- Hearth runs on its own dedicated Supabase project, so public.profiles
-- is owned by this app — Hearth-specific columns belong here rather than
-- in a duplicate table inside the hearth schema. (Older migration
-- comments referring to a shared Echoes project predate the project
-- split and no longer reflect reality; see CLAUDE.md.)
--
-- plan_tier:        billing concept, gates premium features
-- role:             user kind (homeowner, contractor, admin) — affects UX surfaces
-- is_admin:         god-mode bypass for capability gates, distinct from plan_tier
-- active_house_id:  which house the user is currently viewing across devices

alter table public.profiles
  add column if not exists plan_tier text not null default 'free'
    check (plan_tier in ('free', 'premium')),
  add column if not exists role text not null default 'homeowner'
    check (role in ('homeowner', 'contractor', 'admin')),
  add column if not exists is_admin boolean not null default false,
  add column if not exists active_house_id uuid
    references hearth.houses(id) on delete set null;

-- Index for the active-house lookup in the (app) layout. Profile reads
-- always go by id (auth.uid()), so this is just a covering index for
-- the foreign-key check on delete cascade.
create index if not exists profiles_active_house_id_idx
  on public.profiles (active_house_id);

-- RLS: users can read and update their own profile row only.
-- handle_new_user() runs as security definer so inserts are unaffected.
alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Defense in depth: prevent users from escalating their own role
    -- or plan tier client-side. Admin/billing writes must go through
    -- service-role.
    and plan_tier = (select plan_tier from public.profiles where id = auth.uid())
    and role = (select role from public.profiles where id = auth.uid())
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
  );
