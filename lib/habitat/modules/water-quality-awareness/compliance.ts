/**
 * Compliance summarization for the Water Quality Awareness module.
 *
 * Pure functions over an SdwisViolationRecord[] from EPA's VIOLATION
 * table. Produces:
 *   - `compliance_status_short` — the three-value summary the
 *     system_card surfaces.
 *   - `recent_violations` — counts + most-recent block for the UI.
 *
 * The framing: a homeowner looking at this surface wants to know
 * (1) is there an open compliance problem right now? and (2) is the
 * recent track record clean? "Recent" is fixed at five years in code
 * and surfaced in the activity log so the user understands the
 * window. The named constants below are greppable and testable.
 */

import { contaminantNameFromCode } from "./data/contaminant-codes";
import type { SdwisViolationRecord } from "./sources/sdwis-violations";

/**
 * Years of history considered "recent" for the system_card. Surfaced
 * in the activity-log narration so the homeowner sees the framing.
 */
export const COMPLIANCE_RECENT_YEARS = 5;

/**
 * Three-value compliance summary persisted on
 * `system_card.compliance_status_short`. WQA-1 always set this to
 * "unknown"; WQA-2 fills it from real data.
 */
export type ComplianceStatusShort =
  | "unknown"
  | "no_active_violations"
  | "active_violations";

/**
 * The compact summary the system_card surfaces. Mirrors the
 * `recent_violations` field type defined in types.ts; the exported
 * shape here is what compliance.ts produces and types.ts consumes.
 */
export type RecentViolationsSummary = {
  total_in_last_5_years: number;
  health_based_in_last_5_years: number;
  most_recent: {
    contaminant_name: string;
    contaminant_code: string;
    violation_type: string;
    is_health_based: boolean;
    first_reported_date: string;
    returned_to_compliance_date: string | null;
  } | null;
};

/**
 * Bundle returned by summarizeCompliance. The orchestrator-facing
 * payload builder routes these onto the system_card.
 */
export type ComplianceSummary = {
  status: ComplianceStatusShort;
  /** True when at least one violation in the input is currently active. */
  has_active_health_based: boolean;
  has_active_non_health_based: boolean;
  recent: RecentViolationsSummary;
};

/**
 * Whether a violation is currently active. Active = no
 * Return-to-Compliance date OR the RTC date is in the future. EPA
 * sometimes returns rtc_date in advance of an expected resolution;
 * treating future RTC dates as still-active reads more honestly than
 * declaring the system clean before the date arrives.
 *
 * Exported for the test suite.
 */
export function isActiveViolation(
  record: SdwisViolationRecord,
  now: Date = new Date(),
): boolean {
  if (typeof record.rtc_date !== "string") return true;
  const rtc = new Date(record.rtc_date);
  if (Number.isNaN(rtc.getTime())) return true;
  return rtc.getTime() > now.getTime();
}

/**
 * Whether a violation is health-based — EPA's Y/N flag.
 */
export function isHealthBased(record: SdwisViolationRecord): boolean {
  return record.is_health_based_ind === "Y";
}

/**
 * Pull the most-meaningful date out of a violation row. EPA usually
 * carries the same value in viol_first_reported_date and
 * compl_per_begin_date, but either can be null depending on the row.
 *
 * Exported for the test suite.
 */
export function violationReportedAt(
  record: SdwisViolationRecord,
): Date | null {
  const candidates = [
    record.viol_first_reported_date,
    record.compl_per_begin_date,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Summarize a violations[] payload into the compliance status + the
 * recent-violations block. Pure; given the same input + `now` it
 * always produces the same output.
 *
 * Inputs:
 *   records — the SDWIS VIOLATION rows for the PWSID. May be empty.
 *   now     — reference time. Injected so tests can pin "now".
 */
export function summarizeCompliance(
  records: SdwisViolationRecord[],
  now: Date = new Date(),
): ComplianceSummary {
  const recentCutoff = new Date(now);
  recentCutoff.setFullYear(recentCutoff.getFullYear() - COMPLIANCE_RECENT_YEARS);

  let activeHealth = 0;
  let activeOther = 0;
  let recentTotal = 0;
  let recentHealth = 0;

  let mostRecent: SdwisViolationRecord | null = null;
  let mostRecentAt: Date | null = null;

  for (const r of records) {
    const reportedAt = violationReportedAt(r);
    const active = isActiveViolation(r, now);
    const health = isHealthBased(r);

    if (active) {
      if (health) activeHealth++;
      else activeOther++;
    }

    if (reportedAt && reportedAt.getTime() >= recentCutoff.getTime()) {
      recentTotal++;
      if (health) recentHealth++;
      if (!mostRecentAt || reportedAt.getTime() > mostRecentAt.getTime()) {
        mostRecent = r;
        mostRecentAt = reportedAt;
      }
    }
  }

  const status: ComplianceStatusShort =
    activeHealth > 0 ? "active_violations" : "no_active_violations";

  const recent: RecentViolationsSummary = {
    total_in_last_5_years: recentTotal,
    health_based_in_last_5_years: recentHealth,
    most_recent:
      mostRecent && mostRecentAt
        ? {
            contaminant_name: contaminantNameFromCode(
              mostRecent.contaminant_code ?? null,
            ),
            contaminant_code: mostRecent.contaminant_code ?? "",
            violation_type:
              mostRecent.violation_category_code ?? "Violation",
            is_health_based: isHealthBased(mostRecent),
            first_reported_date: mostRecentAt.toISOString(),
            returned_to_compliance_date:
              typeof mostRecent.rtc_date === "string" ? mostRecent.rtc_date : null,
          }
        : null,
  };

  return {
    status,
    has_active_health_based: activeHealth > 0,
    has_active_non_health_based: activeOther > 0,
    recent,
  };
}

/**
 * Returns the count of distinct contaminant codes in the input that
 * aren't in the local table. The activity-log narration uses this as
 * a coverage diagnostic — "5 of 12 violations referenced unmapped
 * contaminant codes" tells future-us when to expand the table.
 *
 * Exported for the test suite.
 */
export function countUnmappedContaminants(
  records: SdwisViolationRecord[],
): number {
  const seen = new Set<string>();
  let unmapped = 0;
  for (const r of records) {
    const code = typeof r.contaminant_code === "string" ? r.contaminant_code : "";
    if (code.length === 0) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    // Re-read the lookup here rather than importing isKnownContaminantCode
    // — the inverse is the contaminantNameFromCode result, which renders
    // "Contaminant code N" for unmapped values.
    const name = contaminantNameFromCode(code);
    if (name === `Contaminant code ${code}`) unmapped++;
  }
  return unmapped;
}
