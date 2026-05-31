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
 * Pure. On `cws_with_ccr` the CCR is the canonical picture, but it
 * reports contaminants across THREE places, and a homeowner thinks of
 * all of them as "what's in my water":
 *   - the general `contaminants` table (the regulated set);
 *   - a separate `lead_copper_distribution` section (lead and copper
 *     are governed by the Lead and Copper Rule, so CCRs print them
 *     apart from the regulated-contaminant table);
 *   - a separate `ucmr_results` section (PFAS is monitored under the
 *     Unregulated Contaminant Monitoring Rule, so utilities print PFOA/
 *     PFOS/etc. in their own UCMR block).
 * We read all three — otherwise lead and PFAS, two of the headline
 * findings, would show as "not detected" in the matrix purely because
 * they live in different CCR sections. When the CCR didn't report
 * lead/copper, we fall back to EPA's SDWIS lead/copper samples. On the
 * non-CCR branches the LCR samples are the only detection data. Copper
 * has no matrix row by design — it's still emitted here (the matcher
 * ignores it), keeping this function honest about what was measured.
 */

import type { CcrFindings } from "./ccr";
import type { LeadCopperSummary, LcrMeasurement } from "./lcr";
import type { WqaBranch } from "./types";
import type { CcrLeadCopperDistribution } from "@/lib/documents/ai/ccr-schema";
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

/** Lead or copper from the SDWIS LCR summary, when positively detected. */
function lcrLeadCopper(
  leadCopper: LeadCopperSummary | null,
  which: "lead" | "copper",
): DetectedContaminantInput | null {
  if (!leadCopper || leadCopper.status !== "available") return null;
  const period = leadCopper.most_recent_sampling_period;
  return which === "lead"
    ? lcrMeasurementToDetected(period.lead_90th_percentile, "Lead", "PB90")
    : lcrMeasurementToDetected(period.copper_90th_percentile, "Copper", "CU90");
}

/** Lead or copper from the CCR's own lead-and-copper distribution. */
function ccrLeadCopper(
  distribution: CcrLeadCopperDistribution | null,
  which: "lead" | "copper",
): DetectedContaminantInput | null {
  const entry = distribution?.[which] ?? null;
  if (!entry || entry.percentile_90 === null || !(entry.percentile_90 > 0)) {
    return null;
  }
  return {
    name: which === "lead" ? "Lead" : "Copper",
    code: which === "lead" ? "PB90" : "CU90",
    level_label: formatLevel(entry.percentile_90, entry.unit),
  };
}

/**
 * Lead and copper detections, preferring the CCR's own reported
 * distribution and falling back to EPA's LCR samples. Returns at most
 * one row each for lead and copper.
 */
function leadCopperDetections(
  distribution: CcrLeadCopperDistribution | null,
  leadCopper: LeadCopperSummary | null,
): DetectedContaminantInput[] {
  const out: DetectedContaminantInput[] = [];
  const lead =
    ccrLeadCopper(distribution, "lead") ?? lcrLeadCopper(leadCopper, "lead");
  if (lead) out.push(lead);
  const copper =
    ccrLeadCopper(distribution, "copper") ?? lcrLeadCopper(leadCopper, "copper");
  if (copper) out.push(copper);
  return out;
}

export function deriveDetectedContaminants(args: {
  branch: WqaBranch;
  ccrFindings: CcrFindings | null;
  leadCopper: LeadCopperSummary | null;
}): DetectedContaminantInput[] {
  const { branch, ccrFindings, leadCopper } = args;

  // CCR branch: the regulated-contaminant table PLUS the separate
  // lead/copper distribution. Lead/copper fall back to LCR when the CCR
  // didn't print them.
  if (branch === "cws_with_ccr" && ccrFindings) {
    const out: DetectedContaminantInput[] = [];
    if (ccrFindings.contaminants) {
      for (const c of ccrFindings.contaminants) {
        out.push({
          name: c.contaminant_name,
          code: null,
          level_label: formatLevel(c.detected_level, c.unit),
        });
      }
    }
    // UCMR section — PFAS and other unregulated monitoring printed in
    // their own block. Include only positively-detected rows (a null or
    // zero level is a non-detect / monitored-but-clean row).
    if (ccrFindings.ucmr_results) {
      for (const u of ccrFindings.ucmr_results) {
        if (u.detected_level !== null && u.detected_level > 0) {
          out.push({
            name: u.contaminant_name,
            code: null,
            level_label: formatLevel(u.detected_level, u.unit),
          });
        }
      }
    }
    out.push(
      ...leadCopperDetections(ccrFindings.lead_copper_distribution, leadCopper),
    );
    return out;
  }

  // Non-CCR branches: SDWIS lead/copper samples, when available.
  return leadCopperDetections(null, leadCopper);
}
