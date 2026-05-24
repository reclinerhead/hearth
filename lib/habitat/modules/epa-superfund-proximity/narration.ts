/**
 * Narration helpers for the EPA Superfund Proximity module's activity
 * log. Pulled out of index.ts so the prose lives in one place and the
 * check() flow stays readable.
 *
 * Voice rules (calibrated against the radon module, see
 * docs/TechnicalGuide.md → "Habitat surface"):
 *   - First-person ("I checked", "I'm flagging"), sentence case, full
 *     stops. No log-style fragments.
 *   - `detail` is terse, code-flavored: URLs, lookup keys, transformations.
 *   - `result_summary` only on steps where the outcome is the point of
 *     the step.
 *   - Every fetch step cites the upstream dataset; every rule step
 *     cites the external authority; every decide step cites Hearth's
 *     own classification page.
 */

import type { ActivitySource } from "@/lib/habitat/activity-log";
import type { HabitatSeverity } from "@/lib/habitat/types";
import { bearingWord } from "./format";
import type { Tier } from "./severity";

export const EPA_ENVIROFACTS_SOURCE: ActivitySource = {
  label: "EPA Envirofacts SEMS — Superfund site data",
  url: "https://www.epa.gov/enviro/sems-search-user-guide",
};

// Cites Hearth's public methodology page. The /about/classification
// URL this used to point at is preserved as a permanent redirect in
// next.config.ts, so old findings persisted with the prior URL still
// resolve correctly when clicked.
export const HEARTH_CLASSIFICATION_SOURCE: ActivitySource = {
  label: "How Hearth classifies Superfund findings",
  url: "/how-it-works#superfund",
};

// The tier model is Hearth's, not EPA's. EPA uses 1- and 3-mile rings
// in its community-involvement work near Superfund sites; our 0.5 /
// 2 / 5 bands are a Hearth synthesis informed by that practice. The
// rule step's citation points at our own methodology page, which is
// where the relationship to EPA's published guidance is documented —
// not at /superfund, which would imply EPA publishes a
// "community-impact rings" standard that doesn't exist.
export const HEARTH_TIER_RULE_SOURCE: ActivitySource = {
  label:
    "How Hearth classifies Superfund findings (based on EPA community-involvement practice)",
  url: "/how-it-works#superfund",
};

/**
 * Narration for the initial EPA fetch step. Issue #160 added the
 * `cacheHit` parameter — when populated, the step describes a cache
 * hit instead of a fresh fetch, naming the cached date and the TTL
 * window so a reader can see why the call was fast.
 */
export function fetchStepNarration(
  state: string,
  cacheHit?: { ageDays: number; ttlDays: number; fetchedAt: Date },
): string {
  if (cacheHit) {
    const ageWord =
      cacheHit.ageDays === 0
        ? "earlier today"
        : `${cacheHit.ageDays} day${cacheHit.ageDays === 1 ? "" : "s"} ago`;
    return (
      `I had a cached EPA Superfund response for ${state} from ${ageWord} ` +
      `(within the ${cacheHit.ttlDays}-day cache window), so I used that ` +
      `instead of re-fetching.`
    );
  }
  return `I started by asking EPA's Superfund database what sites are in or near ${state}.`;
}

/**
 * Narration for the coordinate-cleanup compute step.
 */
export function coordCleanupNarration(
  droppedCount: number,
  remainingCount: number,
): { narration: string; detail: string } {
  if (droppedCount === 0) {
    return {
      narration:
        "Every site in the response came with coordinates, so nothing had to be dropped.",
      detail: `0 sites dropped (no latitude/longitude); ${remainingCount} sites remaining.`,
    };
  }
  return {
    narration:
      "I filtered out sites EPA doesn't have coordinates for — those can't tell us how close they are to you.",
    detail: `${droppedCount} sites dropped (no latitude/longitude); ${remainingCount} sites remaining.`,
  };
}

/**
 * Narration for the distance-measurement step.
 */
export function distanceStepNarration(
  homeLat: number,
  homeLng: number,
  siteCount: number,
): { narration: string; detail: string } {
  return {
    narration:
      "I measured the straight-line distance from your home to each remaining site.",
    detail: `Haversine distance from (${homeLat.toFixed(3)}, ${homeLng.toFixed(
      3,
    )}) to ${siteCount} site${siteCount === 1 ? "" : "s"}.`,
  };
}

/**
 * Narration for the tier-filter rule step. Spells out the three-tier
 * model in the same words the issue's design doc uses.
 */
export function tierFilterNarration(
  qualifyingCount: number,
  countsByTier: { 1: number; 2: number; 3: number },
): { narration: string; detail: string; result_summary: string } {
  return {
    narration:
      "I applied Hearth's three-tier proximity model. Hearth uses 0.5 mi, 2 mi, and 5 mi rings, informed by the 1- and 3-mile distances EPA uses in its community involvement work near Superfund sites.",
    detail:
      "Tier 1 ≤ 0.5 mi (any NPL status); Tier 2 0.5–2 mi (Final or Proposed); Tier 3 2–5 mi (Final only).",
    result_summary:
      qualifyingCount === 0
        ? "No sites qualified within 5 miles."
        : `${qualifyingCount} site${
            qualifyingCount === 1 ? "" : "s"
          } qualified: ` +
          [
            countsByTier[1] ? `${countsByTier[1]} in Tier 1` : null,
            countsByTier[2] ? `${countsByTier[2]} in Tier 2` : null,
            countsByTier[3] ? `${countsByTier[3]} in Tier 3` : null,
          ]
            .filter(Boolean)
            .join(", ") +
          ".",
  };
}

