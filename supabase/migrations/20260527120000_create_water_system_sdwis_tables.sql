-- WQA-2 (issue #169) — SDWIS compliance + lead/copper sample shared caches.
--
-- Layered on top of WQA-1's hearth.water_systems (issue #166): both new
-- collection tables FK back to water_systems(pwsid) so a utility row's
-- absence is the architectural prerequisite for these. SDWIS data is
-- utility-scoped — every Hearth house on Kalamazoo PWS shares the same
-- violations[] and the same lead/copper sample periods — so we follow
-- the same shared-cache discipline as water_systems: service-role-only
-- writes, globally readable to authenticated users, and TTL enforced
-- in application code (currently 30 days at the per-(PWSID, dataset)
-- level in caches/violations-cache.ts and caches/lcr-cache.ts).
--
-- Three tables ship together because they're one logical unit — the
-- collection tables hold the actual rows EPA returned, and
-- water_system_data_fetches is the freshness-bookkeeping row the cache
-- layer reads to decide hit/miss/expired without scanning the
-- collection. Splitting bookkeeping from the data lets the cache
-- handle the "EPA returned zero rows" case cleanly (we record the
-- fetch happened even though no row landed in violations / samples).
--
-- raw_payload preserves every column the Envirofacts response carried
-- so future parsed-column additions can be backfilled without
-- re-fetching from EPA. Same pattern as water_systems.raw_payload.

-- =========================================================================
-- water_system_violations
-- =========================================================================
-- One row per EPA SDWIS VIOLATION row, keyed by (PWSID, violation_id).
-- A given utility may have hundreds of rows here (violations since
-- 1993); the cache layer reads via a single SELECT on pwsid which the
-- composite primary-key index covers.

create table hearth.water_system_violations (
  pwsid text not null
    references hearth.water_systems(pwsid) on delete cascade,
  violation_id text not null,

  -- Parsed columns the application reads directly. Everything below
  -- is also preserved in raw_payload — these mirror the fields the
  -- compliance summarizer (compliance.ts) actually consumes.
  violation_code text,
  violation_category_code text,
  -- 'Y' = health-based (MCL exceedance, treatment technique failure),
  -- 'N' = monitoring or reporting violation. Compliance decision
  -- weighs health-based vs. non-health-based differently.
  is_health_based_ind text,
  contaminant_code text,
  compl_per_begin_date timestamptz,
  compl_per_end_date timestamptz,
  viol_first_reported_date timestamptz,
  -- 'Return to Compliance' date. Null while the violation is still
  -- open (active); set once the system has met the resolution
  -- conditions. Compliance summarizer treats null OR future rtc_date
  -- as 'active'.
  rtc_date timestamptz,
  is_major_viol_ind text,
  -- Measured contaminant value (when applicable). Numeric so the
  -- summarizer can compare against federal_mcl without parsing.
  viol_measure numeric,
  unit_of_measure text,
  -- Federal MCL at the time of violation. Kept as text because EPA
  -- occasionally reports it with a unit suffix or range expression
  -- that doesn't parse to numeric cleanly.
  federal_mcl text,

  -- Cache bookkeeping. fetched_at is row-creation time; refreshed_at
  -- moves on every upsert (the cache layer always rewrites the row
  -- to keep raw_payload in sync with EPA's latest response).
  fetched_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  source_url text not null,

  -- Verbatim Envirofacts row. Future schema additions can backfill
  -- from existing rows by reading this column.
  raw_payload jsonb not null,

  primary key (pwsid, violation_id)
);

comment on table hearth.water_system_violations is
  'EPA SDWIS VIOLATION rows, keyed by (PWSID, violation_id). Shared cache across all houses on a system. TTL enforced in app code at the per-(PWSID, dataset) level via hearth.water_system_data_fetches. Issue #169.';

comment on column hearth.water_system_violations.is_health_based_ind is
  'EPA Y/N — Y for health-based MCL violations and treatment-technique failures, N for monitoring/reporting violations. Compliance decision treats health-based as the heavier signal.';

comment on column hearth.water_system_violations.rtc_date is
  'Return-to-Compliance date. Null while the violation is still open; the compliance summarizer treats null OR a future value as ''active''.';

comment on column hearth.water_system_violations.raw_payload is
  'Verbatim Envirofacts row. Future column additions can be backfilled from this without re-fetching from EPA.';

-- =========================================================================
-- water_system_lcr_samples
-- =========================================================================
-- One row per EPA SDWIS LCR_SAMPLE_RESULT, keyed by (PWSID, sample_id).
-- These are system-level 90th-percentile rollups for a sampling
-- period, not individual home samples. Lead and copper each get their
-- own row per period.

create table hearth.water_system_lcr_samples (
  pwsid text not null
    references hearth.water_systems(pwsid) on delete cascade,
  sample_id text not null,

  -- '5000' = lead, '1022' = copper. Stored as text for consistency
  -- with EPA's other contaminant_code columns (some carry leading
  -- zeros that integer storage would strip).
  contaminant_code text,
  sampling_start_date timestamptz,
  sampling_end_date timestamptz,
  -- The 90th-percentile measure for the period.
  sample_measure numeric,
  unit_of_measure text,
  -- '<' = below the detection limit, '=' = measured value, '>' = above
  -- the quantitation limit. Drives summary copy ("below detection"
  -- reads very differently from "0.014 mg/L").
  result_sign_code text,

  fetched_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  source_url text not null,

  raw_payload jsonb not null,

  primary key (pwsid, sample_id)
);

comment on table hearth.water_system_lcr_samples is
  'EPA SDWIS LCR_SAMPLE_RESULT rows, keyed by (PWSID, sample_id). Shared cache across all houses on a system. TTL enforced in app code at the per-(PWSID, dataset) level via hearth.water_system_data_fetches. Issue #169.';

comment on column hearth.water_system_lcr_samples.contaminant_code is
  'EPA contaminant code — 5000 = lead, 1022 = copper. Other codes can appear in the raw payload but the summarizer reads only lead and copper.';

comment on column hearth.water_system_lcr_samples.result_sign_code is
  'EPA sign code — ''<'' below detection, ''='' measured, ''>'' above quantitation. The summarizer surfaces ''below detection'' copy when sign is ''<''.';

-- =========================================================================
-- water_system_data_fetches
-- =========================================================================
-- Per-(PWSID, dataset) freshness bookkeeping. The cache layer reads
-- this to decide hit/miss/expired without scanning the collection
-- tables. Separate from the collection tables so the "EPA returned
-- zero rows" case (a system with no violations on file is a positive
-- signal, not a missing fetch) survives cleanly — the data_fetches
-- row exists; the violations table just has no rows for that PWSID.
--
-- Independent rows per dataset because violations and LCR samples
-- have independent fetch outcomes — one can succeed while the other
-- fails, and we want to retry the failed dataset on the next check
-- without invalidating the succeeded one. The dataset column is
-- CHECK-constrained to the two values WQA-2 cares about; WQA-3 may
-- add 'ccr_extraction' or similar without rewriting the constraint
-- via alter table.

