-- WQA-1 (issue #166) — Shared cache of EPA Envirofacts WATER_SYSTEM records,
-- keyed by PWSID and reused across every house served by that utility.
--
-- The Water Quality Awareness module resolves a house's address to a PWSID
-- via the EPA Community Water System Service Areas ArcGIS layer, then
-- fetches the WATER_SYSTEM inventory record from Envirofacts. The fetched
-- record is identical for every house on that system, so storing it once
-- per PWSID — rather than per house — is the architectural baseline for
-- the rest of the module (the CCR cache in WQA-3 follows the same pattern
-- keyed on (PWSID, year)).
--
-- The 90-day "shared cache" property is enforced in application code
-- (lib/habitat/modules/water-quality-awareness/cache.ts) rather than in
-- the database, mirroring how the Superfund module enforces its 7-day TTL
-- on hearth.epa_envirofacts_state_cache. Application code is the single
-- place to tune the window without touching schema.
--
-- raw_payload preserves the full Envirofacts JSON response so future
-- column additions can be backfilled from existing rows without re-
-- fetching from EPA. The parsed columns below are the subset the module
-- actually reads today; everything else stays in raw_payload.
--
-- Per-house WQA findings (branch decision, system card payload, etc.)
-- continue to live in hearth.habitat_findings, the unified per-module-per-
-- house table that every habitat module writes to. Issue #166 originally
-- proposed a separate hearth.water_system_findings table; we decided
-- against it during implementation to keep the habitat-module persistence
-- pattern consistent.

create table hearth.water_systems (
  -- EPA Public Water System ID. The natural primary key — one row per
  -- utility, regardless of how many Hearth houses it serves. The PWSID
  -- format is a 2-letter state code plus a 7-digit number (e.g.
  -- "MI0003520"); enforced loosely as non-empty here so EPA can revise
  -- their scheme without a schema migration.
  pwsid text primary key
    check (length(pwsid) >= 5),

  -- Utility-facing name as EPA records it.
  pws_name text not null,

  -- Two-letter state code of the primacy agency. Usually matches the
  -- leading two characters of the PWSID.
  primacy_agency_code text,

  -- EPA region (01-10).
  epa_region text,

  -- 'A' = active, 'I' = inactive, etc. The module's branch logic
  -- treats anything other than 'A' as the "stale data" branch.
  pws_activity_code text not null,

  -- When EPA marked the system inactive (null while active).
  pws_deactivation_date timestamptz,

  -- 'CWS' = Community Water System (the only type for which a CCR is
  -- federally required); 'NTNCWS' and 'TNCWS' are non-community
  -- systems serving schools, campgrounds, etc. and route into the
  -- "non-community" branch.
  pws_type_code text not null,

  -- Source water indicator: 'GW' (groundwater), 'SW' (surface),
  -- 'GU' (ground under influence of surface), etc.
  gw_sw_code text,

  -- Often duplicates gw_sw_code in practice; persisted because EPA
  -- distinguishes "primary_source" from the broader gw/sw flag.
  primary_source_code text,

  -- Owner type: 'L' = Local government, 'P' = Private, etc.
  owner_type_code text,

  -- Population served and physical service connections.
  population_served_count integer,
  service_connections_count integer,

  -- 'Y' / 'N' flag for schools and daycares, which face stricter
  -- monitoring rules. Persisted for completeness; not yet used by the
  -- module.
  is_school_or_daycare_ind text,

  -- 'Y' indicates EPA has accepted the system's most recent inventory
  -- submission. Useful as a data-freshness signal in later phases.
  submission_status_code text,

  -- Administrator / point of contact at the utility. Used by the
  -- "find your CCR" surface so the prompt names the real person on
  -- file rather than generic instructions.
  org_name text,
  admin_name text,
  email_addr text,
  phone_number text,

  -- Mailing address fields for the utility.
  address_line1 text,
  address_line2 text,
  city_name text,
  zip_code text,
  state_code text,

  -- 'Y' / 'N' — does the utility participate in EPA's Source Water
  -- Protection program? The system card surfaces this as a positive
  -- signal when populated.
  source_water_protection_code text,
  source_protection_begin_date timestamptz,

  -- When the row was first inserted from an Envirofacts response.
  -- Never updated after insert. fetched_at and refreshed_at start
  -- identical; refreshed_at advances on every re-fetch.
  fetched_at timestamptz not null default now(),

  -- When the row was last (re)fetched from Envirofacts. The 90-day
  -- application-side window compares now() - refreshed_at to decide
  -- whether to skip the EPA call.
  refreshed_at timestamptz not null default now(),

  -- The exact URL the module queried, so a curious developer or
  -- reviewer can reproduce the fetch by clicking through.
  source_url text not null,

  -- Verbatim JSON response from Envirofacts. Future schema additions
  -- (e.g. distribution-system metadata that the module starts
  -- reading later) can be backfilled from existing rows by reading
  -- raw_payload rather than re-fetching from EPA.
  raw_payload jsonb not null
);

comment on table hearth.water_systems is
  'EPA Envirofacts WATER_SYSTEM records, keyed by PWSID. Shared across all houses on a system. Refreshed at most every 90 days (TTL enforced in app code). Issue #166.';

comment on column hearth.water_systems.pwsid is
  'EPA Public Water System ID — natural primary key. One row per utility, shared across all houses.';

comment on column hearth.water_systems.raw_payload is
  'Verbatim Envirofacts JSON response. Persisted so future column additions can be backfilled without re-fetching from EPA.';

-- Row-level security: globally readable to authenticated users.
-- These are public utility records — no per-user scoping needed. Writes
-- happen exclusively through the service-role workflow path
-- (createServiceClient bypasses RLS), so we deliberately do NOT grant
-- insert/update/delete to end users. A user accidentally trying to
-- INSERT here will hit RLS and fail loudly rather than corrupting the
-- shared cache.
alter table hearth.water_systems enable row level security;

create policy water_systems_select_all
  on hearth.water_systems
  for select
  to authenticated
  using (true);
