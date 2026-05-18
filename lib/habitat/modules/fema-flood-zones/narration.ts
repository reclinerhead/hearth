/**
 * Narration helpers for the FEMA flood zones module's activity log.
 * Pulled out of index.ts so the prose lives in one place and the
 * check() flow stays readable.
 *
 * Voice rules (calibrated against the radon module, see
 * docs/TechnicalGuide.md → "Habitat surface"):
 *   - First-person ("I looked up", "I checked"), sentence case, full
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
import type { NormalizedFloodZone } from "./fetch";
import type { FloodZoneClassification } from "./classify";

export const FEMA_NFHL_SOURCE: ActivitySource = {
  label: "FEMA National Flood Hazard Layer",
  url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
};

export const FEMA_ZONE_DEFINITIONS_SOURCE: ActivitySource = {
  label: "FEMA flood zone definitions",
  url: "https://www.fema.gov/glossary/flood-zones",
};

// Cites Hearth's public methodology page. The /about/classification
// URL this used to point at is preserved as a permanent redirect in
// next.config.ts, so old findings persisted with the prior URL still
// resolve correctly when clicked.
export const HEARTH_CLASSIFICATION_SOURCE: ActivitySource = {
  label: "How Hearth classifies FEMA flood zone findings",
  url: "/how-it-works#flood-zones",
};

/**
 * Narration for the initial NFHL fetch step.
 */
export function fetchStepNarration(): string {
  return "I looked up your home in FEMA's National Flood Hazard Layer to see how they've mapped flood risk for your property.";
}

/**
 * Narration for the compute step on the happy path. Names the zone
 * code and, when present, the subtype so a reader skimming the log can
 * see at a glance what FEMA returned.
 */
export function computeStepNarration(
  zone: NormalizedFloodZone,
): { narration: string; detail: string; result_summary: string } {
  const subtypeClause = zone.zoneSubty
    ? `, with subtype "${zone.zoneSubty}"`
    : "";
  return {
    narration: `FEMA put your home in Zone ${zone.fldZone}${subtypeClause}.`,
    detail:
      `FLD_ZONE=${zone.fldZone}; ` +
      `ZONE_SUBTY=${zone.zoneSubty ?? "null"}; ` +
      `STUDY_TYP=${zone.studyType}; ` +
      `DFIRM_ID=${zone.dfirmId}; ` +
      `SOURCE_CIT=${zone.sourceCitation}`,
    result_summary: subtypeClause
      ? `Zone ${zone.fldZone} — ${zone.zoneSubty}`
      : `Zone ${zone.fldZone}`,
  };
}

/**
 * Variant of the compute step used when FEMA returned more than one
 * overlapping polygon. Calls out the multi-feature selection so a
 * reader knows the module didn't quietly pick a single arbitrary zone.
 */
export function multiFeatureComputeNarration(input: {
  totalFeatures: number;
  selectedZone: string;
}): { narration: string; detail: string; result_summary: string } {
  return {
    narration:
      `FEMA returned ${input.totalFeatures} overlapping polygons for these coordinates. ` +
      `I went with the more serious one — Zone ${input.selectedZone} — for this finding.`,
    detail: `Selected by max severity weight across ${input.totalFeatures} features.`,
    result_summary: `Selected Zone ${input.selectedZone}`,
  };
}

/**
 * Variant of the compute step used when FEMA returns an unknown
 * zone code we don't have in the classification table. Flags the
 * unknown code so a future production hit shows up clearly in the
 * persisted log.
 */
export function unknownZoneComputeNarration(
  unknownCode: string,
): { narration: string; detail: string; result_summary: string } {
  return {
    narration:
      `FEMA returned a zone code I don't recognize ("${unknownCode}"). ` +
      `I'm being cautious and flagging it for follow-up rather than guessing.`,
    detail: `Unknown FLD_ZONE="${unknownCode}" not present in classify.ts table.`,
    result_summary: `Unknown zone: ${unknownCode}`,
  };
}

/**
 * Narration for the rule step on the happy path. Spells out what the
 * zone means in plain English so the reader sees the FEMA-side
 * definition that drives the severity decision.
 */
export function ruleStepNarration(
  zone: NormalizedFloodZone,
  classification: FloodZoneClassification,
): { narration: string; detail: string } {
  return {
    narration:
      `FEMA's flood zone classifications tell us what Zone ${zone.fldZone} means: ` +
      `your home is ${classification.plainEnglish}.`,
    detail: `Zone ${zone.fldZone} (${classification.kind}) — see FEMA's flood zone definitions.`,
  };
}

/**
 * Narration for the decide step on the happy path. Echoes the input →
 * output → system behaviour shape used by the radon module.
 */
export function decideStepNarration(
  zone: NormalizedFloodZone,
  classification: FloodZoneClassification,
): { narration: string; detail: string; result_summary: string } {
  return {
    narration: `That maps to a '${classification.severity}' finding in Hearth.`,
    detail: `zone('${zone.fldZone}') + subtype('${zone.zoneSubty ?? "null"}') → severity('${classification.severity}')`,
    result_summary: `Severity: ${classification.severity}`,
  };
}

/**
 * Narration for the closing finding step on the happy path.
 */
export function findingStepNarration(headline: string): {
  narration: string;
  result_summary: string;
} {
  return {
    narration: "I put the finding together for your dashboard.",
    result_summary: headline,
  };
}

/**
 * Narration for the no-coverage compute step. NFHL returned an empty
 * features[] — typical for the ~10% of US addresses outside digital
 * coverage. No rule/decide step on this path; the no-coverage decision
 * is the compute step.
 */
export function noCoverageComputeNarration(): {
  narration: string;
  detail: string;
  result_summary: string;
} {
  return {
    narration:
      "FEMA returned no flood zone for these coordinates, which means " +
      "this location is outside NFHL's digital coverage. That's not " +
      "unusual for some rural and remote areas.",
    detail: "features.length === 0 from NFHL MapServer/28 query.",
    result_summary: "No NFHL coverage",
  };
}

/**
 * Narration for the no-coverage decide step. Severity is `neutral` for
 * this path — we don't know whether the home is at risk, so we don't
 * claim either favorable or concern.
 */
export function noCoverageDecideNarration(): {
  narration: string;
  detail: string;
  result_summary: string;
} {
  return {
    narration:
      "Without FEMA coverage I can't tell you a zone, so I'm marking " +
      "this as 'neutral' in Hearth's classification — neither all-clear " +
      "nor a concern — and pointing you at your local floodplain " +
      "administrator instead.",
    detail: "no_coverage → severity('neutral')",
    result_summary: "Severity: neutral",
  };
}

/**
 * Narration for the no-coverage finding step.
 */
export function noCoverageFindingNarration(headline: string): {
  narration: string;
  result_summary: string;
} {
  return {
    narration: "I put the finding together for your dashboard.",
    result_summary: headline,
  };
}

/**
 * Severity label for log readouts. Mirrors the textual form used
 * elsewhere in the habitat surface so a log reader sees the same word
 * the dashboard tile shows.
 */
export function severityWord(severity: HabitatSeverity): string {
  return severity;
}