create table hearth.water_system_data_fetches (
  pwsid text not null
    references hearth.water_systems(pwsid) on delete cascade,
  dataset text not null
    check (dataset in ('violations', 'lcr_samples')),
  -- When the fetch completed. Compared against now() + the
  -- application-side TTL window (currently 30 days for both
  -- violations and lcr_samples) to decide hit/miss/expired.
  fetched_at timestamptz not null default now(),
  -- Row count returned by EPA — useful for diagnostics and for
  -- distinguishing 'fetched and found zero' from 'never fetched'.
  row_count integer not null,
  source_url text not null,
  primary key (pwsid, dataset)
);

comment on table hearth.water_system_data_fetches is
  'Per-(PWSID, dataset) fetch bookkeeping for SDWIS datasets. The cache layer reads this to decide hit/miss/expired without scanning the collection tables. Separate from the collection tables so the "fetched but EPA returned zero rows" case stays distinguishable from "never fetched". Issue #169.';

-- =========================================================================
-- RLS
-- =========================================================================
-- Globally readable to authenticated users (these are public EPA
-- compliance records, not per-house data). No write policies — every
-- write goes through the service-role workflow path, same as
-- water_systems. A user accidentally trying to INSERT here will hit
-- RLS and fail loudly rather than corrupting the shared cache.

alter table hearth.water_system_violations enable row level security;
create policy water_system_violations_select_all
  on hearth.water_system_violations
  for select
  to authenticated
  using (true);

alter table hearth.water_system_lcr_samples enable row level security;
create policy water_system_lcr_samples_select_all
  on hearth.water_system_lcr_samples
  for select
  to authenticated
  using (true);

alter table hearth.water_system_data_fetches enable row level security;
create policy water_system_data_fetches_select_all
  on hearth.water_system_data_fetches
  for select
  to authenticated
  using (true);
