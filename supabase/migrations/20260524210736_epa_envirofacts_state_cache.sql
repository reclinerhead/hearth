-- Issue #160 — Persistent per-state cache for the EPA Envirofacts SEMS
-- response that the Superfund habitat module fetches on every check.
--
-- EPA's Envirofacts REST endpoint is consistently slow (~20s for a
-- typical state response) and the per-state response changes slowly
-- enough that a 7-day-old cached value is functionally identical to a
-- fresh fetch. With Hearth about to beta-test against multiple users in
-- the same state (Kalamazoo, MI + nearby Portage), uncached fetches
-- mean every neighbor pays EPA's latency cost independently. This
-- table makes the first hit warm the cache for everyone in that state.
--
-- TTL is enforced in application code (lib/habitat/modules/epa-
-- superfund-proximity/fetch.ts) rather than in the database — keeps
-- the cache logic in one place and lets us tune the window without
-- touching schema. Today the constant is 7 days.
--
-- The cached payload is the merged NplSite[] array (post-
-- mergeContaminants), so cache hits skip both the EPA HTTP call AND
-- the in-memory merge.
--
-- Service-role writes only. No RLS — this is pure server state, not
-- per-user data. The workflow step that populates it uses
-- createServiceClient() which bypasses RLS anyway, and there is no
-- legitimate client-side read path for this table (the module
-- consumes the cache server-side and returns the merged array to
-- the rest of the check() flow).

create table hearth.epa_envirofacts_state_cache (
  -- USPS 2-letter state code, uppercase. Primary key — one row per
  -- state. The application normalizes the state to uppercase before
  -- looking up so the PK constraint catches a casing bug rather than
  -- spawning duplicate rows.
  state_code text primary key
    check (state_code = upper(state_code) and length(state_code) = 2),

  -- Verbatim merged NplSite[] array (post-mergeContaminants in
  -- fetch.ts). jsonb so we get indexable storage and so future
  -- migrations can introspect / migrate the shape if EPA's schema
  -- changes upstream.
  response_json jsonb not null,

  -- When the upstream EPA fetch completed. Application-side TTL
  -- compares this to now() with a 7-day window. Defaults to now()
  -- so simple INSERT statements work without setting the column.
  fetched_at timestamptz not null default now()
);

comment on table hearth.epa_envirofacts_state_cache is
  'Per-state cache of the EPA Envirofacts SEMS response used by the Superfund habitat module. TTL enforced in app code (currently 7 days). Issue #160.';

comment on column hearth.epa_envirofacts_state_cache.state_code is
  'USPS 2-letter state code, uppercase. One row per state.';

comment on column hearth.epa_envirofacts_state_cache.response_json is
  'Merged NplSite[] array (post-mergeContaminants). Cache hits skip both the EPA HTTP call and the in-memory merge.';

comment on column hearth.epa_envirofacts_state_cache.fetched_at is
  'When the upstream EPA fetch completed. App compares to now() with the TTL window to decide hit vs. expired-miss.';
