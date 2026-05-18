/**
 * FEMA flood zone → Hearth severity classifier.
 *
 * Reads both `fldZone` and `zoneSubty` together. The subtype is
 * load-bearing — Zone X with the "0.2 PCT ANNUAL CHANCE" subtype (the
 * 500-year/shaded-X floodplain) is a meaningfully different finding
 * from Zone X with the "minimal hazard" subtype, even though the bare
 * zone code is identical.
 *
 * Classification table (mirrors the issue's design doc):
 *
 *   FLD_ZONE         | ZONE_SUBTY                              | Severity
 *   -----------------+-----------------------------------------+------------
 *   X                | "AREA OF MINIMAL FLOOD HAZARD" or null  | favorable
 *   X                | "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"    | neutral
 *   D                | any                                     | caution
 *   A/AE/AH/AO/AR    | any EXCEPT "FLOODWAY"                   | concern
 *   A/AE             | "FLOODWAY"                              | critical
 *   V/VE             | any                                     | critical
 *   <unknown>        | any                                     | caution
 *
 * The no-coverage case (zero features returned from NFHL) is handled by
 * the module entrypoint, not this classifier — it has its own copy and
 * activity-log shape.
 */

import type { HabitatSeverity } from "@/lib/habitat/types";
import type { NormalizedFloodZone } from "./fetch";

/**
 * Per-zone classification result. `kind` is what drives copy selection
 * downstream — there are seven happy-path branches plus an `unknown`
 * fallback for defensive futureproofing against FEMA schema changes.
 */
export type FloodZoneClassification = {
  severity: HabitatSeverity;
  kind:
    | "minimal_x"
    | "shaded_x"
    | "undetermined_d"
    | "sfha_inland"
    | "floodway"
    | "coastal_high_hazard"
    | "unknown";
  /** Human-readable description of what the zone means. */
  plainEnglish: string;
};

const SFHA_INLAND_ZONES = new Set(["A", "AE", "AH", "AO", "AR"]);
const COASTAL_HIGH_HAZARD_ZONES = new Set(["V", "VE"]);
const FLOODWAY_CAPABLE_ZONES = new Set(["A", "AE"]);

/**
 * Severity weight used to pick the most severe zone when FEMA returns
 * multiple overlapping polygons. Higher = more severe. Mirrors the
 * sort order used elsewhere in the habitat surface.
 */
export const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 6,
  concern: 5,
  caution: 4,
  neutral: 3,
  favorable: 2,
  beneficial: 1,
};

/**
 * Classify one normalized zone. Comparison is case-insensitive on both
 * `fldZone` (FEMA emits upper-case but we normalize defensively) and
 * `zoneSubty` (the table says match case-insensitively, and the
 * "FLOODWAY" subtype shows up both upper- and mixed-case across panels).
 */
export function classifyFloodZone(
  zone: NormalizedFloodZone,
): FloodZoneClassification {
  const code = zone.fldZone?.trim().toUpperCase() ?? "";
  const subty = zone.zoneSubty?.trim().toUpperCase() ?? "";

  if (code === "X") {
    if (subty.includes("0.2 PCT") || subty.includes("0.2%")) {
      return {
        severity: "neutral",
        kind: "shaded_x",
        plainEnglish:
          "in the 500-year (shaded X) floodplain — outside the regulated SFHA, but with a low residual flood risk",
      };
    }
    return {
      severity: "favorable",
      kind: "minimal_x",
      plainEnglish:
        "outside both the 100-year and 500-year floodplains, with minimal flood risk",
    };
  }

  if (code === "D") {
    return {
      severity: "caution",
      kind: "undetermined_d",
      plainEnglish:
        "in an area FEMA has flagged as possible-but-undetermined flood hazard — formal studies haven't been completed",
    };
  }

  if (FLOODWAY_CAPABLE_ZONES.has(code) && subty === "FLOODWAY") {
    return {
      severity: "critical",
      kind: "floodway",
      plainEnglish:
        "in a regulatory floodway — the active channel that carries flood flows during a major event",
    };
  }

  if (SFHA_INLAND_ZONES.has(code)) {
    return {
      severity: "concern",
      kind: "sfha_inland",
      plainEnglish:
        "in a Special Flood Hazard Area (the 100-year floodplain) where there's roughly a 1% chance of flooding in any given year",
    };
  }

  if (COASTAL_HIGH_HAZARD_ZONES.has(code)) {
    return {
      severity: "critical",
      kind: "coastal_high_hazard",
      plainEnglish:
        "in a coastal high-hazard area where wave action and storm surge add risk on top of standard floodplain flooding",
    };
  }

  return {
    severity: "caution",
    kind: "unknown",
    plainEnglish: `in flood zone "${zone.fldZone}", which isn't in Hearth's classification table`,
  };
}

/**
 * Given a non-empty list of overlapping zones, pick the most severe by
 * severity weight. Ties broken by FEMA's array order. Used when FEMA
 * returns multiple polygons at a boundary — rare but possible. Exported
 * for the test suite.
 */
export function pickMostSevere(
  zones: readonly NormalizedFloodZone[],
): { zone: NormalizedFloodZone; classification: FloodZoneClassification } {
  if (zones.length === 0) {
    throw new Error("pickMostSevere called with an empty array");
  }
  let bestZone = zones[0];
  let bestClass = classifyFloodZone(zones[0]);
  for (let i = 1; i < zones.length; i++) {
    const candidate = classifyFloodZone(zones[i]);
    if (SEVERITY_WEIGHT[candidate.severity] > SEVERITY_WEIGHT[bestClass.severity]) {
      bestZone = zones[i];
      bestClass = candidate;
    }
  }
  return { zone: bestZone, classification: bestClass };
}
