/**
 * Normalize a house's detected contaminants into the shape the
 * remediation layer consumes (epic #165, WQA-5).
 *
 * Single source of truth for "what's actually in this house's water,"
 * shared by two callers so they never drift:
 *   - the orchestrator (`index.ts`, server), which feeds it into
 *     `buildRecommendedActions` so the filter card is contaminant-
 *     specific;
 *   - the matrix view (`components/remediation-matrix-view.tsx`,
 *     client), which feeds it into the personalization + recommendation
 *     helpers so the highlighting and the combination cards match the
 *     filter card exactly.
 *
 * Pure. On `cws_with_ccr` the CCR contaminant table is the canonical
 * picture (it covers lead/copper plus everything else the utility
 * tested), so we read straight off it. On the other CWS branches the
 * only detection data is the SDWIS lead/copper samples, so we surface a
 * positive lead or copper measurement. Copper has no matrix row by
 * design — it's still emitted here (the matcher simply ignores it),
 * keeping this function honest about what was measured.
 */

import type { CcrFindings } from "./ccr";
import type { LeadCopperSummary, LcrMeasurement } from "./lcr";
import type { WqaBranch } from "./types";
import type { DetectedContaminantInput } from "@/lib/habitat/water-quality/remediation/recommend";

function formatLevel(
  level: number | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (level === null || level === undefined) return null;
  return unit ? `${level} ${unit}` : `${level}`;
}

function lcrMeasurementToDetected(
  measurement: LcrMeasurement | null,
  name: string,
  code: string,
): DetectedContaminantInput | null {
  // "<" is a below-detection-limit row — not a positive detection.
  if (!measurement || measurement.sign === "<") return null;
  if (!(measurement.value > 0)) return null;
  return {
    name,
    code,
    level_label: formatLevel(measurement.value, measurement.unit),
  };
}

export function deriveDetectedContaminants(args: {
  branch: WqaBranch;
  ccrFindings: CcrFindings | null;
  leadCopper: LeadCopperSummary | null;
}): DetectedContaminantInput[] {
  const { branch, ccrFindings, leadCopper } = args;

  // CCR branch: the contaminant table is the canonical list. Every row
  // in `contaminants` is a positive detection by construction.
  if (branch === "cws_with_ccr" && ccrFindings?.contaminants) {
    return ccrFindings.contaminants.map((c) => ({
      name: c.contaminant_name,
      code: null,
      level_label: formatLevel(c.detected_level, c.unit),
    }));
  }

  // Non-CCR branches: SDWIS lead/copper samples, when available.
  if (leadCopper && leadCopper.status === "available") {
    const period = leadCopper.most_recent_sampling_period;
    const out: DetectedContaminantInput[] = [];
    const lead = lcrMeasurementToDetected(
      period.lead_90th_percentile,
      "Lead",
      "PB90",
    );
    if (lead) out.push(lead);
    const copper = lcrMeasurementToDetected(
      period.copper_90th_percentile,
      "Copper",
      "CU90",
    );
    if (copper) out.push(copper);
    return out;
  }

  return [];
}
