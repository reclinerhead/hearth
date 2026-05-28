/**
 * "Recommended for your situation" cards for the WQA module.
 *
 * Pure functions over the WQA-2 data signals — the compliance summary,
 * the lead/copper severity inputs, and the admin contact populated
 * from the WATER_SYSTEM record. The output is persisted into the
 * findings payload by `check()` so the renderOverviewBody slot is a
 * pure read.
 *
 * Three v1 action types (issue #171):
 *
 *   pitcher_filter   — fires when compliance shows an active health-
 *                      based violation OR LCR data shows any approach-
 *                      ing or above-action measurement. Names a single
 *                      NSF/ANSI 53-certified carbon block as the broad-
 *                      coverage starting recommendation. WQA-5's
 *                      remediation matrix will replace this with a
 *                      contaminant-specific recommendation.
 *
 *   free_testing     — fires when the admin contact on the WATER_SYSTEM
 *                      record has a phone_number populated, suggesting
 *                      the user can call the utility directly to ask
 *                      about free residential water testing programs.
 *                      v1 uses contact presence as a heuristic; WQA-3's
 *                      CCR extraction will replace this with extracted
 *                      facts ("Kalamazoo offers free testing through X
 *                      program" — language pulled from the CCR).
 *
 *   maintenance_bridge — fires when there's a maintenance-bridge to
 *                        surface (a water-touching item whose cadence
 *                        was adjusted by WQA-derived properties).
 *                        v1 is suppressed — WQA-6 builds the bridges.
 *                        The empty-state activity-log narration still
 *                        fires so the user sees what's coming.
 *
 * The system is additive: an action that doesn't fire is simply
 * absent from the output array. Section is suppressed when no
 * actions fire.
 */

import type { ComplianceSummary } from "./compliance";
import { computeLcrSeverityInputs, type LeadCopperSummary } from "./lcr";
import type { WqaRecommendedAction } from "./types";

/**
 * Inputs to the recommended-actions computation. Pure, so tests don't
 * have to mock the orchestrator.
 *
 *   compliance     — null when the SDWIS violations fetch failed in
 *                    soft-fail mode. Some actions still fire on null
 *                    (free_testing); others are suppressed.
 *   leadCopper     — the LCR summary; mirrors `findings.lead_copper_summary`.
 *   adminContact   — `branch_metadata.admin_contact`; mirrors the
 *                    Envirofacts admin record. Drives the free_testing
 *                    card's phone number.
 *   systemName     — display name for the utility ("Kalamazoo Public
 *                    Water Supply"). Used in copy; safe to pass empty
 *                    if unknown.
 */
export type RecommendedActionsInputs = {
  compliance: ComplianceSummary | null;
  leadCopper: LeadCopperSummary;
  adminContact: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  systemName: string;
};

/**
 * Build the recommended-actions list for a finding. Pure.
 *
 * Order matters for surface ranking — pitcher_filter goes first when
 * it fires (it's the most actionable signal), then free_testing.
 * Maintenance-bridge would slot between them but is suppressed
 * pending WQA-6.
 *
 * Exported for the test suite.
 */
export function buildRecommendedActions(
  input: RecommendedActionsInputs,
): WqaRecommendedAction[] {
  const out: WqaRecommendedAction[] = [];

  if (shouldEmitPitcherFilter(input)) {
    out.push(buildPitcherFilterAction(input));
  }
  if (shouldEmitFreeTesting(input)) {
    out.push(buildFreeTestingAction(input));
  }
  // maintenance_bridge intentionally suppressed in v1. WQA-6 ships it.

  return out;
}

/**
 * Whether to emit the pitcher_filter card. True when:
 *   - compliance shows an active health-based violation, OR
 *   - LCR data shows any detected lead or copper (sign='='|'>'
 *     with value > 0), regardless of where the measurement sits
 *     relative to the EPA action level.
 *
 * Aligned with the #188 severity model: any detection is worth a
 * filter recommendation because EPA's action level is a regulatory
 * cutoff, not a health-safety one, and household-plumbing lead can
 * exceed system-wide samples regardless. False when LCR is
 * unavailable / no-samples-on-file AND compliance is clean — no
 * actionable signal to recommend filtration against.
 *
 * Exported for the test suite.
 */
