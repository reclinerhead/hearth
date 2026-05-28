/**
 * Pure builder for the Water Quality Awareness module's discovery-modal
 * line (issue #186).
 *
 * Pre-#186 the line read off `compliance_status_short` only, which
 * produced a contradiction whenever WQA flagged a `caution` row via
 * the Lead and Copper Rule axis: the modal would show a warning glyph
 * + "Worth knowing" pill next to "EPA shows no active compliance
 * issues." This builder pairs the positive signal on the clean axis
 * with the honest call-out of the actual flag driver on the other
 * axis, drawing every input straight off the persisted finding.
 *
 * Three inputs do all the work:
 *   - `severity` — the row's final severity, the disambiguator between
 *     "concern via health-based violation" and "concern via LCR above
 *     action" (and similarly for caution).
 *   - `complianceStatus` — `system_card.compliance_status_short`.
 *   - `lcrAxis` — `classifyLcrAxis(lead_copper_summary)` from `./lcr`,
 *     which exposes per-metal `above` / `approaching` / `below` /
 *     `absent` state without re-implementing the EPA action-level
 *     thresholds.
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
      `EPA shows no active violations, but recent ${formatMetals(above)} samples are at or above the action level. Worth a closer look.`,
    );
  }

  // Caution via non-health-based ("monitoring") compliance violation.
  // Compliance is active but the row didn't escalate to concern, so the
  // active violation must be non-health-based.
  if (severity === "caution" && complianceStatus === "active_violations") {
    if (approaching.length > 0) {
      return joinClause(
        input.pwsName,
        `EPA shows a non-health monitoring issue on file and recent ${formatMetals(approaching)} samples are approaching the action level. We'll flag this for follow-up.`,
      );
    }
    return joinClause(
      input.pwsName,
      "EPA shows a non-health monitoring issue on file. We'll flag this for follow-up.",
    );
  }

  // Caution via LCR approaching the action level (compliance clean).
  if (severity === "caution" && approaching.length > 0) {
    return joinClause(
      input.pwsName,
      `EPA shows no active violations, but recent ${formatMetals(approaching)} samples are approaching the action level. We'll flag this for follow-up.`,
    );
  }

  // Favorable — clean compliance AND at least one metal below action.
  // We mention only the metals that actually had a below-action sample
  // so we don't overclaim "lead and copper" when only one was tested.
  if (severity === "favorable") {
    return joinClause(
      input.pwsName,
      `EPA shows no active violations and recent ${formatMetals(below)} samples are below the action level.`,
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
