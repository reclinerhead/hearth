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
import {
  COPPER_ACTION_LEVEL_MG_L,
  LEAD_ACTION_LEVEL_MG_L,
  type LeadCopperSummary,
} from "./lcr";

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
 * one-for-one but adds the tier classification and a grouping shape
 * that lets one row represent multiple observations of the same
 * analyte (issue #200 — same analyte reported under different
 * monitoring programs, e.g. UCMR5 + utility routine).
 *
 * For single-observation analytes (the overwhelming majority),
 * `has_multiple_observations` is false and `other_observations` is
 * an empty array — the type stays uniform so the findings view
 * can branch on the flag without narrowing.
 */
export type CcrSummarizedContaminant = CcrDetectedContaminant & {
  tier: CcrContaminantTier;
  has_multiple_observations: boolean;
  other_observations: CcrDetectedContaminant[];
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
 * The `detected_level / mcl` ratio used as the within-tier sort signal
 * (issue #199). Mirrors the comparator inside `classifyContaminantTier`:
 * `mcl_action_level` substitutes when the row uses an action level
 * (lead / copper LCR pattern); a missing or non-positive limit yields
 * null so the caller can fall back to extraction order.
 *
 * Exported for the test suite.
 */
export function mclRatio(c: CcrDetectedContaminant): number | null {
  const level = c.detected_level;
  const limit = c.mcl ?? c.mcl_action_level;
  if (level === null || limit === null || limit <= 0) return null;
  return level / limit;
}

/**
 * Normalize a contaminant name into a grouping key (issue #200).
 *
 * Day-one rule: trim + lowercase. This works for the Kalamazoo PFAS
 * case where each analyte's printed name is consistent across both
 * tables (PFBS / PFHxS / PFHxA / PFOA / PFOS). A canonical-code
 * lookup against `data/contaminant-codes.ts` is the eventual upgrade
 * for cross-utility aliasing edge cases.
 *
 * Exported for the test suite.
 */
export function normalizeContaminantGroupKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Extract the highest 4-digit year from a CCR monitoring_period
 * string. CCR conventions vary wildly ("2024", "2023-2024", "Q3 2024",
 * "Annual 2023") so we pick the latest year mentioned — the recency
 * signal for `display_observation` selection within a multi-observation
 * group. Returns null when no plausible year is present.
 *
 * Exported for the test suite.
 */
export function extractMostRecentYear(period: string | null): number | null {
  if (period === null) return null;
  const matches = period.match(/\b(?:19|20|21)\d{2}\b/g);
  if (!matches || matches.length === 0) return null;
  return Math.max(...matches.map((s) => Number.parseInt(s, 10)));
}

/**
 * Extract the earliest 4-digit year from a CCR monitoring_period
 * string. Used as the secondary recency signal: when two observations
 * share the same end-year (e.g. "2024" vs "2023-2024" both end in
 * 2024), the one with the higher start year is the more-recent
 * observation. Returns null when no plausible year is present.
 *
 * Exported for the test suite.
 */
export function extractEarliestYear(period: string | null): number | null {
  if (period === null) return null;
  const matches = period.match(/\b(?:19|20|21)\d{2}\b/g);
  if (!matches || matches.length === 0) return null;
  return Math.min(...matches.map((s) => Number.parseInt(s, 10)));
}

/**
 * Whether an observation reads like a running-annual-average
 * measurement. CCRs label these inconsistently ("Highest Running
 * Annual Average", "RAA", "HRAA"); we match against the period,
 * notes, and source_table_label combined.
 *
 * Used as the tiebreaker when two observations share the same most-
 * recent year — RAA is the regulatory-relevant headline value, so
 * it wins the display slot.
 */
function looksLikeRunningAnnualAverage(c: CcrDetectedContaminant): boolean {
  const haystack = [c.monitoring_period, c.notes, c.source_table_label]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes("running annual average") ||
    /\braa\b/.test(haystack) ||
    /\bhraa\b/.test(haystack)
  );
}

/**
 * Choose which observation in a multi-observation group becomes the
 * `display_observation` (the one whose values headline the card and
 * drive tier classification).
 *
 * Rule (issue #200, deliberate call — see open question 1):
 *   1. Highest end-year in monitoring_period.
 *   2. Tie → highest start-year (so "2024" beats "2023-2024" when
 *      both end in 2024, because the single-year observation is
 *      narrower / more-recent).
 *   3. Tie → running-annual-average observation (regulatory headline).
 *   4. Further tie → first encountered in extraction order.
 *
 * Returns an index into the input array.
 */
function chooseDisplayObservationIndex(rows: CcrDetectedContaminant[]): number {
  type Score = { endYear: number; startYear: number; isRaa: boolean };
  const score = (row: CcrDetectedContaminant): Score => ({
    endYear: extractMostRecentYear(row.monitoring_period) ?? -Infinity,
    startYear: extractEarliestYear(row.monitoring_period) ?? -Infinity,
    isRaa: looksLikeRunningAnnualAverage(row),
  });
  let best = 0;
  let bestScore = score(rows[0]);
  for (let i = 1; i < rows.length; i++) {
    const s = score(rows[i]);
    if (s.endYear !== bestScore.endYear) {
      if (s.endYear > bestScore.endYear) {
        best = i;
        bestScore = s;
      }
      continue;
    }
    if (s.startYear !== bestScore.startYear) {
      if (s.startYear > bestScore.startYear) {
        best = i;
        bestScore = s;
      }
      continue;
    }
    if (s.isRaa && !bestScore.isRaa) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Build the persisted `ccr_findings` fragment from an extracted CCR
 * row. Pure.
 *
 * Issue #200 — group by normalized contaminant name BEFORE tiering
 * and sorting. Multi-observation groups (same analyte reported in
 * two or more tables, e.g. UCMR5 + utility routine) collapse into a
 * single summarized row whose `display_observation` drives tier and
 * sort, with the remaining observations preserved on
 * `other_observations`. Single-observation contaminants are unchanged
 * in shape, tier, and sort order.
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
      : groupAndSummarizeContaminants(extractedData.detected_contaminants);

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

function groupAndSummarizeContaminants(
  rows: CcrDetectedContaminant[],
): CcrSummarizedContaminant[] {
  // Group by normalized contaminant name, recording the first-
  // occurrence extraction index so within-tier sort order remains
  // deterministic and aligned with what the model emitted.
  const groups = new Map<
    string,
    { firstIdx: number; rows: CcrDetectedContaminant[] }
  >();
  rows.forEach((row, idx) => {
    const key = normalizeContaminantGroupKey(row.contaminant_name);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { firstIdx: idx, rows: [row] });
    }
  });

  // Summarize each group: pick a display observation, classify and
  // sort on THAT row only (so an analyte tiers once, not N times).
  const summarized = Array.from(groups.values()).map(({ firstIdx, rows: groupRows }) => {
    if (groupRows.length === 1) {
      const only = groupRows[0];
      return {
        firstIdx,
        summarized: {
          ...only,
          tier: classifyContaminantTier(only),
          has_multiple_observations: false,
          other_observations: [],
        } satisfies CcrSummarizedContaminant,
      };
    }
    const displayIdx = chooseDisplayObservationIndex(groupRows);
    const display = groupRows[displayIdx];
    const others = groupRows.filter((_, i) => i !== displayIdx);
    return {
      firstIdx,
      summarized: {
        ...display,
        tier: classifyContaminantTier(display),
        has_multiple_observations: true,
        other_observations: others,
      } satisfies CcrSummarizedContaminant,
    };
  });

  // Sort by tier (concern → caution → context) so the findings view
  // renders the most-actionable rows first, matching the tile severity
  // badge's ordering. Within a tier, sort by `detected_level / mcl`
  // descending (issue #199) so the worst exceedance floats up — a row
  // at 95% of MCL surfaces above a row at 81% regardless of the order
  // the model emitted them. Rows whose ratio is uncomputable (no MCL
  // on the row, or detected_level is null) sink below ratio'd rows in
  // the same tier, ordered by extraction order amongst themselves.
  return summarized
    .sort((a, b) => {
      const tierDiff =
        TIER_ORDER[a.summarized.tier] - TIER_ORDER[b.summarized.tier];
      if (tierDiff !== 0) return tierDiff;
      const ratioA = mclRatio(a.summarized);
      const ratioB = mclRatio(b.summarized);
      if (ratioA === null && ratioB === null) return a.firstIdx - b.firstIdx;
      if (ratioA === null) return 1;
      if (ratioB === null) return -1;
      if (ratioA !== ratioB) return ratioB - ratioA;
      return a.firstIdx - b.firstIdx;
    })
    .map(({ summarized }) => summarized);
}

/**
 * The COMPLETE list of detected contaminants to show a homeowner from a
 * CCR — issue #224.
 *
 * A CCR reports detections across three sections, and the findings
 * view's `contaminants` array only carries the first:
 *   - the regulated-contaminant table (`contaminants`);
 *   - the Lead-and-Copper-Rule distribution (`lead_copper_distribution`)
 *     — lead/copper are printed apart from the regulated table;
 *   - the UCMR block (`ucmr_results`) — PFAS is monitored under UCMR and
 *     printed in its own section.
 * Rendering only `contaminants` made lead and PFAS vanish from the
 * "Detected in your water" panel the moment a CCR was uploaded, even
 * though they were extracted and persisted. This folds the lead/copper
 * and detected-UCMR rows into the displayed list, deduped by name and
 * re-sorted with the same tier → ratio comparator the regulated rows
 * use. Pure; the persisted `contaminants` array is unchanged (the
 * remediation matrix's `deriveDetectedContaminants` reads all three
 * sections itself, so we must NOT pre-merge into the stored payload).
 *
 * `lcrFallback` is the SDWIS lead/copper summary; it backs lead/copper
 * when the CCR didn't print its own distribution. Detected lead/copper
 * are floored at the `caution` tier per the #188 decision ("any
 * detected lead/copper is worth knowing — EPA's action level is a
 * regulatory threshold, not a health-safety one"), so they surface as
 * headline rows rather than sinking into the low-level disclosure.
 */
export function buildDisplayedCcrContaminants(
  ccr: CcrFindings,
  lcrFallback: LeadCopperSummary | null,
): CcrSummarizedContaminant[] {
  const base = ccr.contaminants ?? [];
  const seen = new Set(
    base.map((c) => normalizeContaminantGroupKey(c.contaminant_name)),
  );
  const extra: CcrSummarizedContaminant[] = [];

  // UCMR section — PFAS and other unregulated monitoring. Include only
  // positively-detected rows (null / zero level is a monitored-but-clean
  // row). PFAS tiers to `caution` via the PFAS name hint already.
  for (const u of ccr.ucmr_results ?? []) {
    if (u.detected_level === null || u.detected_level <= 0) continue;
    const key = normalizeContaminantGroupKey(u.contaminant_name);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(
      makeSynthesizedContaminant({
        name: u.contaminant_name,
        detected_level: u.detected_level,
        unit: u.unit,
        monitoring_period: u.monitoring_period,
      }),
    );
  }

  // Lead and copper — from the CCR's own distribution, falling back to
  // EPA's LCR samples.
  for (const metal of ["lead", "copper"] as const) {
    const synthesized = synthesizeMetalRow(
      metal,
      ccr.lead_copper_distribution,
      lcrFallback,
    );
    if (!synthesized) continue;
    const key = normalizeContaminantGroupKey(synthesized.contaminant_name);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(synthesized);
  }

  if (extra.length === 0) return base;

  // Re-sort the combined list with the same comparator the regulated
  // rows were sorted by (tier asc, then detected/limit ratio desc, then
  // stable by position).
  return [...base, ...extra]
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const tierDiff = TIER_ORDER[a.c.tier] - TIER_ORDER[b.c.tier];
      if (tierDiff !== 0) return tierDiff;
      const ratioA = mclRatio(a.c);
      const ratioB = mclRatio(b.c);
      if (ratioA === null && ratioB === null) return a.idx - b.idx;
      if (ratioA === null) return 1;
      if (ratioB === null) return -1;
      if (ratioA !== ratioB) return ratioB - ratioA;
      return a.idx - b.idx;
    })
    .map(({ c }) => c);
}

