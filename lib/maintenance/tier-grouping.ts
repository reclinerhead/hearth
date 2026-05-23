// Pure tier-grouping helper for the "On your plate" maintenance panel
// (issue #133). Takes the open task list and a reference date, returns
// the three buckets the panel renders: overdue, next 30 days, later.
//
// Lives in its own file because the tiering rules are exactly the kind
// of thing that goes wrong silently — a boundary off by one day, a
// timezone slip, a malformed date crashing the whole panel. Pure + tested
// means we can change the rules with confidence and reuse the helper
// from the future reports surface without restructuring.

export type TierableTask = {
  id: string;
  /** YYYY-MM-DD date (matches hearth.maintenance_tasks.next_due_at, a Postgres date). */
  next_due_at: string;
};

export type GroupedTasks<T extends TierableTask> = {
  overdue: T[];
  next30: T[];
  later: T[];
};

/**
 * Groups open maintenance tasks into the three tiers the panel renders.
 *
 *   overdue: next_due_at < today
 *   next30:  today <= next_due_at <= today + 30 days  (both bounds inclusive)
 *   later:   next_due_at > today + 30 days
 *
 * Sort order within each tier is ascending by next_due_at:
 *   - overdue → most-overdue first (oldest dates surface at the top)
 *   - next30  → soonest first
 *   - later   → soonest first
 *
 * Comparison is calendar-day granularity. The reference date is
 * normalized to UTC midnight before comparison so tier boundaries are
 * stable across timezones — a task due `2026-05-23` and a click that
 * happens at 23:59 local on the same calendar day still tiers cleanly.
 *
 * Malformed `next_due_at` values are silently dropped rather than
 * crashing the panel. The database `date` column + check constraints
 * prevent this in practice, but the helper shouldn't take down the page
 * if a stray row slips through.
 */
export function groupTasksByTier<T extends TierableTask>(
  tasks: T[],
  referenceDate: Date,
): GroupedTasks<T> {
  const today = normalizeToDateOnly(referenceDate);
  const cutoff = addDays(today, 30);

  const overdue: T[] = [];
  const next30: T[] = [];
  const later: T[] = [];

  for (const task of tasks) {
    const due = parseDateOnly(task.next_due_at);
    if (!due) continue;

    if (due.getTime() < today.getTime()) {
      overdue.push(task);
    } else if (due.getTime() <= cutoff.getTime()) {
      next30.push(task);
    } else {
      later.push(task);
    }
  }

  const byDate = (a: T, b: T) =>
    a.next_due_at < b.next_due_at ? -1 : a.next_due_at > b.next_due_at ? 1 : 0;
  overdue.sort(byDate);
  next30.sort(byDate);
  later.sort(byDate);

  return { overdue, next30, later };
}

function normalizeToDateOnly(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateOnly(yyyymmdd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}
