/**
 * Pure builder for the Water Quality Awareness module's discovery-modal
 * line.
 *
 * History:
 *   #186 — first cut. Replaced a compliance-only line with a two-clause
 *          sentence that paired clean compliance with the actual flag
 *          driver, drawing every input straight off the persisted finding.
 *   #188 — severity logic shifted: any detected lead/copper drives
 *          caution (not only ≥80% of the action level), and
 *          monitoring/reporting violations stop driving severity.
 *          The builder's voice updated to "in active compliance with
 *          EPA" + "any presence is worth knowing about" for the new
 *          detected-but-low tier. The previous `hasActiveNonHealthBased`
 *          branch was removed (unreachable after the severity change).
 *
 * Three inputs do all the work:
 *   - `severity` — the row's final severity. Disambiguates "concern via
 *     health-based violation" from "concern via LCR above action", and
 *     gates which LCR tier the caution copy describes.
 *   - `complianceStatus` — `system_card.compliance_status_short`.
 *   - `lcrAxis` — `classifyLcrAxis(lead_copper_summary)` from `./lcr`,
 *     which exposes per-metal `above` / `approaching` / `detected` /
 *     `below` / `absent` state without re-implementing the EPA action-
 *     level thresholds.
 *
 * Branch and PWSID identity (private_well, cws_unmapped, stale,
 * non_community) are handled separately by the caller — those rows
 * don't have a system on file to talk about in the same shape.
 */

import type { HabitatSeverity } from "@/lib/habitat/types";
import type { LcrAxisClassification, LcrMetalState } from "./lcr";

export type ComplianceStatusShort =
  | "unknown"
  | "no_active_violations"
  | "active_violations";

export type CwsOnboardingMessageInput = {
  severity: HabitatSeverity;
  pwsName: string | undefined;
  complianceStatus: ComplianceStatusShort | undefined;
  lcrAxis: LcrAxisClassification;
};

/**
 * Build the discovery-modal line for the `cws_no_ccr` / `cws_with_ccr`
 * branches. The non-CWS branches (private_well, cws_unmapped, stale,
 * non_community) compose their own lines and don't call this.
 */
export function buildCwsOnboardingMessage(
  input: CwsOnboardingMessageInput,
): string {
  const { severity, complianceStatus, lcrAxis } = input;
  const above = metalsAt(lcrAxis, "above");
  const approaching = metalsAt(lcrAxis, "approaching");
  const detected = metalsAt(lcrAxis, "detected");
  const below = metalsAt(lcrAxis, "below");

  // Concern via active health-based compliance violation.
  if (severity === "concern" && complianceStatus === "active_violations") {
    return joinClause(
      input.pwsName,
      "EPA shows an active health-based compliance issue worth a closer look.",
    );
  }

  // Concern via LCR at/above action level (compliance clean).
  if (severity === "concern" && above.length > 0) {
    return joinClause(
      input.pwsName,
      `they're in active compliance with EPA, but recent ${formatMetals(above)} samples are at or above the action level. Worth a closer look.`,
    );
  }

  // Caution via LCR approaching the action level (≥80% but below).
  // Comes before the broader detected branch so the more specific
  // "approaching" copy wins when applicable.
  if (severity === "caution" && approaching.length > 0) {
    return joinClause(
      input.pwsName,
      `they're in active compliance with EPA, but recent ${formatMetals(approaching)} samples are approaching the action level. We'll flag this for follow-up.`,
    );
  }

  // Caution via any detected lead/copper below the approaching tier
  // (#188). Hearth's framing: any presence is worth knowing about —
  // EPA's action level is a regulatory threshold, not a health-safety
  // one. Voice pairs the positive on compliance with the honest
  // call-out on the LCR axis.
  if (severity === "caution" && detected.length > 0) {
    return joinClause(
      input.pwsName,
      `they're in active compliance with EPA, but recent samples have detected ${formatMetals(detected)}. Any presence is worth knowing about.`,
    );
  }

  // Favorable — clean compliance AND every sample below the detection
  // limit. We mention only the metals that actually had a below-
  // detection sample so we don't overclaim "lead and copper" when only
  // one was tested.
  if (severity === "favorable") {
    return joinClause(
      input.pwsName,
      `they're in active compliance with EPA and recent samples show no detectable ${formatMetals(below)}.`,
    );
  }

  // Neutral / unknown — drop the second clause rather than fabricate a
  // positive on a missing axis. The line acknowledges the utility and
  // stops there.
  return input.pwsName
    ? `Found your water utility — ${input.pwsName}.`
    : "Found your water utility on file with EPA.";
}

/**
 * Compose the "Found your water utility — {name} — {clause}" line.
 * When the system name is missing, the lead phrase pivots to "Found
 * your water utility on file with EPA — {clause}" so the sentence
 * still reads as one continuous statement.
 */
function joinClause(pwsName: string | undefined, clause: string): string {
  const lead =
    pwsName && pwsName.length > 0
      ? `Found your water utility — ${pwsName}`
      : "Found your water utility on file with EPA";
  return `${lead} — ${clause}`;
}

function metalsAt(
  axis: LcrAxisClassification,
  level: LcrMetalState,
): Array<"lead" | "copper"> {
  if (axis.kind !== "available") return [];
  const out: Array<"lead" | "copper"> = [];
  if (axis.lead === level) out.push("lead");
  if (axis.copper === level) out.push("copper");
  return out;
}

function formatMetals(metals: Array<"lead" | "copper">): string {
  if (metals.length === 0) return "";
  if (metals.length === 1) return metals[0];
  return "lead and copper";
}