export function shouldEmitPitcherFilter(
  input: RecommendedActionsInputs,
): boolean {
  if (input.compliance?.has_active_health_based) return true;
  const lcr = computeLcrSeverityInputs(input.leadCopper);
  return lcr.any_detected;
}

/**
 * Whether to emit the free_testing card. True when the admin contact
 * has a phone_number populated. Heuristic — the real signal in
 * WQA-3+ will come from CCR extraction. False when admin contact is
 * null (rare; small rural utilities sometimes lack contact records)
 * or the phone field is absent.
 *
 * Exported for the test suite.
 */
export function shouldEmitFreeTesting(
  input: RecommendedActionsInputs,
): boolean {
  return Boolean(input.adminContact?.phone);
}

function buildPitcherFilterAction(
  input: RecommendedActionsInputs,
): WqaRecommendedAction {
  const compliance = input.compliance;
  const lcrInputs = computeLcrSeverityInputs(input.leadCopper);

  // Tune the supporting line to the strongest signal — health-based
  // violations are the heaviest, then above-action, then approaching,
  // then sub-approaching detection (#188).
  let supporting: string;
  if (compliance?.has_active_health_based) {
    supporting =
      "Your utility has an active health-based violation right now. " +
      "A faucet-mount or pitcher filter certified to NSF/ANSI 53 is the " +
      "fastest mitigation while the violation is open.";
  } else if (lcrInputs.lead_above_action || lcrInputs.copper_above_action) {
    supporting =
      "Your utility's most recent lead-and-copper sampling shows a " +
      "measurement at or above the federal action level. A faucet-" +
      "mount filter certified to NSF/ANSI 53 for lead reduction is the " +
      "broad-coverage starting point — we'll get more specific once " +
      "your annual Water Quality Report is uploaded.";
  } else if (lcrInputs.any_approaching) {
    supporting =
      "Your utility's most recent lead-and-copper sampling is below " +
      "the federal action level but approaching it. A faucet-mount " +
      "filter certified to NSF/ANSI 53 is inexpensive insurance and " +
      "addresses lead from your own household plumbing (which the " +
      "utility's sampling doesn't directly measure).";
  } else {
    supporting =
      "Your utility's most recent lead-and-copper sampling detected " +
      "lead or copper at sub-regulatory levels. EPA's action level is " +
      "a regulatory threshold, not a health-safety one — any presence " +
      "is worth knowing about. A faucet-mount filter certified to " +
      "NSF/ANSI 53 also addresses lead from your own household " +
      "plumbing, which the utility's sampling doesn't directly measure.";
  }

  return {
    id: "pitcher_filter",
    icon: "droplet",
    headline: "Consider a faucet-mount or pitcher filter",
    supporting_line: supporting,
    // WQA-5's remediation matrix will provide a contaminant-specific
    // product link. For now, the EPA NSF/ANSI 53 page is the
    // authoritative jumping-off point.
    link: {
      label: "What NSF/ANSI 53 means",
      url: "https://www.epa.gov/sites/default/files/2015-11/documents/2005_11_17_faq_fs_healthseries_filtration.pdf",
    },
  };
}

function buildFreeTestingAction(
  input: RecommendedActionsInputs,
): WqaRecommendedAction {
  const phone = input.adminContact!.phone!; // shouldEmit guards this
  const adminName = input.adminContact?.name?.trim();
  const utility = input.systemName || "your water utility";
  const contactClause = adminName
    ? `Call ${adminName} at ${phone}`
    : `Call ${phone}`;

  // Provenance attribution. Telling a user to call a specific person
  // and phone number without explaining where we got those reads as
  // "Hearth knows a guy" — the provenance line makes it clear we
  // pulled the contact from EPA's public administrator-on-file
  // record, which is the same source every other utility customer
  // could look up themselves.
  const provenance = adminName
    ? `${adminName} is listed as ${utility}'s administrator of record on EPA's Envirofacts WATER_SYSTEM file. The phone number is the one EPA has on file for the utility.`
    : `The phone number is the one EPA has on file for ${utility} in its Envirofacts WATER_SYSTEM record.`;

  return {
    id: "free_testing",
    icon: "phone",
    headline: "Ask your utility about free residential testing",
    supporting_line:
      `${contactClause} to ask if ${utility} offers free in-home water ` +
      `testing — many utilities do, especially for lead and copper, and ` +
      `most don't advertise it on the bill.`,
    provenance,
  };
}
