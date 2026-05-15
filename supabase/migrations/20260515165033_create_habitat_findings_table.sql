-- Habitat findings: one row per habitat module per house, representing the
-- current state of what that module has discovered about the house's
-- surroundings.
--
-- A "habitat module" is a self-contained piece of code (see
-- lib/habitat/modules/) that knows how to query one public-data source —
-- EPA radon zones, FEMA flood zones, EPA Superfund proximity, Walk Score,
-- etc. The orchestrator workflow (workflows/habitat.ts) iterates over the
-- registered modules, asks each whether it's applicable to the house,
-- runs check() on the applicable ones, and upserts the result into this
-- table keyed by (house_id, module_key).
--
-- Findings can be positive, neutral, or negative — severity carries that
-- meaning. A high Walk Score is a 'good' finding; a Zone 1 radon county is
-- 'high'; an active Superfund site half a mile away may be 'critical'. The
-- dashboard sorts and groups by severity for rendering.
--
-- This table holds CURRENT STATE only. A future habitat_events table will
-- track changes over time ("your flood zone designation changed from X to
-- AE") and is intentionally out of scope for this migration.

create table hearth.habitat_findings (
  id uuid primary key default gen_random_uuid(),

  -- The house this finding belongs to. Cascade so deleting a house cleans
  -- up all of its habitat findings — the data is meaningless without the
  -- parent house.
  house_id uuid not null references hearth.houses(id) on delete cascade,

  -- Identifier of the module that produced this finding, e.g.
  -- 'epa_radon_zone', 'fema_flood_zone', 'epa_superfund_proximity'.
  --
  -- Kept as text rather than an enum so new modules can be added without
  -- a schema migration. Documented values live in lib/habitat/registry.ts
  -- and the technical guide; code reviews enforce the spelling.
  module_key text not null,

  -- Lifecycle state of the most recent run of this module for this house.
  --   pending        — row exists (perhaps from a registry seed) but hasn't run
  --   running        — orchestrator step is currently executing check()
  --   completed      — check() returned a finding; severity/headline/etc populated
  --   failed         — check() threw; error column has details
  --   not_applicable — isApplicable() returned false (recorded so the UI can
  --                    explain "we considered radon for your area and it
  --                    doesn't apply" rather than silently omitting)
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'not_applicable')),

  -- Severity of the finding. Spans positive ('good'), neutral, and negative
  -- so this single table can hold "Walk Score 78" alongside "active
  -- Superfund 0.3 mi NE". Nullable until status = 'completed'.
  --
  -- Ordering note: when sorting findings for display, callers should
  -- translate this to a numeric weight rather than relying on lexical
  -- order of the strings. Suggested ordering: critical > high > moderate
  -- > low > neutral > good (concerns first, positives last). The
  -- alternative — good first, concerns at the bottom — is a UX choice
  -- and not encoded here.
  severity text
    check (severity in ('good', 'neutral', 'low', 'moderate', 'high', 'critical')),

  -- Short, surfaceable string written by the module. The dashboard
  -- renders this as the finding card's title. Module writes a
  -- deterministic baseline ("EPA Radon Zone 1 — high potential"); a
  -- future LLM synthesis step may rewrite this in Hearth's voice.
  headline text,

  -- One- to three-sentence plain-English explanation. Same provenance
  -- story as `headline` — module writes a deterministic baseline; a
  -- future LLM step may overwrite. We don't preserve an original
  -- `summary_source` column the way `houses.description_source` does
  -- because module-written summaries are deterministic and reproducible
  -- from `findings`; if we ever need the "what did the module originally
  -- say" view, we can derive it.
  summary text,

  -- Module-specific raw payload. Shape varies by module — see each module's
  -- file for the canonical schema. Examples:
  --
  --   epa_radon_zone: { zone: 1, county: "Kalamazoo", state: "MI",
  --                     action_threshold_pci_l: 4.0,
  --                     source: "EPA Map of Radon Zones" }
  --
  --   fema_flood_zone: { zone: "X", panel: "26077C0218D",
  --                      effective_date: "2010-04-02", bfe_ft: null }
  --
  --   epa_superfund_proximity: { sites: [{ site_id, site_name, status,
  --                              distance_meters, bearing,
  --                              contaminants: [...] }, ...] }
  --
  -- The chat / LLM layer reads this for deep questions; the dashboard
  -- read path doesn't have to parse it.
  findings jsonb,

  -- Canonical link the user (or a curious developer) can verify the
  -- finding against. Single URL by design — if a module needs to surface
  -- multiple links it can put them in `findings.links`. The dashboard
  -- uses this for a "Source" link on each card.
  source_url text,

  -- When check() last completed for this module/house. Null until the
  -- first successful run. Drives "last checked" UI and stale-finding
  -- alerts. Distinct from updated_at, which also moves on metadata
  -- changes like a manual re-trigger marking status = 'running'.
  checked_at timestamptz,

  -- When the orchestrator should consider re-running this module for
  -- this house. The module's declared cadence ('once', 'yearly',
  -- 'monthly', 'weekly', 'daily', 'fast') is translated into a concrete
  -- timestamp at write time. A 'once' module sets this to null and is
  -- never re-checked automatically. A future re-check cron iterates
  -- over rows where next_check_due_at <= now().
  next_check_due_at timestamptz,

  -- Error message from the most recent failed run. Null when status is
  -- pending/running/completed/not_applicable. Capped at 500 chars by
  -- the orchestrator before insertion — matches the briefing pattern
  -- on hearth.houses.
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One finding per module per house. Upserts on (house_id, module_key)
  -- give us idempotent re-runs — running the radon module a second time
  -- replaces the prior result cleanly.
  --
  -- If a module ever genuinely produces multiple findings (e.g. multiple
  -- nearby Superfund sites), it aggregates them into `findings` as an
  -- array rather than emitting multiple rows. This keeps the read path
  -- and the dashboard's "one card per module" rendering simple.
  unique (house_id, module_key)
);

