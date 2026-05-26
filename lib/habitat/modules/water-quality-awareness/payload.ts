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
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";
import type { WqaBranch, WqaFindings } from "./types";

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
 */
export function buildPrivateWellPayload(diagnostic: string): WqaPayload {
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
 * Build the WQA findings payload + copy for a successful CWS or
 * non-community resolution. The shared payload between the two
 * branches is the same shape; only the copy and branch label differ.
 */
export function buildSystemPayload(
  branch: Extract<WqaBranch, "cws_no_ccr" | "non_community">,
  record: EnvirofactsWaterSystemRecord,
): WqaPayload {
  const adminName = formatAdminName(record.admin_name ?? record.org_name);
  const systemName = displaySystemName(record);
  const findings: WqaFindings = {
    branch,
    system_card: {
      pws_name: systemName,
      pwsid: record.pwsid,
      description: buildDescription(record),
      source_type: mapSourceType(record.gw_sw_code),
      compliance_status_short: "unknown",
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
      admin_contact: {
        name: adminName,
        email: record.email_addr ?? null,
        phone: record.phone_number ?? null,
      },
    },
  };
  if (branch === "non_community") {
    return {
      severity: NEUTRAL,
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
    severity: NEUTRAL,
    headline: `Your water comes from ${systemName}`,
    summary:
      `We found your water utility on file with EPA. We'll layer in compliance ` +
      `history and your utility's annual Water Quality Report in the next ` +
      `Hearth updates — once you have a Report, you'll be able to upload it ` +
      `here for a personalized read.`,
    findings,
  };
}
