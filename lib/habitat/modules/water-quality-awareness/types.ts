/**
 * Persisted findings shape for the Water Quality Awareness module.
 *
 * Lives on hearth.habitat_findings.findings (JSONB) under
 * module_key='water_quality_awareness'. Phase 1 (WQA-1) shipped the
 * Tier 1 surface (system identity + branch metadata). Phase 2 (WQA-2)
 * adds compliance status enrichment + the lead_copper_summary block.
 * WQA-3 will populate latest-CCR metadata. Optional fields exist in
 * the type so later phases don't require a payload version bump.
 */

import type { LeadCopperSummary } from "./lcr";
import type { RecentViolationsSummary } from "./compliance";

/**
 * Which of the five branches the module's check() landed in. The UI
 * uses this to pick between the variants of the system card, and the
 * activity log narrates the decision against it.
 *
 *   private_well   — no CWS polygon covers the house's coordinates.
 *   stale          — PWSID resolved but Envirofacts has no record or
 *                    the system's activity_code != 'A'.
 *   non_community  — Active TNCWS or NTNCWS. CCR not federally required.
 *   cws_no_ccr     — Active CWS, no shared CCR cached yet (Phase 1 baseline).
 *   cws_with_ccr   — Active CWS with a CCR available. Reachable when WQA-3 ships.
 */
export type WqaBranch =
  | "private_well"
  | "stale"
  | "non_community"
  | "cws_no_ccr"
  | "cws_with_ccr";

/**
 * Shape persisted to habitat_findings.findings. Phase 1 fields are
 * required; later-phase fields are optional and absent today.
 */
export type WqaFindings = {
  branch: WqaBranch;

  /**
   * Compact system-identity payload that drives the "Your water system"
   * card. Absent when the branch is private_well (no system to
   * describe) or stale (we tried but didn't get a usable record).
   */
  system_card?: {
    pws_name: string;
    pwsid: string;
    description: string;
    source_type: "groundwater" | "surface" | "groundwater_under_surface" | "unknown";
    /**
     * Three-state sentinel set from EPA SDWIS violations (WQA-2). Stays
     * "unknown" when the violations fetch failed in soft-fail mode, so
     * the UI can distinguish "we tried and EPA was clean" from "we
     * couldn't tell".
     */
    compliance_status_short:
      | "unknown"
      | "no_active_violations"
      | "active_violations";
    /**
     * Compact summary of compliance history over the last 5 years.
     * Populated by WQA-2 when the violations fetch succeeded; absent
     * when compliance_status_short is "unknown" (degraded mode) or
     * when the branch doesn't fetch SDWIS data (private_well / stale).
     */
    recent_violations?: RecentViolationsSummary;
    /**
     * Phase 1 always sets this to "not_uploaded". WQA-3 will set it
     * to a year value when a CCR is available for the system. The
     * field exists today so the UI shape stays stable.
     */
    latest_ccr_status: "not_uploaded" | { year: number };
    source_water_protection_since: string | null;
  };

  /**
   * Lead and Copper Rule sample summary for the system. Discriminated
   * union: "no_samples_on_file" / "unavailable" / "available". Populated
   * by WQA-2 on CWS and non-community branches; absent on private_well
   * and stale.
   */
  lead_copper_summary?: LeadCopperSummary;

  /**
   * Branch-specific metadata. Populated for every branch; the UI uses
   * it to drive copy choices and "find your CCR" surfaces.
   */
  branch_metadata: {
    branch: WqaBranch;
    is_active: boolean;
    system_type: string | null;
    admin_contact: {
      name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
    /**
     * On the stale and private_well branches, the diagnostic note
     * surfaced in the activity log and the system card explains
     * exactly what the module saw — "Envirofacts returned an empty
     * array", "pws_activity_code = 'I'", "no CWS polygon at this
     * point". Absent on the happy paths.
     */
    diagnostic_note?: string;
  };
};
