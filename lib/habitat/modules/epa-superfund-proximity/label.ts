/**
 * Computed "label" for the Superfund module — a parallel concept to
 * HabitatSeverity that grades how relevant a site (or the portfolio of
 * sites) is to a homeowner who's reasoning about whether to take action.
 *
 *   "worth_acting_on" — a homeowner in this situation would reasonably
 *                       take a concrete step (test their water, ask their
 *                       utility for the latest CCR, etc.)
 *   "worth_knowing"   — material to the user's mental model, but not
 *                       action-prompting on its own
 *   "informational"   — on the record; low salience for this property
 *   null              — we can't characterize confidently. Show nothing
 *                       rather than defaulting to a bare label that could
 *                       read as Hearth-endorsed reassurance.
 *
 * Issue #140 designs this label to incorporate property-situation inputs
 * (water source, basement, well/municipal). Those fields are not on the
 * house schema yet — this first slice computes the label from what IS
 * available today (distance tier, NPL status, contaminant concern levels,
 * count of qualifying sites). The follow-up that adds water_source and
 * basement_present will tighten these rules in place.
 *
 * Severity (the 6-stop HabitatSeverity scale) stays load-bearing for the
 * dashboard dot and module-level top severity. The label is a separate
 * axis surfaced inside the finding modal — both coexist.
 */

import { findContaminantByAlias } from "@/lib/habitat/contaminants/lookup";
import type { NplCode, Tier } from "./severity";

export type SuperfundLabel =
  | "worth_acting_on"
  | "worth_knowing"
  | "informational";

/**
 * Ordering used by the sort key for the overview-card list and by
 * `computePortfolioLabel` when rolling per-site labels up to a single
 * portfolio label. Higher = more relevant.
 */
const LABEL_WEIGHT: Record<SuperfundLabel, number> = {
  worth_acting_on: 3,
  worth_knowing: 2,
  informational: 1,
};

/** Sentence-case display words. */
export const LABEL_WORD: Record<SuperfundLabel, string> = {
  worth_acting_on: "Worth acting on",
  worth_knowing: "Worth knowing",
  informational: "Informational",
};

/**
 * CSS-variable colors used for the per-site visual anchor in the
 * overview card and the finding-label word in the modal header.
 * Reuses the existing severity tokens so the visual treatment is
 * consistent with the rest of the dashboard.
 */
export const LABEL_COLOR: Record<SuperfundLabel, string> = {
  worth_acting_on: "var(--color-status-danger)",
  worth_knowing: "var(--color-status-warning)",
  informational: "var(--color-text-tertiary)",
};

export function labelWeight(label: SuperfundLabel | null): number {
  return label === null ? 0 : LABEL_WEIGHT[label];
}

export type SiteLabelInputs = {
  tier: Tier;
  nplCode: NplCode;
  /**
   * Display-formatted contaminants off the site (already passed through
   * `formatContaminants` at check() time). May be an empty array — EPA
   * doesn't publish a contaminant inventory for every site.
   */
  contaminants: string[];
};

/**
 * Per-site label. Returns null when EPA hasn't published a contaminants
 * inventory AND the site is distant enough that proximity alone can't
 * carry the framing — suppression beats a bare default that would read
 * as Hearth-endorsed reassurance.
 */
export function computeSiteLabel(
  inputs: SiteLabelInputs,
): SuperfundLabel | null {
  const { tier, nplCode, contaminants } = inputs;
  const enrichments = contaminants
    .map((c) => findContaminantByAlias(c))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const hasHighConcern = enrichments.some((e) => e.concern_level === "high");
  const hasModerateConcern = enrichments.some(
    (e) => e.concern_level === "moderate",
  );
  const noContaminantsKnown = contaminants.length === 0;

  // Suppression: distant site (Tier 3) with no published contaminants —
  // we can't characterize whether this matters.
  if (noContaminantsKnown && tier === 3) return null;

  // worth_acting_on: close active cleanup with at least one high-concern
  // contaminant. The combination is the most pointed signal we can
  // surface without the property-situation inputs.
  if (
    tier === 1 &&
    (nplCode === "F" || nplCode === "P") &&
    hasHighConcern
  ) {
    return "worth_acting_on";
  }

  // worth_knowing: middle-ground signals.
  if (tier === 1) return "worth_knowing";
  if (tier === 2 && (nplCode === "F" || nplCode === "P")) {
    return "worth_knowing";
  }
  if (hasHighConcern) return "worth_knowing";
  if (hasModerateConcern && tier === 2) return "worth_knowing";

  // informational: distant, no concerning chemistry surfaced.
  return "informational";
}

/**
 * Portfolio label across the per-site labels for every qualifying site.
 * Max of the non-null per-site labels; null when every per-site label
 * is suppressed (or the input is empty).
 */
export function computePortfolioLabel(
  labels: Array<SuperfundLabel | null>,
): SuperfundLabel | null {
  let best: SuperfundLabel | null = null;
  let bestWeight = 0;
  for (const l of labels) {
    if (l === null) continue;
    const w = LABEL_WEIGHT[l];
    if (w > bestWeight) {
      best = l;
      bestWeight = w;
    }
  }
  return best;
}