/**
 * Build a single-observation summarized row from synthesized values
 * (lead/copper distribution or a UCMR row). `caution_floor` raises a
 * detected row that would otherwise tier as `context` up to `caution`
 * — used for lead/copper per #188.
 */
function makeSynthesizedContaminant(args: {
  name: string;
  detected_level: number | null;
  unit: string | null;
  mcl_action_level?: number | null;
  monitoring_period?: string | null;
  caution_floor?: boolean;
}): CcrSummarizedContaminant {
  const base: CcrDetectedContaminant = {
    contaminant_name: args.name,
    contaminant_code: null,
    detected_level: args.detected_level,
    unit: args.unit,
    mcl: null,
    mclg: null,
    mcl_action_level: args.mcl_action_level ?? null,
    sources: null,
    monitoring_period: args.monitoring_period ?? null,
    violation_in_period_ind: null,
    notes: null,
    source_table_label: null,
  };
  let tier = classifyContaminantTier(base);
  if (
    args.caution_floor &&
    args.detected_level !== null &&
    args.detected_level > 0 &&
    tier === "context"
  ) {
    tier = "caution";
  }
  return {
    ...base,
    tier,
    has_multiple_observations: false,
    other_observations: [],
  };
}

/**
 * Collapse a CCR lead/copper monitoring period to its year (issue #245).
 * Lead and copper are sampled twice a year under the Lead and Copper
 * Rule, so the distribution's `monitoring_period` frequently concatenates
 * both semi-annual rounds (e.g. "Jan 1-Jun 30, 2024 July 1-Dec 31, 2024").
 * The "Detected in your water" list renders the period verbatim, so we
 * reduce it to the most-recent year — matching the single-year suffix
 * every other contaminant in that list already shows. Stays null when no
 * year is parseable, which the display layer renders as no suffix.
 */
