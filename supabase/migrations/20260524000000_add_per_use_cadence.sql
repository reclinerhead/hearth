-- Add 'per_use' as a fourth cadence_kind value (issue #135). Per-use
-- tasks are actions coupled to using the appliance ("clean lint screen
-- after every load", "check rinse aid before every cycle") rather than
-- to calendar dates. They surface on the inventory detail page under a
-- dedicated "Every time you use it" section but are excluded from the
-- dashboard's date-anchored maintenance panel.
--
-- Like 'one_time', per-use rows have null interval_months and null
-- seasonal_anchor (the cadence is not a duration, so no months value
-- applies). The cross-field invariant constraint is updated in lockstep.

alter table hearth.maintenance_tasks
  drop constraint if exists maintenance_tasks_cadence_kind_check;

-- The original check constraint was declared inline on the column (so
-- its name follows the Postgres auto-naming convention
-- `<table>_<column>_check`). The replacement below is named explicitly
-- so future migrations have a stable identifier to target.
alter table hearth.maintenance_tasks
  add constraint maintenance_tasks_cadence_kind_check
    check (cadence_kind is null or cadence_kind in (
      'interval', 'seasonal', 'one_time', 'per_use'
    ));

-- Replace the cross-field shape constraint to include the per_use
-- branch. Per-use rows have:
--   - cadence_kind = 'per_use'
--   - cadence_interval_months = null
--   - cadence_seasonal_anchor = null
-- Same shape as 'one_time', just a different kind value.

alter table hearth.maintenance_tasks
  drop constraint maintenance_tasks_cadence_shape;

alter table hearth.maintenance_tasks
  add constraint maintenance_tasks_cadence_shape
    check (
      (cadence_kind is null
        and cadence_interval_months is null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'one_time'
        and cadence_interval_months is null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'per_use'
        and cadence_interval_months is null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'interval'
        and cadence_interval_months is not null
        and cadence_seasonal_anchor is null)
      or (cadence_kind = 'seasonal'
        and cadence_interval_months is not null
        and cadence_seasonal_anchor is not null)
    );

-- next_due_at: per-use rows still need a value because the column is
-- not null. The synthesis pipeline writes today's date as a placeholder;
-- nothing reads it for per-use rows (the dashboard panel filters them
-- out, the inventory page's "Every time you use it" section doesn't
-- display dates for them). The not-null constraint stays because
-- relaxing it would require defensive checks in every existing reader
-- that assumes next_due_at is non-null. The placeholder approach keeps
-- existing code untouched.
--
-- No index changes. The existing indexes filter on `status = 'open'`
-- and order by `next_due_at`; per-use rows match the status filter and
-- have a valid (if meaningless) next_due_at, so they sit in the indexes
-- without harm. The dashboard panel's query adds a
-- `cadence_kind != 'per_use'` filter to exclude them at read time.
