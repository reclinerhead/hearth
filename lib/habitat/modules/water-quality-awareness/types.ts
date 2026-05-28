/**
 * Persisted findings shape for the Water Quality Awareness module.
 *
 * Lives on hearth.habitat_findings.findings (JSONB) under
 * module_key='water_quality_awareness'. Phase 1 (WQA-1) shipped the
 * Tier 1 surface (system identity + branch metadata). Phase 2 (WQA-2)
 * adds compliance status enrichment + the lead_copper_summary block,
 * plus the PWSID-resolution-confidence axis for the nearest-polygon
 * fallback. WQA-3 will populate latest-CCR metadata. Optional fields
 * exist in the type so later phases don't require a payload version
 * bump.
 */

import type { LeadCopperSummary } from "./lcr";
import type { RecentViolationsSummary } from "./compliance";
import type { CcrFindings } from "./ccr";

/**
 * How confidently the module identified the user's water utility.
 * Travels alongside the branch decision through `check()` and lands
 * on the persisted payload as `system_card.pwsid_confidence`.
 *
 *   verified — EPA's point-in-polygon query returned a match at the
 *              user's exact coordinates. The PWSID is authoritative.
 *   inferred — The direct query came up empty, but the nearest-polygon
 *              fallback (~500m radius) found a single utility nearby.
 *              SDWIS data fetches run against this PWSID with the
 *              confidence flag carried alongside; future UI can render
 *              an "is this right?" affordance.
 *   unmapped — Neither the direct query nor the fallback resolved a
 *              PWSID with confidence. Either zero polygons within the
 *              radius or multiple competing utilities. No PWSID is
 *              available for downstream SDWIS / CCR work.
 */
export type PwsidResolution =
  | { confidence: "verified"; pwsid: string; pwsName: string | null }
  | { confidence: "inferred"; pwsid: string; pwsName: string | null }
  | { confidence: "unmapped" };

/**
 * Which of the six branches the module's check() landed in. The UI
 * uses this to pick between the variants of the system card, and the
 * activity log narrates the decision against it.
 *
 *   private_well   — User declared `water_source = 'well'` (or 'shared')
 *                    during onboarding, OR water_source is unknown/null
 *                    AND no CWS polygon covers the house's coordinates.
 *                    Trusted user input takes precedence over EPA mapping.
 *   cws_unmapped   — User declared `water_source = 'municipal'` but
 *                    EPA's national CWS service-area layer doesn't cover
 *                    the house's exact coordinates. Common — EPA's map
 *                    has roughly 6 of every 7 U.S. addresses, leaving
 *                    rural fringes and recent annexations uncovered.
 *                    We can't pull a PWSID without a polygon match, so
 *                    SDWIS / CCR features are unavailable; the user can
 *                    still upload a CCR manually in WQA-3+.
 *   stale          — PWSID resolved but Envirofacts has no record or
 *                    the system's activity_code != 'A'.
 *   non_community  — Active TNCWS or NTNCWS. CCR not federally required.
 *   cws_no_ccr     — Active CWS, no shared CCR cached yet (Phase 1 baseline).
 *   cws_with_ccr   — Active CWS with a CCR available. Reachable when WQA-3 ships.
 */
export type WqaBranch =
  | "private_well"
  | "cws_unmapped"
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
     * Whether the system has at least one currently-active non-health-based
     * (monitoring / reporting) violation. Tracked separately because
     * `compliance_status_short` is health-based-only by design — the
     * homeowner-facing "is there an active compliance issue?" surface
     * doesn't escalate on paperwork lapses. The discovery-modal
     * onboarding line (issue #186) reads this to distinguish a clean
     * utility from one with an active non-health-based violation, so the
     * line can name the actual flag driver when severity is `caution`.
     *
     * Populated by WQA-2's compliance summarization. Absent on payloads
     * persisted before #186 (back-compat: callers treat `undefined` as
     * `false`).
     */
    has_active_non_health_based?: boolean;
    /**
     * How confidently the module resolved the PWSID for this finding.
     * Present on cws_no_ccr / non_community / cws_with_ccr branches;
     * absent on cws_unmapped, private_well, and stale (where no PWSID
     * is available). Back-compat for payloads persisted before the
     * nearest-polygon fallback shipped: a missing value should be
     * treated as "verified" (the only behavior that existed pre-#169
     * follow-up).
     */
    pwsid_confidence?: "verified" | "inferred";
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
   * Structured CCR findings derived from the shared `water_system_reports`
   * cache. Populated only on the `cws_with_ccr` branch — when a CCR has
   * been uploaded for the resolved PWSID and the orchestrator's cache
   * lookup hit. The findings view's "Detected in your water" section
   * reads the contaminant array off this field; the awareness payload's
   * free-testing affordance reads `free_testing_offer`.
   *
   * Absent on every branch where the CCR cache didn't hit (cws_no_ccr,
   * cws_unmapped, non_community, stale, private_well). Issue #176 (WQA-3).
   */
  ccr_findings?: CcrFindings;

  /**
   * "Recommended for your situation" cards, computed at check() time
   * from the SDWIS data signals and persisted on the row so the UI
   * (renderOverviewBody, see lib/habitat/modules/water-quality-
   * awareness/components/overview-body.tsx) is a pure read.
   *
   * Shape mirrors the generic recommended-action shape used by
   * Superfund's getRecommendedActions slot — same icon name + plain
   * text + optional link contract so the modal renderers can share
   * a card primitive in the future.
   *
   * Empty array suppresses the section entirely. Issue #171 (WQA-4)
   * defines the three v1 action types (pitcher filter, free testing,
   * maintenance bridge — the last suppressed until WQA-6).
   */
  recommended_actions?: WqaRecommendedAction[];

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

/**
 * One "Recommended for your situation" card on the WQA payload. The
 * three v1 action types — pitcher filter, free testing, and the
 * (currently suppressed) maintenance bridge — all conform to this
 * shape. The `id` is stable and human-readable so a future
 * notifications layer can reference "the user already saw the
 * filter recommendation, don't surface it again."
 *
 * `provenance` is an optional muted-text line rendered below
 * `supporting_line`. Use it when the card mentions a specific
 * person, phone number, or other data point a homeowner would
 * reasonably ask "wait, where did that come from?" about — the
 * free_testing card uses it to attribute James Baker / the phone
 * number to EPA Envirofacts so we're not telling people to call a
 * stranger without context.
 */
export type WqaRecommendedAction = {
  id: string;
  icon: string;
  headline: string;
  supporting_line: string;
  provenance?: string;
  link?: { label: string; url: string };
};
