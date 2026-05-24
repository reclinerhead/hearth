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
 * Issue #140's first slice computed the label from distance tier, NPL
 * status, and the highest contaminant concern level. Issue #149
 * tightens those rules in place by adding pathway alignment against the
 * homeowner's `waterSource` and `basementPresent` (now landed on
 * HouseContext via #142). Two new escalation paths:
 *
 *   - Tier 1 or 2 active cleanup + well/shared water + at least one
 *     high-concern groundwater-pathway contaminant → worth_acting_on
 *     (a chlorinated solvent at a Tier 2 active site flips from
 *     worth_knowing to worth_acting_on for a well user).
 *   - Tier 1 active cleanup + basement present + at least one
 *     high-concern vapor-intrusion-pathway contaminant → worth_acting_on
 *     (the half-mile precautionary radius maps directly to Tier 1).
 *
 * The v1 rule (Tier 1 + F/P + any high-concern → worth_acting_on)
 * remains, so heavy metals and PCBs at a Tier 1 active site keep
 * escalating regardless of pathway alignment — persistent organics and
 * heavy metals travel through multiple media and the homeowner's
 * water source / basement doesn't materially change the framing.
 *
 * Suppression discipline: `waterSource ∈ {null, "unknown"}` and
 * `basementPresent === null` disable the new pathway-aligned
 * escalations. Users who skipped the onboarding questions get the v1
 * rules only — no inflation based on guesses about their setup.
 *
 * Severity (the 6-stop HabitatSeverity scale) stays load-bearing for the
 * dashboard dot and module-level top severity. The label is a separate
 * axis surfaced inside the finding modal — both coexist.
 */

import { findContaminantByAlias } from "@/lib/habitat/contaminants/lookup";
import type { Contaminant } from "@/lib/habitat/contaminants/data";
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
  /**
   * Homeowner's water source from HouseContext (#142). Issue #149's
   * groundwater-pathway escalation only fires for `"well"` or
   * `"shared"`; `null` and `"unknown"` disable the rule so users who
   * skipped onboarding don't get inflated labels. Optional on the
   * type so existing callers / tests that only care about the v1
   * rules can keep their fixtures terse.
   */
  waterSource?: "well" | "municipal" | "shared" | "unknown" | null;
  /**
   * Homeowner's basement presence from HouseContext (#142). Issue
   * #149's vapor-intrusion escalation only fires for `true`; `null`
   * (crawl space, partial basement, or "not sure") disables the rule.
   */
  basementPresent?: boolean | null;
};

/**
 * Returns true when at least one high-concern contaminant has the
 * given pathway in its `pathways` list. Used by the issue #149
 * escalation rules to decide whether the homeowner's situation
 * (well-water user, basement) aligns with what's actually at the site.
 */
function hasHighConcernOnPathway(
  enrichments: Contaminant[],
  pathway: Contaminant["pathways"][number],
): boolean {
  return enrichments.some(
    (e) => e.concern_level === "high" && e.pathways.includes(pathway),
  );
}

/**
 * Per-site label. Returns null when EPA hasn't published a contaminants
 * inventory AND the site is distant enough that proximity alone can't
 * carry the framing — suppression beats a bare default that would read
 * as Hearth-endorsed reassurance.
 *
 * After issue #154 the upstream module filters out empty-contaminant
 * sites before they reach this function in the production pipeline, so
 * the suppression branch only fires in unit tests today. Kept here as a
 * defensive guard — if the upstream filter is ever removed or bypassed,
 * the bare-label-reads-as-reassurance risk comes back, and the
 * suppression branch catches it.
 */
export function computeSiteLabel(
  inputs: SiteLabelInputs,
): SuperfundLabel | null {
  const { tier, nplCode, contaminants } = inputs;
  const waterSource = inputs.waterSource ?? null;
  const basementPresent = inputs.basementPresent ?? null;
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

  const isActiveCleanup = nplCode === "F" || nplCode === "P";
  const usesWell = waterSource === "well" || waterSource === "shared";
  const hasBasement = basementPresent === true;

  // worth_acting_on (v1): close active cleanup with at least one
  // high-concern contaminant, regardless of water source or basement.
  // Heavy metals and persistent organics travel through multiple media
  // — the homeowner's situation doesn't materially change the framing.
  if (tier === 1 && isActiveCleanup && hasHighConcern) {
    return "worth_acting_on";
  }

  // worth_acting_on (#149): pathway-aligned escalation. Tier 1 or 2
  // active cleanup with a well user and a high-concern groundwater
  // contaminant — e.g. chlorinated solvents at a Tier 2 cleanup flip
  // from worth_knowing to worth_acting_on once we know the user is on
  // a well that shares the affected aquifer.
  if (
    (tier === 1 || tier === 2) &&
    isActiveCleanup &&
    usesWell &&
    hasHighConcernOnPathway(enrichments, "groundwater")
  ) {
    return "worth_acting_on";
  }

  // worth_acting_on (#149): pathway-aligned escalation. Tier 1 (the
  // "within half-mile" precautionary radius) active cleanup with a
  // basement user and a high-concern vapor-intrusion contaminant.
  if (
    tier === 1 &&
    isActiveCleanup &&
    hasBasement &&
    hasHighConcernOnPathway(enrichments, "vapor_intrusion")
  ) {
    return "worth_acting_on";
  }

  // worth_knowing: middle-ground signals.
  if (tier === 1) return "worth_knowing";
  if (tier === 2 && isActiveCleanup) return "worth_knowing";
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
