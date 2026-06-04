// Toast copy for the "we scheduled a renewal reminder" affirmation
// (issue #283). When a user attaches a renewal document (vehicle
// registration, insurance, warranty — anything carrying an expiration)
// to an item, the direct-event pipeline creates a renewal maintenance
// task. This pure helper turns the pipeline's result into the one-line
// confirmation the UI surfaces in a Toast, so the user knows Hearth read
// their document and set a reminder.
//
// Pure + unit-tested: the copy selection (new vs. renewed vs. none) and
// the date formatting are exactly the kind of subtle logic that should
// not silently regress. No Supabase, no React — the input is the plain
// ProcessDirectEventResult the pipeline already returns.

export type RenewalToastInfo = {
  /** Id of the renewal task that was created. Null when the document
   *  carried no expiration / produced no task — the no-toast case. */
  created_task_id: string | null;
  /** Id of a prior open renewal task that was closed + chained because
   *  this upload renews the same stream. Null on a first-time renewal. */
  closed_task_id: string | null;
  /** Display title of the created task ("Vehicle registration renewal"). */
  created_task_title: string | null;
  /** Created task's due date (the document's expiration), ISO YYYY-MM-DD. */
  created_task_next_due_at: string | null;
};

/**
 * Build the renewal-reminder confirmation message, or null when no
 * affirmation is warranted (no renewal task was created — e.g. an
 * ordinary, non-expiring receipt). Returning null is load-bearing: we
 * never tell the user a reminder was scheduled when one wasn't.
 */
export function buildRenewalToastMessage(info: RenewalToastInfo): string | null {
  if (!info.created_task_id) return null;

  const subject = lowerLead(info.created_task_title) ?? "renewal";
  const due = formatDueMonth(info.created_task_next_due_at);

  if (info.closed_task_id) {
    // A prior open renewal on the same stream was marked done and chained.
    return due
      ? `Updated — we marked your previous ${subject} done and set the next reminder for ${due}.`
      : `Updated — we marked your previous ${subject} done and set the next reminder.`;
  }

  return due
    ? `Saved — we'll remind you about your ${subject} before it's due in ${due}.`
    : `Saved — we'll remind you about your ${subject}.`;
}

// Lowercase only the first character so a task title reads naturally
// mid-sentence ("Vehicle registration renewal" → "vehicle registration
// renewal") without mangling embedded acronyms (e.g. "DEQ permit").
function lowerLead(title: string | null): string | null {
  if (!title) return null;
  return title.charAt(0).toLowerCase() + title.slice(1);
}

// Format the ISO due date to a friendly month + year ("January 2026").
// UTC-anchored so a calendar-day date never slips a month by timezone.
function formatDueMonth(yyyymmdd: string | null): string | null {
  if (!yyyymmdd) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
