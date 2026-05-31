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
 *   maintenance_bridge — the AUTOMATIC card (WQA-6). Fires when the CCR
 *                        reported a cadence-relevant water property
 *                        (hardness at moderate-or-above, or detectable
 *                        iron/manganese). Names the properties and the
 *                        water-touching equipment whose upkeep cadence
 *                        Hearth shortens to match, and links to the
 *                        maintenance plan. The per-item cadence deltas
 *                        live on the maintenance side; surfacing them on
 *                        this card is a tracked follow-up.
 *
 * The system is additive: an action that doesn't fire is simply
 * absent from the output array. Section is suppressed when no
 * actions fire.
 */

import type { ComplianceSummary } from "./compliance";
import { computeLcrSeverityInputs, type LeadCopperSummary } from "./lcr";
import {
  recommendRemediationCombination,
  type DetectedContaminantInput,
} from "@/lib/habitat/water-quality/remediation/recommend";
import {
  waterPropertiesPhrase,
  type WaterProperties,
} from "./water-properties";
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
  /**
   * Contaminants detected for this house, normalized by the orchestrator
   * from the CCR contaminant table (cws_with_ccr) or the SDWIS lead/
   * copper samples (cws_no_ccr / non_community). Drives the contaminant-
   * specific filter recommendation in WQA-5 — when populated, the
   * pitcher_filter card names the under-sink carbon block, its NSF
   * certifications, and exactly which detected contaminants it covers,
   * via `recommendRemediationCombination`. Empty on branches with no
   * detection data; the card then falls back to the tier-tuned LCR copy.
   */
  detectedContaminants?: DetectedContaminantInput[];
  /**
   * Water-touching properties (hardness, iron, manganese) read from the
   * CCR (WQA-6). Drives the `maintenance_bridge` AUTOMATIC card. Absent
   * on branches with no CCR or when the CCR didn't print them.
   */
  waterProperties?: WaterProperties | null;
};

// The CTA label the pitcher_filter card carries to open the in-modal
// remediation matrix. Lives here so the test and the renderer agree.
const MATRIX_CTA_LABEL = "See your full remediation matrix";

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
  if (shouldEmitMaintenanceBridge(input)) {
    out.push(buildMaintenanceBridgeAction(input.waterProperties!));
  }

  return out;
}

/**
 * Whether to emit the maintenance-bridge (AUTOMATIC) card. True when the
 * CCR reported a cadence-relevant water property — hardness at moderate-
 * or-above, or detectable iron/manganese (WQA-6). False on every branch
 * with no CCR, and on CCRs that don't print these secondary parameters.
 *
 * Exported for the test suite.
 */
export function shouldEmitMaintenanceBridge(
  input: RecommendedActionsInputs,
): boolean {
  return input.waterProperties?.affects_maintenance ?? false;
}

function buildMaintenanceBridgeAction(
  properties: WaterProperties,
): WqaRecommendedAction {
  const phrase = waterPropertiesPhrase(properties);
  return {
    id: "maintenance_bridge",
    icon: "tool",
    headline: "Maintenance adjusted for your water",
    supporting_line:
      `Your Water Quality Report shows ${phrase}. Hearth has shortened the ` +
      `upkeep cadence on your water-touching equipment — water heater, water ` +
      `softener, dishwasher, and faucet aerators — to match, so they last ` +
      `longer.`,
    automatic: true,
    link: { label: "See your maintenance plan", url: "/maintenance" },
  };
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
  // WQA-5: any CCR-detected contaminant is a filtration signal, not
  // just lead/copper — the matrix shows the user what addresses it.
  if ((input.detectedContaminants?.length ?? 0) > 0) return true;
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
  // WQA-5: when we have a detected-contaminant set that maps onto the
  // remediation matrix, the card becomes contaminant-specific — it
  // names the under-sink carbon block, the NSF certifications it should
  // carry, and exactly which detected contaminants it covers. Falls
  // back to the tier-tuned LCR copy below when nothing maps (e.g.
  // copper-only on cws_no_ccr, which has no matrix row).
  const detected = input.detectedContaminants ?? [];
  if (detected.length > 0) {
    const contaminantAction = buildContaminantSpecificFilterAction(detected);
    if (contaminantAction) return contaminantAction;
  }

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
    // WQA-5: open the in-modal remediation matrix from here. The matrix
    // carries the NSF/ANSI explainer and the certified-product browse
    // link, so this card no longer needs an external link of its own.
    matrix_cta: MATRIX_CTA_LABEL,
  };
}

/**
 * The contaminant-specific filter card (WQA-5). Returns null when none
 * of the detected contaminants map onto a matrix row — the caller then
 * falls back to the tier-tuned LCR copy. Built from
 * `recommendRemediationCombination`, so the "addresses N of M" framing,
 * the cert list (NSF/ANSI 53, + P473 when PFAS is present), and the
 * covered-contaminant names all stay consistent with the matrix view.
 */
function buildContaminantSpecificFilterAction(
  detected: DetectedContaminantInput[],
): WqaRecommendedAction | null {
  const combo = recommendRemediationCombination(detected);
  // Nothing mapped onto the matrix (e.g. copper-only) → let the caller
  // fall back to the LCR copy.
  if (combo.primary.detected_count === 0) return null;

  const certs = combo.primary.nsf_standards.join(" + ");
  const headline = `Install a ${certs} certified under-sink filter`;

  const { covered_count, detected_count, covered } = combo.primary;
  const coveredList = formatNameList(covered);

  let supporting: string;
  if (covered_count === 0) {
    // Detected contaminants exist but carbon block fully covers none of
    // them (e.g. fluoride-only). Point at the matrix for what does.
    supporting =
      `We detected ${countNoun(detected_count, "contaminant")} in your water, ` +
      `but a carbon-block filter isn't the right tool for ${
        detected_count === 1 ? "it" : "them"
      }. See the remediation matrix for what addresses your specific contaminants.`;
  } else {
    const coverageClause =
      covered_count === detected_count
        ? `addresses ${allOrBothNoun(covered_count)} of the detected contaminants at your house`
        : `addresses ${covered_count} of the ${detected_count} detected contaminants at your house`;
    supporting =
      `A single carbon-block filter with these certifications ${coverageClause}: ${coveredList}.`;
  }

  // The lead caveat only applies when lead is actually in the detected
  // set — whole-house filters can't reach lead that enters downstream
  // of the meter. Append it so the user understands the under-sink
  // (point-of-use) recommendation isn't arbitrary.
  const hasLead = combo.primary.covered.includes("Lead");
  if (hasLead) {
    supporting +=
      " Whole-house filters can't help with lead, which enters from your " +
      "service line and household plumbing downstream of treatment — so " +
      "the filter goes at the tap you drink from.";
  }

  return {
    id: "pitcher_filter",
    icon: "filter",
    headline,
    supporting_line: supporting,
    matrix_cta: MATRIX_CTA_LABEL,
  };
}

/** "lead, TTHMs, and PFAS" — Oxford-comma name list. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function countNoun(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "all" reads better than "5 of 5"; "both" for exactly two. */
function allOrBothNoun(n: number): string {
  if (n === 2) return "both";
  return "all";
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