-- Primary read pattern: "show me all findings for this house, ordered by
-- severity for the dashboard". The dashboard pulls every row for the
-- current house and groups in application code; a per-house index covers
-- this cleanly.
create index habitat_findings_house_id_idx
  on hearth.habitat_findings (house_id);

-- Re-check cron access pattern: "find findings that are due for a refresh".
-- Partial index excludes the common case where next_check_due_at is null
-- (modules with cadence='once') and rows that aren't yet completed.
create index habitat_findings_next_check_due_at_idx
  on hearth.habitat_findings (next_check_due_at)
  where next_check_due_at is not null and status = 'completed';

-- Status-watching access pattern: "which findings are currently running
-- or stuck failed across the fleet" — used by admin views and orchestrator
-- health checks. Partial index excludes the common terminal states.
create index habitat_findings_status_idx
  on hearth.habitat_findings (status)
  where status in ('pending', 'running', 'failed');

-- Reuse the shared updated_at trigger function created in the houses
-- migration.
create trigger habitat_findings_set_updated_at
  before update on hearth.habitat_findings
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: a user can only see and modify habitat findings
-- for houses they own. Delegates ownership to the parent house row rather
-- than duplicating owner_id on every finding, mirroring how rooms and
-- inventory handle this.
alter table hearth.habitat_findings enable row level security;

create policy habitat_findings_select_own
  on hearth.habitat_findings
  for select
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = habitat_findings.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy habitat_findings_insert_own
  on hearth.habitat_findings
  for insert
  with check (
    exists (
      select 1
      from hearth.houses
      where houses.id = habitat_findings.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy habitat_findings_update_own
  on hearth.habitat_findings
  for update
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = habitat_findings.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy habitat_findings_delete_own
  on hearth.habitat_findings
  for delete
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = habitat_findings.house_id
        and houses.owner_id = auth.uid()
    )
  );

-- Add to the supabase_realtime publication so the Habitat dashboard can
-- subscribe to row-level changes and light up findings as the orchestrator
-- writes them, mirroring how the briefing dashboard subscribes to the
-- houses row. RLS continues to enforce scope — only the owning user
-- receives the events.
alter publication supabase_realtime add table hearth.habitat_findings;