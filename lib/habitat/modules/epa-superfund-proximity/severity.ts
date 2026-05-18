/**
 * Tier + NPL-status → severity mapping for the EPA Superfund Proximity
 * module. Extracted so the rules are auditable in isolation from the
 * fetch / narration / formatting concerns.
 *
 * Three-tier proximity model, based on EPA's standard 1- and 3-mile
 * community-impact rings:
 *
 *   Tier 1  ≤ 0.5 mi     — include any NPL status (F, P, A, D)
 *   Tier 2  0.5 - 2 mi   — include only Final (F) or Proposed (P)
 *   Tier 3  2 - 5 mi     — include only Final (F)
 *   > 5 mi               — does not produce a finding
 *
 * NPL status codes returned by EPA Envirofacts:
 *   F = Final NPL
 *   P = Proposed NPL
 *   A = Part of an NPL site (parent listed elsewhere)
 *   D = Deleted from NPL (cleanup completed and site removed from list)
 *   N = Not on NPL (intentionally not fetched by this module)
 */

import type { HabitatSeverity } from "@/lib/habitat/types";

export type NplCode = "F" | "P" | "A" | "D";
export type Tier = 1 | 2 | 3;

/**
 * Assign a proximity tier to a site given the distance and its NPL
 * status, or null if the site is too far away or its status doesn't
 * qualify for inclusion at its tier.
 *
 * Exported for the test suite and for use in index.ts.
 */
export function applyTier(
  distanceMiles: number,
  nplCode: NplCode,
): Tier | null {
  if (distanceMiles <= 0.5) return 1;
  if (distanceMiles <= 2) {
    if (nplCode === "F" || nplCode === "P") return 2;
    return null;
  }
  if (distanceMiles <= 5) {
    if (nplCode === "F") return 3;
    return null;
  }
  return null;
}

/**
 * Map a (tier, NPL-status) pair to Hearth's 6-stop severity scale.
 *
 *   Tier 1 + F/P  → concern
 *   Tier 1 + A/D  → caution
 *   Tier 2 + F/P  → caution
 *   Tier 2 + A/D  → neutral   (defensive — applyTier excludes A/D at Tier 2)
 *   Tier 3 + F    → neutral
 *
 * Exported for the test suite.
 */
export function tierAndStatusToSeverity(
  tier: Tier,
  nplCode: NplCode,
): HabitatSeverity {
  if (tier === 1) {
    if (nplCode === "F" || nplCode === "P") return "concern";
    return "caution";
  }
  if (tier === 2) {
    if (nplCode === "F" || nplCode === "P") return "caution";
    return "neutral";
  }
  return "neutral";
}

const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 6,
  concern: 5,
  caution: 4,
  neutral: 3,
  favorable: 2,
  beneficial: 1,
};

export function severityWeight(severity: HabitatSeverity): number {
  return SEVERITY_WEIGHT[severity];
}

/**
 * Pick the worst (highest-weight) severity from a non-empty list. Used to
 * roll per-site severities up to a single top-level severity on the
 * finding. Returns "favorable" for an empty input — callers should
 * handle the zero-sites case explicitly rather than relying on this
 * default.
 */
export function maxSeverity(severities: HabitatSeverity[]): HabitatSeverity {
  let best: HabitatSeverity = "favorable";
  let bestWeight = SEVERITY_WEIGHT[best];
  for (const s of severities) {
    const w = SEVERITY_WEIGHT[s];
    if (w > bestWeight) {
      best = s;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * Human-readable label for an NPL status code. Used in the finding
 * payload and (indirectly) in summaries.
 */
export function nplStatusLabel(nplCode: NplCode): string {
  switch (nplCode) {
    case "F":
      return "Final NPL";
    case "P":
      return "Proposed NPL";
    case "A":
      return "Part of NPL site";
    case "D":
      return "Deleted from NPL";
  }
}
