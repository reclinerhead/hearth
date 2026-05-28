/**
 * Build the persisted findings payload + headline + summary for a WQA
 * run. Pure functions over the branch outcome and the Envirofacts
 * record — keeps the module's check() thin and the copy/shape
 * decisions testable.
 *
 * Copy register: short, factual, first-person-from-Hearth. No LLM in
 * Phase 1 — the description sentence is templated from inventory
 * fields. WQA-4 (the findings view rewrite) is the natural place to
 * revisit LLM-generated descriptions; until then a clean template
 * reads better than a stale model output.
 */

import type { HabitatSeverity } from "@/lib/habitat/types";
import type { ComplianceSummary } from "./compliance";
import {
  computeLcrSeverityInputs,
  type LeadCopperSummary,
} from "./lcr";
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";
import type { WqaBranch, WqaFindings, WqaRecommendedAction } from "./types";

/**
 * Bundle returned by buildFindings. The orchestrator persists every
 * field on the habitat_findings row; the module just returns them.
 */
export type WqaPayload = {
  severity: HabitatSeverity;
  headline: string;
  summary: string;
  findings: WqaFindings;
};

const NEUTRAL: HabitatSeverity = "neutral";

/**
 * Map the EPA source-water indicator to the union the system_card uses.
 *
 *   "GW" → groundwater
 *   "SW" → surface
 *   "GU" → groundwater_under_surface (under the influence of surface water)
 *   anything else / null → unknown
 */
export function mapSourceType(
  gwSwCode: string | null | undefined,
): NonNullable<WqaFindings["system_card"]>["source_type"] {
  const code = gwSwCode?.toUpperCase() ?? "";
  if (code === "GW") return "groundwater";
  if (code === "SW") return "surface";
  if (code === "GU") return "groundwater_under_surface";
  return "unknown";
}

/**
 * Strip a CITY,STATE-style raw EPA name like "BAKER, JAMES" or
 * "BAKER,JAMES" into a "James Baker" presentation form. EPA stores
 * admin names "Last, First" in upper-case; surfacing that verbatim
 * reads like a system error.
 *
 * Exported for the test suite.
 */
export function formatAdminName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    return `${titleCase(parts[1])} ${titleCase(parts[0])}`;
  }
  return titleCase(trimmed);
}

/**
 * EPA returns most string fields in upper-case (city names, utility
 * names, etc.). Title-case for display.
 *
 * Exported for the test suite.
 */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) =>
      w.length === 0 ? w : w[0].toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * "City of Kalamazoo Public Water Supply" — the EPA name often reads
 * better as a display form. For the WQA-1 system card we want a short
 * "City of X" or "X Water" treatment without overengineering. The
 * cleanest path: title-case the EPA pws_name verbatim. EPA records
 * for municipal systems typically already include the city — the
 * Kalamazoo sample is just "KALAMAZOO", which renders as
 * "Kalamazoo Public Water Supply" once we suffix it.
 */
export function displaySystemName(record: EnvirofactsWaterSystemRecord): string {
  const raw = record.pws_name.trim();
  const titled = titleCase(raw);
  // Heuristic: if the EPA name doesn't already mention "Water" /
  // "Authority" / "District" / "Utility", suffix "Public Water
  // Supply" to give the bare municipal names some structure. Doesn't
  // change anything for systems whose EPA name already reads as a
  // utility name (e.g. "Kentwood Water Department").
  const hasUtilityWord = /\b(water|authority|district|utility|supply|works)\b/i.test(
    titled,
  );
  return hasUtilityWord ? titled : `${titled} Public Water Supply`;
}

/**
 * Build the templated description sentence for the system card. Phase
 * 1 keeps this deterministic — population + connection counts +
 * source-protection mention. WQA-4 swaps this for an LLM rewrite if
 * the team decides it's worth the cost; until then a stable template
 * reads better than a stale model output.
 *
 * Exported for the test suite.
 */
