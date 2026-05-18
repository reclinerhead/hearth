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

export const EPA_SUPERFUND_RINGS_SOURCE: ActivitySource = {
  label: "EPA — Superfund community-impact rings",
  url: "https://www.epa.gov/superfund",
};

// Forward-looking link — the classification page doesn't exist yet, but
// the activity log is meant to be a frozen-in-time record, so we cite
// the URL the page will live at. Same pattern as the radon module's
// /about/classification#radon anchor.
export const HEARTH_CLASSIFICATION_SOURCE: ActivitySource = {
  label: "How Hearth classifies Superfund findings",
  url: "/about/classification#superfund",
};

/**
 * Narration for the initial EPA fetch step.
 */
export function fetchStepNarration(state: string): string {
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
      "I applied Hearth's three-tier proximity model, based on EPA's standard 1- and 3-mile community-impact rings.",
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
