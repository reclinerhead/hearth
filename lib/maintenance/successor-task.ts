// Pure helper that computes the next occurrence's due-date when an
// open maintenance task is marked complete (issue #137).
//
// Three branches, in priority order:
//   1. A renewal task carries an explicit `newExpirationOverride` (the
//      mark-renewed sheet's user-chosen term card or manual date). That
//      date is authoritative — it represents what the user just decided.
//   2. `cadence_kind === 'one_time'` or `'per_use'` returns null. A
//      one-time task is the terminal record; a per-use practice is
//      never "completed" in the lifecycle sense and never produces a
//      successor.
//   3. Otherwise (interval / seasonal), the successor's next_due_at is
//      `completedOn + cadence_interval_months`. Computed in UTC so the
//      result matches what the panel reads back as a date-only column.
//
// `completedOn` is a YYYY-MM-DD string; the returned date is the same
// shape so the caller writes it straight back to `next_due_at` without
// re-parsing.

export type ComputeSuccessorDueDateInput = {
  cadence_kind: string | null;
  cadence_interval_months: number | null;
  /** YYYY-MM-DD. */
  completedOn: string;
  /** YYYY-MM-DD when the caller wants to override the cadence math
   *  (renewal tasks via mark-renewed sheet); null otherwise. */
  newExpirationOverride: string | null;
};

export function computeSuccessorDueDate(
  input: ComputeSuccessorDueDateInput,
): string | null {
  if (input.newExpirationOverride) return input.newExpirationOverride;

  if (
    input.cadence_kind === "one_time" ||
    input.cadence_kind === "per_use"
  ) {
    return null;
  }

  if (!input.cadence_interval_months) return null;

  const parts = input.completedOn.split("-").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [y, m, d] = parts;

  // Use Date.UTC so the result stays calendar-day stable across local
  // time zones. Date.UTC clamps month overflow naturally: Date.UTC(2026, 12, 1)
  // becomes Jan 1, 2027. End-of-month dates (Feb 29) clamp to the next
  // month when the target month is shorter — JavaScript's Date rolls
  // (Date.UTC(2027, 1, 29) → Mar 1, 2027). We accept this rollover; it's
  // the same behavior the mark-renewed sheet's preview uses, so the
  // user sees the projected date before they confirm.
  const next = new Date(Date.UTC(y, m - 1 + input.cadence_interval_months, d));
  if (Number.isNaN(next.getTime())) return null;
  return next.toISOString().slice(0, 10);
}