export function buildDescription(record: EnvirofactsWaterSystemRecord): string {
  const sourceWord =
    mapSourceType(record.gw_sw_code) === "groundwater"
      ? "groundwater"
      : mapSourceType(record.gw_sw_code) === "surface"
        ? "surface-water"
        : "mixed-source";
  const pop =
    typeof record.population_served_count === "number"
      ? record.population_served_count.toLocaleString()
      : null;
  const conn =
    typeof record.service_connections_count === "number"
      ? record.service_connections_count.toLocaleString()
      : null;

  const scaleSentence = (() => {
    if (pop && conn) {
      return `Serves about ${pop} people across ${conn} service connections.`;
    }
    if (pop) return `Serves about ${pop} people.`;
    if (conn) return `Has ${conn} service connections.`;
    return null;
  })();

  const protectionSentence =
    record.source_water_protection_code === "Y" &&
    typeof record.source_protection_begin_date === "string"
      ? `EPA-recognized source water protection program since ${formatYear(
          record.source_protection_begin_date,
        )}.`
      : null;

  const parts = [
    `${capitalize(sourceWord)} system on file with EPA.`,
    scaleSentence,
    protectionSentence,
  ].filter((p): p is string => p !== null && p.length > 0);

  return parts.join(" ");
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function formatYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 4);
  return String(d.getFullYear());
}

/**
 * Build the WQA findings payload + headline + summary for the
 * private_well branch.
 *
 * Source distinguishes user-declared (we trust the onboarding answer)
 * from epa-inferred (no polygon match and no onboarding signal). The
 * copy reads differently — confident vs. probabilistic — and the
 * activity log already narrates the why behind the routing, so the
 * payload just needs to match the tone.
 */
export function buildPrivateWellPayload(
  diagnostic: string,
  source: "user-declared" | "epa-inferred" = "epa-inferred",
): WqaPayload {
  const findings: WqaFindings = {
    branch: "private_well",
    branch_metadata: {
      branch: "private_well",
      is_active: false,
      system_type: null,
      admin_contact: null,
      diagnostic_note: diagnostic,
    },
  };
  if (source === "user-declared") {
    return {
      severity: NEUTRAL,
      headline: "Your home is on a private water system",
      summary:
        "Based on what you told us during onboarding, your home isn't on a " +
        "public water utility. The EPA doesn't monitor private wells or " +
        "shared private systems — testing is your responsibility, and " +
        "we'll add tailored private-system guidance in a future Hearth update.",
      findings,
    };
  }
  return {
    severity: NEUTRAL,
    headline: "You're likely on a private well",
    summary:
      "Your address doesn't appear in any EPA public water system service area, " +
      "which usually means you're on a private well. The EPA doesn't monitor " +
      "private wells — testing is your responsibility, and we'll add private-well " +
      "guidance in a future Hearth update.",
    findings,
  };
}

/**
 * Build the WQA findings payload + copy for the cws_unmapped branch
 * — the user told us during onboarding that they're on city water,
 * but EPA's national CWS service-area layer doesn't cover their
 * exact coordinates.
 *
 * No PWSID means no SDWIS data and no CCR cache lookup, so the
 * findings are minimal. WQA-3 will let these users upload a CCR
 * manually, which is the natural path forward.
 */
export function buildCwsUnmappedPayload(diagnostic: string): WqaPayload {
  const findings: WqaFindings = {
    branch: "cws_unmapped",
    branch_metadata: {
      branch: "cws_unmapped",
      // The user IS on an active utility, we just can't pinpoint it.
      // Marking is_active=true so any downstream surfaces that
      // condition on activity get the right answer.
      is_active: true,
      system_type: null,
      admin_contact: null,
      diagnostic_note: diagnostic,
    },
  };
  return {
    severity: NEUTRAL,
    headline: "We couldn't pinpoint your water utility on EPA's map",
    summary:
      "You told us during onboarding that you're on city water, but EPA's " +
      "national map of public water system service areas doesn't cover your " +
      "exact address. That's common — EPA has roughly six of every seven U.S. " +
      "addresses mapped, leaving rural fringes and recent annexations uncovered. " +
      "Once your utility publishes their annual Water Quality Report, you'll " +
      "be able to upload it here for personalized findings.",
    findings,
  };
}

/**
 * Build the WQA findings payload + copy for the 'stale' branch. The
 * diagnostic note travels into the findings shape so a developer
 * triaging the row in Supabase can see exactly what the module saw.
 */
export function buildStalePayload(diagnostic: string): WqaPayload {
  const findings: WqaFindings = {
    branch: "stale",
    branch_metadata: {
      branch: "stale",
      is_active: false,
      system_type: null,
      admin_contact: null,
      diagnostic_note: diagnostic,
    },
  };
  return {
    severity: NEUTRAL,
    headline: "Couldn't confirm your water system with EPA",
    summary:
      "We tried to look up your water system with EPA but the record came back " +
      "as inactive or unrecognized. This sometimes happens for newer addresses " +
      "or recent system changes. We'll try again on the next check.",
    findings,
  };
}