/**
 * Narration for the decide step when there is at least one qualifying
 * site. Names the closest site, its distance and direction, and the
 * top-level severity Hearth is assigning to the finding.
 */
export function decideStepNarration(input: {
  closestName: string;
  closestDistance: number;
  closestBearing: string;
  topSeverity: HabitatSeverity;
  closestTier: Tier;
  closestNplCode: string;
}): { narration: string; detail: string; result_summary: string } {
  const dir = bearingWord(input.closestBearing);
  return {
    narration:
      `${input.closestName} is the closest at ${input.closestDistance.toFixed(
        1,
      )} mile${input.closestDistance === 1.0 ? "" : "s"} ${dir}. ` +
      `That makes this finding a '${input.topSeverity}' in Hearth's classification.`,
    detail: `tier(${input.closestTier}) + npl_status('${input.closestNplCode}') → severity('${input.topSeverity}')`,
    result_summary: `Severity: ${input.topSeverity}`,
  };
}

/**
 * Narration for the decide step when there are zero qualifying sites.
 */
export function noSitesDecideNarration(input: {
  state: string;
  totalSites: number;
}): { narration: string; detail: string; result_summary: string } {
  return {
    narration:
      `Nothing in EPA's data put a Superfund site within 5 miles of your home. ` +
      `I'm marking this as 'favorable' in Hearth's classification — good news.`,
    detail: `${input.totalSites} NPL-relevant site${
      input.totalSites === 1 ? "" : "s"
    } in ${input.state}; 0 within 5 mi of your home.`,
    result_summary: "Severity: favorable",
  };
}

/**
 * Narration for the conditional compute step inserted after the
 * tier-filter rule step when at least one tier-qualifying site was
 * dropped because EPA hasn't published any contaminants for it. Issue
 * #154 — see [`/how-it-works#superfund`](../../app/(app)/how-it-works/page.tsx)
 * for the user-facing rationale.
 *
 * Without a contaminant inventory the modal has nothing actionable to
 * render and the EPA profile URL frequently 404s for these rollup
 * entries (Georgia-Pacific is the canonical example). The activity log
 * narrates the suppression honestly so a curious homeowner can see what
 * was dropped — the names go in the detail line.
 */
export function noContaminantsSuppressionNarration(
  droppedSiteNames: ReadonlyArray<string>,
): { narration: string; detail: string; result_summary: string } {
  const count = droppedSiteNames.length;
  const namesList = droppedSiteNames.join(", ");
  return {
    narration:
      `I filtered out ${count} site${count === 1 ? "" : "s"} where EPA ` +
      `hasn't published contaminant data — those entries have nothing ` +
      `useful for me to tell you about.`,
    detail: `Suppressed: ${namesList}`,
    result_summary: `${count} site${count === 1 ? "" : "s"} suppressed (no contaminant inventory)`,
  };
}

/**
 * Per-site precision caveat copy. Set on a SiteEntry's context when
 * the site has a multi-location structure (currently inferred from a
 * `/` in `name_original` — Allied Paper, Inc./Portage Creek/Kalamazoo
 * River is the canonical example: a single record covers 80 miles of
 * river and several landfills). The string lives here so the same copy
 * is used by both the per-site context field and the conditional
 * activity-log step. The dashboard finding-detail page can render it
 * verbatim next to the displayed distance.
 */
export const PRECISION_CAVEAT_TEXT =
  "EPA publishes a single point for this multi-location site. " +
  "Parts of the site may be meaningfully closer to or farther from " +
  "your home than the reported distance.";

/**
 * Narration for the conditional compute step inserted between the
 * distance computation and the tier-filter rule when at least one
 * qualifying site carries a precision caveat. Lists the flagged sites
 * (display name only) in the detail line so a reader can see which
 * distances are approximate.
 */
export function precisionCaveatNarration(
  flaggedSiteNames: ReadonlyArray<string>,
): { narration: string; detail: string } {
  const count = flaggedSiteNames.length;
  const namesList = flaggedSiteNames.join(", ");
  return {
    narration:
      "A few of the sites are large or span multiple locations — EPA reports a single point for each, even when the actual site footprint stretches across miles. The distance to those sites is approximate.",
    detail: `${count} site${
      count === 1 ? "" : "s"
    } flagged with multi-location precision caveat: ${namesList}`,
  };
}

/**
 * Narration for the closing finding step.
 */
export function findingStepNarration(
  qualifyingCount: number,
  headline: string,
): { narration: string; result_summary: string } {
  return {
    narration:
      qualifyingCount === 0
        ? "I put the finding together for your dashboard — no active Superfund sites near your home is the headline."
        : "I put the finding together for your dashboard with the closest site, its distance and direction, and links to EPA's profile.",
    result_summary: headline,
  };
}