function leadCopperPeriodYear(period: string | null): string | null {
  const year = extractMostRecentYear(period);
  return year === null ? null : String(year);
}

/**
 * A synthesized lead or copper row, preferring the CCR's own
 * distribution and falling back to the SDWIS LCR samples. Null when
 * neither source has a positive detection.
 */
function synthesizeMetalRow(
  metal: "lead" | "copper",
  distribution: CcrLeadCopperDistribution | null,
  lcrFallback: LeadCopperSummary | null,
): CcrSummarizedContaminant | null {
  const name = metal === "lead" ? "Lead" : "Copper";
  const actionLevel =
    metal === "lead" ? LEAD_ACTION_LEVEL_MG_L : COPPER_ACTION_LEVEL_MG_L;

  const entry = distribution?.[metal] ?? null;
  if (entry && entry.percentile_90 !== null && entry.percentile_90 > 0) {
    return makeSynthesizedContaminant({
      name,
      detected_level: entry.percentile_90,
      unit: entry.unit,
      mcl_action_level: entry.action_level ?? actionLevel,
      monitoring_period: leadCopperPeriodYear(entry.monitoring_period),
      caution_floor: true,
    });
  }

  if (lcrFallback && lcrFallback.status === "available") {
    const measurement =
      metal === "lead"
        ? lcrFallback.most_recent_sampling_period.lead_90th_percentile
        : lcrFallback.most_recent_sampling_period.copper_90th_percentile;
    if (measurement && measurement.sign !== "<" && measurement.value > 0) {
      return makeSynthesizedContaminant({
        name,
        detected_level: measurement.value,
        unit: measurement.unit,
        mcl_action_level: actionLevel,
        caution_floor: true,
      });
    }
  }

  return null;
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
