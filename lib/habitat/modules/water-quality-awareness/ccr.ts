/**
 * CCR-to-findings summarizer for the Water Quality Awareness module.
 *
 * Pure: takes a validated `CcrExtractionResult` (the JSONB stored on
 * `hearth.water_system_reports.extracted_data`) and produces the
 * `ccr_findings` fragment that the orchestrator drops onto the WQA
 * payload. No I/O, no model calls — same discipline as `compliance.ts`
 * and `lcr.ts`.
 *
 * The summarizer is deliberately thin. Most of the structured CCR data
 * is already in the right shape for the findings view to render
 * directly; the summarizer's job is:
 *
 *   1. Compute the per-contaminant tier (`concern` / `caution` /
 *      `context`) using the simple "% of MCL" rule and the PFAS-at-any-
 *      level rule. Mirrors the severity escalation logic so the UI
 *      ordering matches what `deriveSeverity` decided.
 *   2. Sort the detected contaminants by tier (concern → caution →
 *      context), preserving the within-tier ordering from the
 *      extraction so the findings view can render straight off the
 *      array.
 *   3. Surface the lead / copper LCR distribution and UCMR results in
 *      their persisted shape — no transformation needed.
 *   4. Surface the free-testing-offer flag and contact so the
 *      awareness payload's free-testing affordance can render.
 *
 * Anything beyond that is for the findings view itself to compute at
 * render time.
 */

import type {
  CcrExtractionResult,
  CcrDetectedContaminant,
  CcrLeadCopperDistribution,
  CcrUcmrResult,
  CcrFreeTestingOffer,
} from "@/lib/documents/ai/ccr-schema";

/**
 * Tier classification for one CCR-detected contaminant. Mirrors the
 * severity tiers `deriveSeverity` uses so the findings view's row
 * ordering matches the tile severity badge.
 *
 *   concern — At or above the MCL (the federal limit).
 *   caution — At 80%+ of MCL but below; OR PFAS at any detection
 *             level (the federal PFAS MCLs are so low that any
 *             detection is meaningful homeowner context).
 *   context — Detected but below the caution threshold. "Worth
 *             knowing" rather than "worth acting on."
 */
export type CcrContaminantTier = "concern" | "caution" | "context";

/**
 * One summarized contaminant row. Mirrors the extraction shape
 * one-for-one but adds the tier classification.
 */
export type CcrSummarizedContaminant = CcrDetectedContaminant & {
  tier: CcrContaminantTier;
};

/**
 * Persisted CCR findings fragment. Lands on
 * `WqaFindings.ccr_findings` and is rendered by the WQA-4 overview
 * body in the findings view's "Detected in your water" section.
 *
 * Every field is optional / nullable so a partial extraction (some
 * sections null) still produces a valid payload — the schema allows
 * partial extractions explicitly.
 */
export type CcrFindings = {
  /**
   * The coverage year of the report this summary was derived from.
   * Drives the "Based on 2024 CCR" caption in the findings view.
   * Null when the extraction couldn't read the year (rare).
   */
  report_year: number | null;
  /**
   * The utility's publication date as printed in the CCR, when
   * available. Null when the document doesn't state one unambiguously.
   */
  published_date: string | null;
  /**
   * Detected contaminants, sorted concern → caution → context.
   * Empty array when the extraction returned no detected contaminants
   * (a clean CCR is a positive signal — the findings view renders
   * a "no measurable detections" copy variant from the empty array).
   * Null when the extraction couldn't read the contaminants table at
   * all (degraded mode — the UI renders a "couldn't read this section"
   * affordance).
   */
  contaminants: CcrSummarizedContaminant[] | null;
  /**
   * Lead and copper distribution as extracted. Surfaces the 90th
   * percentile values, sample counts, and lead-service-line count
   * verbatim — the findings view formats them. Null when the CCR
   * had no LCR section or the extraction couldn't read it.
   */
  lead_copper_distribution: CcrLeadCopperDistribution | null;
  /**
   * UCMR results when the CCR includes them inline. Null when the
   * CCR omits UCMR (common — many utilities don't surface UCMR in
   * their CCR even though they report it to EPA).
   */
  ucmr_results: CcrUcmrResult[] | null;
  /**
   * Free in-home residential testing offer. Drives the awareness
   * payload's free-testing affordance card. Null when the CCR says
   * nothing about free testing or only offers paid testing.
   */
  free_testing_offer: CcrFreeTestingOffer | null;
  /**
   * Overall extraction confidence. Below 0.3 the findings view
   * surfaces a "this extraction looked rough, want to retry?"
   * affordance instead of the standard layout.
   */
  ai_confidence: number;
};

