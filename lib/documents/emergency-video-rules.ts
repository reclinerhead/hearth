/**
 * Pure rules for the emergency-procedure-video primary/secondary
 * state (issue #139). Extracted from server actions so they can be
 * unit-tested without a database and reused by future surfaces
 * (admin tooling, migrations) without re-derivation.
 *
 * The two rules:
 *
 *   1. When a new video saves into a category, it becomes primary
 *      iff the category had zero rows before this save.
 *   2. When the primary in a category is deleted, the most recently
 *      created surviving secondary is auto-promoted to primary. If
 *      no secondaries exist the category empties out (no rows in
 *      it, no promotion needed).
 *
 * The shape below is intentionally narrow — just the fields the
 * rules need. Callers pass in a projection from hearth.documents,
 * not the full row.
 */

export type EmergencyVideoSummary = {
  id: string;
  emergency_is_primary: boolean;
  // ISO 8601 timestamp from hearth.documents.created_at. Used by the
  // promote rule to break ties — most recently created wins.
  created_at: string;
};

/**
 * Decide whether a new emergency video should land as primary.
 * Pre-condition: every input row must already belong to the
 * category the new save is targeting; the rule does not filter by
 * category itself.
 *
 * Returns true iff no rows exist for the category.
 */
export function shouldSaveAsPrimary(
  existingInCategory: ReadonlyArray<EmergencyVideoSummary>,
): boolean {
  return existingInCategory.length === 0;
}

/**
 * Given the rows remaining in a category after the primary is
 * deleted, return the id of the row to promote to primary. Returns
 * null if no secondaries exist (the category is now empty).
 *
 * Tie-breaking: most recent `created_at` wins. If two rows share
 * the same timestamp, the deterministic fallback is the lexically
 * larger id — uuids are random but comparing them yields a stable
 * order, which keeps repeated calls returning the same answer for
 * the same input.
 *
 * Pre-condition: the input must NOT include the just-deleted
 * primary row. Callers filter that out before passing in.
 */
export function pickPromotedSecondaryId(
  remainingInCategory: ReadonlyArray<EmergencyVideoSummary>,
): string | null {
  if (remainingInCategory.length === 0) return null;

  let winner = remainingInCategory[0];
  for (let i = 1; i < remainingInCategory.length; i++) {
    const candidate = remainingInCategory[i];
    if (candidate.created_at > winner.created_at) {
      winner = candidate;
    } else if (candidate.created_at === winner.created_at) {
      // Deterministic tie-break — lexically larger id wins.
      if (candidate.id > winner.id) winner = candidate;
    }
  }
  return winner.id;
}
