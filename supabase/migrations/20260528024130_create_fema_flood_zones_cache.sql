-- Issue #172 — Shared cache of FEMA NFHL point-in-polygon responses, keyed by
-- parcel ID (when known) or rounded lat/lon (~1m precision) as a fallback.
--
-- The FEMA Flood Zones habitat module queries FEMA's National Flood Hazard
-- Layer ArcGIS service at the user's home coordinates. FEMA's public service
-- has known availability quirks — a transient 5xx or connection reset on
-- the first attempt was producing permanent 'failed' findings in onboarding.
-- This cache (plus the retry loop in fetch.ts and the stale-fallback +
-- unreachable-finding paths in index.ts) makes the upstream a soft
-- dependency: once any house on a polygon has fetched successfully, every
-- subsequent house on the same point inherits the result for the TTL, and
-- a FEMA outage degrades to a stale-but-labeled finding rather than a hard
-- failure.
--
-- The 180-day TTL is enforced in application code
-- (lib/habitat/modules/fema-flood-zones/cache.ts) rather than in SQL, the
-- same discipline the Superfund 7-day cache and the Water Quality
-- Awareness 90-day cache follow. Flood zone polygons are vastly more
-- stable than either of those (NFHL releases happen ~monthly but the
-- mapped polygon for a given property essentially never moves outside
-- the rare LOMA/LOMR cases), which justifies the longer window.
--
-- raw_payload preserves the full NFHL response (the features array,
-- pre-normalization) so future column additions or normalization changes
-- can be backfilled from existing rows without re-fetching from FEMA.
-- The parsed `zones` column carries the normalized polygons the module
-- actually consumes today.
--
-- Per-house findings continue to live on hearth.habitat_findings — this
-- cache only shares the upstream FEMA pull, not the per-house finding.

create table hearth.fema_flood_zones_cache (
  -- Composite natural key. The wrapper in cache.ts derives it from the
  -- HouseContext: 'parcel:<parcelId>' when the house has a parcel ID
  -- (Michigan addresses via BS&A), 'coord:<lat>,<lon>' rounded to
  -- 5 decimal places (~1m precision) otherwise. The two key spaces are
  -- distinct prefixes so a future migration could fold coordinate rows
  -- into parcel rows without primary-key collisions.
  cache_key text primary key,

  -- The exact query coordinates we sent to FEMA. Preserved for
  -- traceability so a curious developer can reproduce the fetch by
  -- clicking through to source_url, and so activity logs can reference
  -- the actual point queried even on a parcel-keyed hit.
  queried_latitude double precision not null,
  queried_longitude double precision not null,

  -- Which key strategy produced cache_key. Narration in cache.ts
  -- reads this to say either "I had your parcel's flood zone in our
  -- shared cache" or "I had a flood zone for these coordinates".
  key_strategy text not null
    check (key_strategy in ('parcel', 'coordinate')),

  -- Normalized NormalizedFloodZone[] (see fetch.ts). An empty array is
  -- the no-NFHL-coverage case and is a legitimate cache value — we
  -- still want to skip the FEMA call on subsequent runs when we
  -- already know the address is outside NFHL.
  zones jsonb not null,

  -- The verbatim FEMA features[] from the NFHL response. Future
  -- column additions or normalization tweaks can backfill from this
  -- without re-fetching from FEMA.
  raw_payload jsonb not null,

  -- The exact NFHL query URL hit. Useful in activity logs and for
  -- reproducing a cached result by hand.
  source_url text not null,

  -- When the row was first inserted. Never updated. fetched_at and
  -- refreshed_at start identical; refreshed_at advances on every
  -- re-fetch.
  fetched_at timestamptz not null default now(),

  -- When the row was last (re)fetched from FEMA. The 180-day
  -- application-side window compares now() - refreshed_at to decide
  -- whether to skip the FEMA call. The stale-fallback path in
  -- index.ts also reads refreshed_at so it can name the date in
  -- the activity log ("…showing your most recent designation
  -- from [date].").
  refreshed_at timestamptz not null default now()
);

comment on table hearth.fema_flood_zones_cache is
  'Shared FEMA NFHL response cache. Keyed by parcel ID when present, rounded lat/lon (5dp) otherwise. 180-day TTL enforced in app code. Issue #172.';

comment on column hearth.fema_flood_zones_cache.cache_key is
  'Composite key: ''parcel:<parcelId>'' or ''coord:<lat>,<lon>'' (5dp). Distinct prefixes by design — a future migration could fold coordinate rows into parcel rows without primary-key collisions.';

comment on column hearth.fema_flood_zones_cache.zones is
  'Normalized NormalizedFloodZone[] (see lib/habitat/modules/fema-flood-zones/fetch.ts). Empty array is a legitimate cache value — the no-NFHL-coverage case.';

comment on column hearth.fema_flood_zones_cache.raw_payload is
  'Verbatim FEMA features[] from the NFHL response. Preserved so future column additions can be backfilled without re-fetching from FEMA.';

-- Row-level security: globally readable to authenticated users.
-- These are public flood-zone records — no per-user scoping needed.
-- Writes happen exclusively through the service-role workflow path
-- (createServiceClient bypasses RLS), so we deliberately do NOT grant
-- insert/update/delete to end users. Mirrors the policy on
-- hearth.water_systems.
alter table hearth.fema_flood_zones_cache enable row level security;

create policy fema_flood_zones_cache_select_all
  on hearth.fema_flood_zones_cache
  for select
  to authenticated
  using (true);
