-- Append-only event log of maintenance tasks (issue #122).
--
-- Each row represents one occurrence — either currently open (waiting
-- to be completed) or historical (completed, with the document and
-- notes that closed it captured inline). Completion of one occurrence
-- triggers the insertion of a new row for the next occurrence,
-- chained via predecessor_task_id. Old rows are never mutated after
-- they reach a terminal status.
--
-- Two pipelines write into this table:
--   - 'direct_event': server-side rule that creates renewal tasks from
--     uploaded documents whose metadata carries an expiration date
--     (vehicle registration, insurance policy, etc). Independent of
--     synthesis — direct-event tasks exist whether or not the user has
--     ever clicked "Build maintenance plan" on the related item.
--   - 'synthesis': LLM-generated tasks from a per-item maintenance
--     plan, grounded in ai_insights.maintenance + habitat findings +
--     linked service receipts + install/purchase dates. Triggered
--     manually from a button on the inventory detail page.
--
-- The source discriminator is load-bearing for the rebuild flow:
-- "Rebuild maintenance plan" only supersedes 'synthesis' rows, never
-- 'direct_event' rows.

create table hearth.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),

  -- House scope — every read goes through this column. Cascade on
  -- delete: deleting a house removes its maintenance tasks atomically.
  house_id uuid not null
    references hearth.houses(id) on delete cascade,

  -- Optional inventory item this task applies to. Most tasks are
  -- item-scoped ("annual furnace service" → the furnace row, "vehicle
  -- registration renewal" → the Camry row). A few synthesis tasks may
  -- be house-scoped without an inventory anchor ("gutter cleaning" if
  -- gutters aren't an inventory item) — those leave this column null.
  -- ON DELETE CASCADE so deleting an inventory item removes its tasks
  -- atomically. Two reasons we don't preserve task history past the
  -- item: (1) the per-task reasoning jsonb is frozen at row-creation
  -- time with manufacturer/model/serial embedded, so each completed
  -- row is already self-contained for any history view that survives
  -- — we don't need a dangling FK to keep history readable; (2) we
  -- want null inventory_id to mean "house-scoped task" unambiguously,
  -- not "orphaned task whose item was deleted." Cascade preserves
  -- that semantic.
  inventory_id uuid
    references hearth.inventory(id) on delete cascade,

  -- Source pipeline that created this row. Determines whether a
  -- synthesis rebuild may supersede it.
  source text not null
    check (source in ('direct_event', 'synthesis')),

  -- Task kind discriminator. Drives the detail modal's primary CTA
  -- ("Renew now" with deep link vs. "Mark refilled" vs. "Find a
  -- contractor" vs. "Mark inspected") and the icon shown in the
  -- dashboard panel. Open enum; new kinds can be added as a check
  -- constraint update without a data migration.
  kind text not null
    check (kind in (
      'renewal',      -- registration, insurance, warranty expirations
      'service',      -- annual furnace service, water heater flush
      'inspection',   -- anode rod, sump pump test, radon retest
      'consumable',   -- furnace filter, water softener salt
      'seasonal'      -- gutter cleaning, AC cover, sprinkler blowout
    )),

  -- Display title shown in the dashboard panel and the modal header.
  -- Synthesis-generated; direct-event tasks derive a title from the
  -- document kind ("Vehicle registration", "Auto insurance renewal").
  title text not null check (char_length(title) between 1 and 120),

  -- Optional one-line subtitle / detail shown beneath the title in the
  -- panel rows. e.g. "Goodman GMS950703BXA · Basement" or "Progressive
  -- · Policy 8826-441-22". Renderer falls back to inventory item name
  -- + room when this is null and inventory_id is set.
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),

  -- When the task is next due. The whole module is anchored on this
  -- column — sorting, overdue detection, the three-tier panel grouping,
  -- and future notification scheduling all read it. Stored as a date
  -- (not timestamptz) because maintenance due-dates are calendar-day
  -- granularity, not wall-clock; "due May 24" doesn't get more or less
  -- overdue based on timezone. Always populated, even for completed
  -- rows (so reports can compute "average days late" across history).
  next_due_at date not null,

  -- Lifecycle column. 'open' rows are the active to-do list; 'completed'
  -- rows are history; 'superseded' rows are synthesis tasks that were
  -- replaced by a plan rebuild before they were ever completed.
  status text not null
    check (status in ('open', 'completed', 'superseded')),

  -- ---- Cadence (synthesis output schema; null on one-time tasks) ----
  --
  -- Defines how this task recurs. When a task is completed, the next
  -- occurrence's next_due_at is computed from these fields plus the
  -- completion date. Three shapes:
  --
  --   kind='interval'  → recur every cadence_interval_months from the
  --                      completion date. e.g. furnace filter every 3
  --                      months: { kind: 'interval', interval_months: 3 }.
  --
  --   kind='seasonal'  → recur every cadence_interval_months but
  --                      anchored to a season. e.g. annual furnace
  --                      service before heating season:
  --                      { kind: 'seasonal', interval_months: 12,
  --                        seasonal_anchor: 'before_heating_season' }.
  --                      The interval drives how often; the anchor
  --                      drives when in the year.
  --
  --   kind='one_time'  → does not recur. Completion writes the row to
  --                      'completed' status and no successor is created.
  --                      e.g. "register your appliance warranty within
  --                      90 days of install."
  --
  -- Direct-event tasks set kind='interval' with interval_months derived
  -- from the renewal term metadata (6mo policy → 6, 1yr registration
  -- → 12, 2yr registration → 24).
  cadence_kind text
    check (cadence_kind is null or cadence_kind in (
      'interval', 'seasonal', 'one_time'
    )),
  cadence_interval_months integer
    check (cadence_interval_months is null
           or cadence_interval_months between 1 and 120),
  cadence_seasonal_anchor text
    check (cadence_seasonal_anchor is null or cadence_seasonal_anchor in (
      'before_heating_season',
      'before_cooling_season',
      'spring',
      'fall'
    )),

  -- Renewal-term metadata for the mark-renewed sheet (issue #TBD).
  -- When the task is a renewal whose term varies by jurisdiction or
  -- carrier (Michigan registration → 1yr or 2yr, Progressive auto → 6
  -- or 12 months), the renewal modal renders these as tappable cards
  -- instead of forcing the user to pick a date manually. Shape:
  --   [{ label: '1 year', interval_months: 12 },
  --    { label: '2 years', interval_months: 24 }]
  -- Null when the task doesn't need a term picker (most synthesis
  -- tasks — the cadence is fixed by the manufacturer). Populated by
  -- the direct-event pipeline from a small per-issuer constants map
  -- at task-creation time; stored per-row so each task is self-
  -- describing and survives the constants map drifting later.
  renewal_options jsonb,

  -- ---- Provenance ----
  --
  -- Per-task reasoning captured at creation time. Renders in the task
  -- detail modal under a "Why this task" expand, mirroring the habitat
  -- findings activity_log pattern. Shape (TypeScript: TaskReasoning
  -- from lib/maintenance/types.ts):
  --   {
  --     source_kind: 'manufacturer_guidance' | 'class_default'
  --                 | 'habitat_modifier' | 'installation_anchored'
  --                 | 'receipt_anchored' | 'document_expiration',
  --     cadence_basis: string,        -- prose in Hearth's voice
  --     modifiers: Array<{
  --       kind: 'habitat' | 'system_age' | 'environment',
  --       finding_module_key?: string,  -- when kind='habitat'
  --       effect: string
  --     }>,
  --     anchor: {
  --       kind: 'receipt' | 'install_date' | 'synthesis_default'
  --           | 'document_expiration',
  --       detail: string,              -- "May 18, 2026 service receipt"
  --       document_id?: string         -- when grounded in a document
  --     }
  --   }
  --
  -- Frozen at row-creation time. Future synthesis runs produce new
  -- rows with their own reasoning; this row's reasoning is never
  -- mutated. Null is invalid for synthesis tasks (the reasoning is
  -- the whole point); direct-event tasks populate a minimal shape
  -- (source_kind='document_expiration', anchor pointing at the
  -- document that produced the date).
  reasoning jsonb not null,

  -- ---- Completion ----
  --
  -- Set when status flips to 'completed'. Null on open and superseded
  -- rows. completed_by_document_id is the document whose upload
  -- closed the task (renewal card, service receipt) — null when the
  -- user manually marked it done without attaching a document.
  -- ON DELETE SET NULL on the FK preserves the completion record if
  -- the document is later deleted.
  completed_at timestamptz,
  completed_by_document_id uuid
    references hearth.documents(id) on delete set null,
  completion_notes text
    check (completion_notes is null or char_length(completion_notes) <= 1000),

  -- ---- Lineage ----
  --
  -- Back-reference to the row this occurrence succeeded. Null on the
  -- first occurrence of a task; populated when a completion writes
  -- the next row. ON DELETE SET NULL so the chain can survive a
  -- historical row being purged (we don't expect to purge, but the
  -- constraint shouldn't be load-bearing on something we'd never do).
  predecessor_task_id uuid
    references hearth.maintenance_tasks(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ---- Cross-field invariants ----
  --
  -- A 'completed' row must have completed_at set. A non-completed row
  -- must have completed_at null. Enforced at the database level so an
  -- application-side bug can't write a half-completed row.
  constraint maintenance_tasks_completed_at_matches_status
    check (
      (status = 'completed' and completed_at is not null) or
      (status <> 'completed' and completed_at is null)
    ),

  -- A 'seasonal' cadence requires a seasonal anchor. An 'interval'
  -- cadence requires an interval months. A 'one_time' cadence is
  -- standalone and forbids both. Null cadence (the task isn't
  -- recurring at all — currently unused, kept open for future kinds)
  -- forbids both as well.
  constraint maintenance_tasks_cadence_shape
    check (
      (cadence_kind is null
        and cadence_interval_months is null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'one_time'
        and cadence_interval_months is null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'interval'
        and cadence_interval_months is not null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'seasonal'
        and cadence_interval_months is not null
        and cadence_seasonal_anchor is not null)
    )
);

-- Primary read path: "all open tasks for the dashboard panel, ordered
-- by due date." House-scoped, status-filtered, ordered ascending so
-- overdue rows surface first. Partial index excludes the bulk of the
-- table (completed history) from the index footprint — once a house
-- has a few years of history, completed rows will outnumber open ones
-- by ~10x and the partial keeps the panel query fast.
create index maintenance_tasks_house_open_by_due_idx
  on hearth.maintenance_tasks (house_id, next_due_at)
  where status = 'open';

-- Inventory detail page panel read path: "all open tasks for this
-- inventory item, ordered by due date." Same shape as above but
-- scoped to a single inventory_id. Partial index on inventory_id is
-- not null + status = 'open' keeps the index small.
create index maintenance_tasks_inventory_open_by_due_idx
  on hearth.maintenance_tasks (inventory_id, next_due_at)
  where status = 'open' and inventory_id is not null;

-- History read path: "all tasks (any status) for this inventory item,
-- newest first." Drives the renamed History section on the inventory
-- detail page and the future reports that need a full task log per
-- item. Full (non-partial) because history queries don't filter by
-- status — they want the whole record.
create index maintenance_tasks_inventory_history_idx
  on hearth.maintenance_tasks (inventory_id, created_at desc)
  where inventory_id is not null;

-- Rebuild-plan write path: "find all open synthesis tasks for this
-- inventory item so we can supersede them." Narrow partial index
-- targeted at exactly this transactional shape.
create index maintenance_tasks_synthesis_open_idx
  on hearth.maintenance_tasks (inventory_id)
  where source = 'synthesis' and status = 'open';

-- Updated-at trigger reuses the shared function from earlier migrations.
create trigger maintenance_tasks_set_updated_at
  before update on hearth.maintenance_tasks
  for each row
  execute function hearth.set_updated_at();

-- ---- Row-level security ----
--
-- Four policies, all scoped through hearth.houses.owner_id = auth.uid().
-- Identical pattern to hearth.documents and hearth.inventory.

alter table hearth.maintenance_tasks enable row level security;

create policy maintenance_tasks_select
  on hearth.maintenance_tasks for select
  using (
    exists (
      select 1 from hearth.houses
      where houses.id = maintenance_tasks.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy maintenance_tasks_insert
  on hearth.maintenance_tasks for insert
  with check (
    exists (
      select 1 from hearth.houses
      where houses.id = maintenance_tasks.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy maintenance_tasks_update
  on hearth.maintenance_tasks for update
  using (
    exists (
      select 1 from hearth.houses
      where houses.id = maintenance_tasks.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy maintenance_tasks_delete
  on hearth.maintenance_tasks for delete
  using (
    exists (
      select 1 from hearth.houses
      where houses.id = maintenance_tasks.house_id
        and houses.owner_id = auth.uid()
    )
  );

-- ---- Synthesis run trace on hearth.inventory ----
--
-- Per-item synthesis activity log, mirroring habitat_findings.activity_log.
-- One column on hearth.inventory holds the most recent synthesis run's
-- step trace (which inputs were considered, which habitat findings were
-- consulted, which receipts were used as anchors, total duration, model
-- used). Re-running synthesis overwrites this column with the fresh
-- trace; historical traces are not preserved because per-task reasoning
-- on the resulting maintenance_tasks rows captures the load-bearing
-- decisions, and the run-level trace is for debugging and the "show
-- our work" surface, not for reports.
--
-- Shape (TypeScript: SynthesisRunLog from lib/maintenance/types.ts):
--   {
--     started_at: string,
--     completed_at: string,
--     total_duration_ms: number,
--     model: string,
--     inputs_summary: {
--       insights_generated_at: string | null,
--       habitat_findings_considered: number,
--       linked_receipts_considered: number,
--       install_date_used: string | null
--     },
--     steps: Array<{
--       step: number,
--       kind: 'load' | 'consider' | 'decide' | 'emit_task' | 'skip',
--       narration: string,
--       detail?: string,
--       at_ms: number
--     }>,
--     tasks_emitted: number,
--     error: string | null
--   }
--
-- Nullable; null means synthesis has never been run for this item.
-- The inventory detail page reads this column to decide whether the
-- "Build maintenance plan" button reads "Build" (null) or "Rebuild"
-- (non-null).

alter table hearth.inventory
  add column last_synthesis_run jsonb;

comment on column hearth.inventory.last_synthesis_run is
  'Most recent maintenance-synthesis run trace. Shape documented in '
  'lib/maintenance/types.ts (SynthesisRunLog). Overwritten on each run; '
  'historical traces are not preserved (per-task reasoning on '
  'hearth.maintenance_tasks captures load-bearing decisions per row).';