/**
 * SDWIS enrichment passed into buildSystemPayload alongside the EPA
 * inventory record. Both fields are optional — when WQA-2's fetch
 * paths soft-fail, the payload still renders, just with the
 * compliance_status_short stuck at "unknown" and the LCR summary set
 * to "unavailable".
 */
export type SdwisEnrichment = {
  compliance: ComplianceSummary | null;
  leadCopper: LeadCopperSummary;
};

/**
 * Severity decision for a CWS / non-community finding. Pure function
 * over the SDWIS enrichment so the decision is testable independently
 * of the rest of the payload assembly.
 *
 *   favorable — no active health-based violations AND every LCR
 *               sample on file is below the detection limit
 *               (sign='<'). The only state that earns the
 *               "your utility looks clean" framing — see issue #188.
 *   concern   — at least one active health-based violation OR an LCR
 *               90th-percentile at or above the federal action level.
 *   caution   — any detected lead or copper below the action level
 *               (sign='='|'>' with value > 0). Includes the
 *               approaching tier. Hearth's framing: EPA action levels
 *               are regulatory thresholds, not health-safety
 *               thresholds — any detection is worth surfacing.
 *   neutral   — everything else (compliance "unknown", LCR
 *               "unavailable", LCR "no_samples_on_file", or no
 *               positive signal on either axis).
 *
 * Note (#188): `has_active_non_health_based` is no longer a caution
 * driver. Monitoring/reporting violations are an EPA-utility
 * administrative concern, not a homeowner-relevant signal. The flag
 * stays persisted on system_card because `recommended-actions.ts`
 * reads it for its own card-emission logic.
 *
 * Exported for the test suite.
 */
export function deriveSeverity(input: SdwisEnrichment): HabitatSeverity {
  const compliance = input.compliance;
  const lcrInputs = computeLcrSeverityInputs(input.leadCopper);

  // concern wins immediately
  if (compliance?.has_active_health_based) return "concern";
  if (lcrInputs.lead_above_action || lcrInputs.copper_above_action) {
    return "concern";
  }
  // any detected lead or copper below the action level (sign='='|'>'
  // with positive value) → caution. Includes the approaching tier
  // by definition.
  if (lcrInputs.any_detected) return "caution";
  // favorable only when compliance is clean AND every sample on file
  // is below the detection limit. A utility with detected-but-low
  // measurements falls into caution above, not here.
  if (
    compliance?.status === "no_active_violations" &&
    lcrInputs.any_below_detection
  ) {
    return "favorable";
  }
  return NEUTRAL;
}

/**
 * Build the WQA findings payload + copy for a successful CWS or
 * non-community resolution. The shared payload between the two
 * branches is the same shape; only the copy and branch label differ.
 *
 * `enrichment` is the WQA-2 SDWIS data — when null on both fields the
 * payload still ships, just without compliance or LCR enrichment.
 *
 * `pwsidConfidence` carries the WQA-2 followup nearest-polygon fallback's
 * verdict: "verified" when EPA's point-in-polygon query matched the
 * user's exact coordinates, "inferred" when the 500m fallback found a
 * single dominant utility nearby. Defaults to "verified" for back-
 * compat with payload-build call sites that don't pass it.
 */