/**
 * PFAS detection at any level escalates a contaminant to "caution".
 * EPA's recent PFAS MCLs are sub-part-per-trillion; any detection is
 * meaningful homeowner context, so we don't gate on MCL ratio for
 * this family.
 *
 * Matched against the contaminant name with a case-insensitive
 * substring check. PFAS naming is wildly inconsistent across CCRs
 * (PFOA, PFOS, GenX, HFPO-DA, PFBA, …); rather than enumerate every
 * known compound, we recognize the family by the "PF" prefix and a
 * couple of well-known aliases.
 *
 * Exported for the test suite.
 */
export const PFAS_NAME_HINTS = [
  "pfas",
  "pfoa",
  "pfos",
  "pfba",
  "pfhxs",
  "pfna",
  "genx",
  "hfpo-da",
  "perfluoro",
];

/**
 * Threshold at which a non-PFAS contaminant escalates to "caution".
 * Matches the threshold used in the LCR axis classification — a CCR
 * row at 80%+ of MCL reads as "approaching the federal limit".
 */
export const CAUTION_RATIO = 0.8;

/**
 * Classify one contaminant row. Pure.
 *
 * Logic:
 *   * Any PFAS detection at any level → caution.
 *   * detected_level / mcl >= 1.0 → concern.
 *   * detected_level / mcl >= 0.8 → caution.
 *   * Otherwise → context.
 *
 * When MCL is null or detected_level is null we can't compute the
 * ratio; default to "context" because "we couldn't compare to the
 * limit" reads more honestly than upgrading to caution by default.
 *
 * Exported for the test suite.
 */
export function classifyContaminantTier(
  contaminant: CcrDetectedContaminant,
): CcrContaminantTier {
  const name = contaminant.contaminant_name.toLowerCase();
  const isPfas =
    contaminant.detected_level !== null &&
    contaminant.detected_level > 0 &&
    PFAS_NAME_HINTS.some((hint) => name.includes(hint));
  if (isPfas) return "caution";

  const level = contaminant.detected_level;
  const mcl = contaminant.mcl ?? contaminant.mcl_action_level;
  if (level === null || mcl === null || mcl <= 0) {
    return "context";
  }
  const ratio = level / mcl;
  if (ratio >= 1) return "concern";
  if (ratio >= CAUTION_RATIO) return "caution";
  return "context";
}

const TIER_ORDER: Record<CcrContaminantTier, number> = {
  concern: 0,
  caution: 1,
  context: 2,
};

/**
 * Build the persisted `ccr_findings` fragment from an extracted CCR
 * row. Pure.
 *
 * The `report_year` and `published_date` arguments come from the
 * `water_system_reports` row, not from `extractedData.header_metadata`
 * — the persisted row's coverage year is the authoritative one
 * (`finalize-ccr-upload` resolves the year before persistence; the
 * extracted header is informational and can be null).
 */
export function buildCcrFindings(input: {
  reportYear: number;
  publishedDate: string | null;
  extractedData: CcrExtractionResult;
}): CcrFindings {
  const { reportYear, publishedDate, extractedData } = input;

  const contaminants: CcrSummarizedContaminant[] | null =
    extractedData.detected_contaminants === null
      ? null
      : extractedData.detected_contaminants
          .map((c) => ({ ...c, tier: classifyContaminantTier(c) }))
          // Stable sort by tier; within tier preserve extraction order.
          // The findings view renders concern rows first, then caution,
          // then context — same ordering the tile severity badge uses.
          .map((c, idx) => ({ c, idx }))
          .sort((a, b) => {
            const tierDiff = TIER_ORDER[a.c.tier] - TIER_ORDER[b.c.tier];
            if (tierDiff !== 0) return tierDiff;
            return a.idx - b.idx;
          })
          .map(({ c }) => c);

  return {
    report_year: reportYear,
    published_date: publishedDate,
    contaminants,
    lead_copper_distribution: extractedData.lead_copper_distribution,
    ucmr_results: extractedData.ucmr_results,
    free_testing_offer: extractedData.free_testing_offer,
    ai_confidence: extractedData.ai_confidence,
  };
}

/**
 * Whether the CCR findings carry a signal that escalates severity to
 * `'concern'`. Used by `deriveSeverity` to layer CCR data on top of
 * the SDWIS-derived signals.
 *
 * Returns true when any detected contaminant is at or above its MCL.
 */
export function ccrHasConcernSignal(findings: CcrFindings): boolean {
  if (!findings.contaminants) return false;
  return findings.contaminants.some((c) => c.tier === "concern");
}

/**
 * Whether the CCR findings carry a signal that escalates severity to
 * `'caution'`. Used by `deriveSeverity` alongside `ccrHasConcernSignal`.
 *
 * Returns true when any contaminant lands in the caution tier — that
 * includes the >=80%-of-MCL case AND the PFAS-at-any-level case.
 */
export function ccrHasCautionSignal(findings: CcrFindings): boolean {
  if (!findings.contaminants) return false;
  return findings.contaminants.some((c) => c.tier === "caution");
}