export function buildSystemPayload(
  branch: Extract<WqaBranch, "cws_no_ccr" | "non_community">,
  record: EnvirofactsWaterSystemRecord,
  enrichment: SdwisEnrichment = {
    compliance: null,
    leadCopper: { status: "unavailable" },
  },
  pwsidConfidence: "verified" | "inferred" = "verified",
  /**
   * Pre-computed WQA-4 recommended-action cards. Built by
   * recommended-actions.ts and passed in from `check()` so the
   * compute step can narrate the emitted IDs without
   * re-running the build. Empty array suppresses the payload field.
   */
  recommendedActions: WqaRecommendedAction[] = [],
): WqaPayload {
  const adminName = formatAdminName(record.admin_name ?? record.org_name);
  const systemName = displaySystemName(record);
  const adminContact = {
    name: adminName,
    email: record.email_addr ?? null,
    phone: record.phone_number ?? null,
  };
  const findings: WqaFindings = {
    branch,
    system_card: {
      pws_name: systemName,
      pwsid: record.pwsid,
      description: buildDescription(record),
      source_type: mapSourceType(record.gw_sw_code),
      compliance_status_short: enrichment.compliance?.status ?? "unknown",
      pwsid_confidence: pwsidConfidence,
      latest_ccr_status: "not_uploaded",
      source_water_protection_since:
        record.source_water_protection_code === "Y" &&
        typeof record.source_protection_begin_date === "string"
          ? record.source_protection_begin_date
          : null,
    },
    branch_metadata: {
      branch,
      is_active: true,
      system_type: record.pws_type_code,
      admin_contact: adminContact,
    },
    lead_copper_summary: enrichment.leadCopper,
  };

  // Persist the recommended-actions list only when at least one
  // action fired. Empty array → field omitted entirely so the UI's
  // section-suppression check stays simple.
  if (recommendedActions.length > 0) {
    findings.recommended_actions = recommendedActions;
  }

  // Surface the compact recent-violations block only when we
  // actually have a compliance summary — degraded runs leave the
  // field absent so the UI can distinguish "we tried and found
  // nothing recent" from "we couldn't read it".
  if (enrichment.compliance) {
    findings.system_card!.recent_violations = enrichment.compliance.recent;
    // Mirror the non-health-based active flag onto the persisted
    // system_card so the discovery-modal onboarding line can name
    // the actual flag driver. `compliance_status_short` is
    // health-based-only by design (see compliance.ts), so a
    // monitoring/reporting violation is invisible without this.
    findings.system_card!.has_active_non_health_based =
      enrichment.compliance.has_active_non_health_based;
  }

  const severity = deriveSeverity(enrichment);

  if (branch === "non_community") {
    return {
      severity,
      headline: `Your address is served by ${systemName}`,
      summary:
        `${systemName} is a non-community water system on file with EPA. ` +
        `Non-community systems serve places like schools, campgrounds, and ` +
        `small businesses — they're regulated but aren't required to publish ` +
        `an annual Consumer Confidence Report, so we'll lean on EPA's ` +
        `monitoring data instead in upcoming Hearth updates.`,
      findings,
    };
  }
  return {
    severity,
    headline: `Your water comes from ${systemName}`,
    summary: buildCwsSummary(systemName, enrichment),
    findings,
  };
}

/**
 * Compose the summary line for a CWS finding from the enrichment.
 * Stays short — one or two sentences — and degrades gracefully when
 * either compliance or LCR data is unavailable.
 *
 * Exported for the test suite.
 */
export function buildCwsSummary(
  systemName: string,
  enrichment: SdwisEnrichment,
): string {
  const compliance = enrichment.compliance;
  const lcr = enrichment.leadCopper;

  const complianceClause = (() => {
    if (!compliance) {
      return `We're still working on reading EPA's compliance record for ${systemName}.`;
    }
    if (compliance.status === "active_violations") {
      return `EPA shows at least one active health-based violation for ${systemName} right now.`;
    }
    if (compliance.recent.total_in_last_5_years === 0) {
      return `EPA shows no violations for ${systemName} in the last five years.`;
    }
    return `EPA shows no active health-based violations for ${systemName}; everything reported in the last five years has been resolved.`;
  })();

  const lcrClause = (() => {
    if (lcr.status === "available") {
      const p = lcr.most_recent_sampling_period;
      const lead = p.lead_90th_percentile;
      const copper = p.copper_90th_percentile;
      const summaryParts: string[] = [];
      if (lead) {
        if (lead.sign === "<") {
          summaryParts.push("lead below detection");
        } else if (lead.value >= 0.015) {
          summaryParts.push(`lead at or above the federal action level (${lead.value} ${lead.unit.toLowerCase()})`);
        } else {
          summaryParts.push(`lead below the federal action level (${lead.value} ${lead.unit.toLowerCase()})`);
        }
      }
      if (copper) {
        if (copper.sign === "<") {
          summaryParts.push("copper below detection");
        } else if (copper.value >= 1.3) {
          summaryParts.push(`copper at or above the federal action level (${copper.value} ${copper.unit.toLowerCase()})`);
        } else {
          summaryParts.push(`copper below the federal action level (${copper.value} ${copper.unit.toLowerCase()})`);
        }
      }
      if (summaryParts.length === 0) return "";
      return `Most recent lead-and-copper samples: ${summaryParts.join(" and ")}.`;
    }
    if (lcr.status === "no_samples_on_file") {
      return `EPA doesn't have lead-and-copper sample results on file for this utility yet — sampling schedules rotate, so that's not unusual.`;
    }
    return "";
  })();

  const ccrClause =
    `We'll layer in your utility's annual Water Quality Report next — once you have a recent copy, you'll be able to upload it here for a personalized read.`;

  return [complianceClause, lcrClause, ccrClause]
    .filter((p) => p.length > 0)
    .join(" ");
}
