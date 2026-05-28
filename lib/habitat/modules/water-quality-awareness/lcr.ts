/**
 * Lead and Copper Rule sample summarization for the Water Quality
 * Awareness module.
 *
 * Pure functions over an SdwisLcrSampleRecord[] from EPA's
 * LCR_SAMPLE_RESULT table. Produces the `lead_copper_summary`
 * discriminated union that lands on the findings payload, plus the
 * severity-relevant signals payload.ts reads to decide between
 * favorable / caution / concern.
 *
 * Three load-bearing constants:
 *   - Lead action level: 0.015 mg/L (15 ppb)
 *   - Copper action level: 1.3 mg/L
 *   - 80% approach threshold: triggers "caution" rather than
 *     "favorable" when a measurement falls between 80% and 100%
 *     of the action level.
 *
 * EPA enforces compliance at the 90th-percentile *system rollup*
 * level — these are the samples we pull from LCR_SAMPLE_RESULT — but
 * the homeowner-meaningful framing is "is the measurement above the
 * federal action level?". Each row in EPA's LCR_SAMPLE_RESULT table
 * is one monitoring round's 90th-percentile rollup, not a single
 * home's sample.
 *
 * -------------------------------------------------------------------
 * Two things about EPA's LCR endpoint that the WQA-2 spec got wrong;
 * surfaced by real Kalamazoo data:
 *
 * 1. **Contaminant codes are PB90 / CU90, not 5000 / 1022.** The
 *    LCR_SAMPLE_RESULT table uses dataset-specific codes for the
 *    90th-percentile rollup ("PB90" for lead, "CU90" for copper).
 *    The general SDWIS contaminant codes (5000 for lead, 1022 for
 *    copper) live in the VIOLATION table and don't apply here.
 *
 * 2. **EPA's JSON endpoint omits sampling_start_date and
 *    sampling_end_date.** The full SDWIS schema has them, but the
 *    `data.epa.gov/efservice/LCR_SAMPLE_RESULT` endpoint doesn't
 *    return them in the JSON payload. Without dates we can't group
 *    by "sampling period" — we order by sample_id instead. EPA's
 *    sample_id is state-prefixed and ascending (e.g. MI207485 →
 *    MI381874 for Kalamazoo), so an alphabetical sort within a
 *    single PWSID equates to chronological order.
 * -------------------------------------------------------------------
 */

import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";

export const LEAD_ACTION_LEVEL_MG_L = 0.015;
export const COPPER_ACTION_LEVEL_MG_L = 1.3;
export const APPROACHING_THRESHOLD_RATIO = 0.8;

/**
 * EPA's LCR_SAMPLE_RESULT contaminant codes. NOT the same as the
 * general SDWIS codes used in the VIOLATION table.
 */
export const LEAD_CONTAMINANT_CODE = "PB90";
export const COPPER_CONTAMINANT_CODE = "CU90";

export type LcrSign = "<" | "=" | ">";

export type LcrMeasurement = {
  value: number;
  unit: string;
  sign: LcrSign;
  /**
   * EPA's sample_id for this measurement — opaque string like
   * "MI381874". Persisted on the payload so future UI can link back
   * to the specific monitoring round (or just show users the EPA
   * reference for the displayed value).
   */
  sample_id: string;
};

/**
 * Joint snapshot of the most-recent lead and copper measurements.
 * Lead and copper are tracked independently from EPA's perspective
 * (PB90 and CU90 are separate row streams, often submitted on
 * different schedules), so this "period" isn't a true physical
 * monitoring round — it's just "what we know right now for each
 * contaminant." Either field can be null when EPA has no rows for
 * that contaminant on this system.
 *
 * `sampling_end_date` is nullable because EPA's endpoint doesn't
 * return dates today. The field stays in the schema so a future
 * EPA-side fix (or a different endpoint) can populate it without a
 * payload migration.
 */
export type LcrSamplingPeriod = {
  sampling_end_date: string | null;
  lead_90th_percentile: LcrMeasurement | null;
  copper_90th_percentile: LcrMeasurement | null;
};

/**
 * Persisted shape — discriminated union so the UI can render
 * three distinct empty/loaded states without scattered null checks.
 *
 *   no_samples_on_file — EPA returned zero rows (rotating sampling
 *                        schedule, or no LCR data for this system).
 *   unavailable        — the LCR fetch failed in soft-fail mode.
 *   available          — at least one PB90 or CU90 row found.
 *                        most_recent_sampling_period carries the
 *                        latest lead and copper values; either can
 *                        be null if EPA has none of that contaminant.
 *                        sampling_period_count is the total row count
 *                        across both contaminants.
 */
export type LeadCopperSummary =
  | { status: "no_samples_on_file" }
  | { status: "unavailable" }
  | {
      status: "available";
      most_recent_sampling_period: LcrSamplingPeriod;
      sampling_period_count: number;
    };

/**
 * Coerce EPA's result_sign_code to the three-state union the
 * payload uses. Anything other than '<' or '>' is treated as a
 * measured equality. EPA returns null on most LCR rows, which lands
 * here as "=" by design.
 *
 * Exported for the test suite.
 */
export function normalizeSign(raw: string | null | undefined): LcrSign {
  if (raw === "<") return "<";
  if (raw === ">") return ">";
  return "=";
}

/**
 * Build a single measurement object from one EPA row. Returns null
 * when the row is too incomplete to be useful — missing the numeric
 * measure, the sample_id, or has no contaminant_code we recognize.
 *
 * Exported for the test suite.
 */
export function toMeasurement(
  r: SdwisLcrSampleRecord,
): LcrMeasurement | null {
  if (typeof r.sample_measure !== "number") return null;
  if (typeof r.sample_id !== "string" || r.sample_id.length === 0) return null;
  return {
    value: r.sample_measure,
    unit:
      typeof r.unit_of_measure === "string" && r.unit_of_measure.length > 0
        ? r.unit_of_measure
        : "MG/L",
    sign: normalizeSign(r.result_sign_code),
    sample_id: r.sample_id,
  };
}

/**
 * Find the most-recent PB90 (lead) and CU90 (copper) rows from a
 * raw records array. Returns separate measurements rather than a
 * jointly-grouped period because EPA's LCR endpoint doesn't expose
 * which monitoring round each row came from — they're independent
 * streams ordered by sample_id.
 *
 * Exported for the test suite.
 */
export function pickMostRecentMeasurements(
  records: SdwisLcrSampleRecord[],
): {
  lead: LcrMeasurement | null;
  copper: LcrMeasurement | null;
  totalSampleCount: number;
} {
  let lead: { measurement: LcrMeasurement; sampleId: string } | null = null;
  let copper: { measurement: LcrMeasurement; sampleId: string } | null = null;
  let totalSampleCount = 0;

  for (const r of records) {
    if (typeof r.contaminant_code !== "string") continue;
    if (
      r.contaminant_code !== LEAD_CONTAMINANT_CODE &&
      r.contaminant_code !== COPPER_CONTAMINANT_CODE
    ) {
      continue;
    }
    const m = toMeasurement(r);
    if (!m) continue;
    totalSampleCount += 1;

    const slot = r.contaminant_code === LEAD_CONTAMINANT_CODE ? lead : copper;
    if (!slot || m.sample_id > slot.sampleId) {
      const next = { measurement: m, sampleId: m.sample_id };
      if (r.contaminant_code === LEAD_CONTAMINANT_CODE) lead = next;
      else copper = next;
    }
  }

  return {
    lead: lead?.measurement ?? null,
    copper: copper?.measurement ?? null,
    totalSampleCount,
  };
}

/**
 * Build the persisted lead/copper summary from a raw records array.
 */
export function summarizeLcr(
  records: SdwisLcrSampleRecord[],
): LeadCopperSummary {
  const { lead, copper, totalSampleCount } = pickMostRecentMeasurements(records);
  if (lead === null && copper === null) {
    return { status: "no_samples_on_file" };
  }
  return {
    status: "available",
    most_recent_sampling_period: {
      // EPA's endpoint doesn't return sampling dates today. The field
      // stays in the schema so a future EPA-side change (or a richer
      // endpoint) can populate it without a payload migration.
      sampling_end_date: null,
      lead_90th_percentile: lead,
      copper_90th_percentile: copper,
    },
    sampling_period_count: totalSampleCount,
  };
}

/**
 * Severity inputs derived from the most-recent measurements. The
 * flags payload.ts reads to decide between favorable / caution /
 * concern.
 *
 * - lead_above_action / copper_above_action: at-or-above the federal
 *   action level on a measured (sign='=' or '>') value. A below-
 *   detection ('<') row never trips these.
 * - any_approaching: at least 80% of the action level but below
 *   (sign='='|'>'). Subset of `any_detected`.
 * - any_detected: at least one positive measurement (sign='='|'>'
 *   with value > 0) regardless of its position relative to the
 *   action level. This is the signal Hearth surfaces as "lead has
 *   been detected" — see issue #188. Any detection is worth knowing
 *   about because EPA action levels are regulatory thresholds, not
 *   health-safety ones.
 * - any_below_detection: at least one measurement strictly below the
 *   detection limit (sign='<'). Reserved for the "favorable" case —
 *   a utility where every sample is below detection.
 */
export type LcrSeverityInputs = {
  lead_above_action: boolean;
  copper_above_action: boolean;
  any_approaching: boolean;
  any_detected: boolean;
  any_below_detection: boolean;
};

export function computeLcrSeverityInputs(
  summary: LeadCopperSummary,
): LcrSeverityInputs {
  if (summary.status !== "available") {
    return {
      lead_above_action: false,
      copper_above_action: false,
      any_approaching: false,
      any_detected: false,
      any_below_detection: false,
    };
  }
  const p = summary.most_recent_sampling_period;
  let lead_above_action = false;
  let copper_above_action = false;
  let any_approaching = false;
  let any_detected = false;
  let any_below_detection = false;

  const check = (m: LcrMeasurement | null, actionLevel: number, isLead: boolean) => {
    if (!m) return;
    if (m.sign === "<") {
      // Below detection limit — the cleanest signal.
      any_below_detection = true;
      return;
    }
    // sign === '=' or '>' with a positive value → the contaminant
    // was detected at some level. Tier within the detection bucket
    // (above action / approaching / sub-approaching) lands below.
    if (m.value > 0) {
      any_detected = true;
    }
    if (m.value >= actionLevel) {
      if (isLead) lead_above_action = true;
      else copper_above_action = true;
      return;
    }
    if (m.value >= actionLevel * APPROACHING_THRESHOLD_RATIO) {
      any_approaching = true;
    }
  };

  check(p.lead_90th_percentile, LEAD_ACTION_LEVEL_MG_L, true);
  check(p.copper_90th_percentile, COPPER_ACTION_LEVEL_MG_L, false);

  return {
    lead_above_action,
    copper_above_action,
    any_approaching,
    any_detected,
    any_below_detection,
  };
}

/**
 * Per-metal classification of the most-recent LCR measurements for
 * copy-layer use (issue #186, extended by #188). Sibling helper to
 * `computeLcrSeverityInputs` — same input, same thresholds, but
 * per-metal granularity so the onboarding-line builder can
 * distinguish "lead detected" from "lead approaching the action
 * level" from "lead at or above" without recomputing the thresholds
 * itself.
 *
 * Per-metal states (highest concern to lowest):
 *   above       — measurement at or above the federal action level.
 *   approaching — measurement between 80% and 100% of the action level.
 *   detected    — measurement strictly below 80% but positive
 *                 (sign='='|'>' with value > 0). Worth surfacing
 *                 because EPA's action level is a regulatory cutoff,
 *                 not a health-safety one — see #188.
 *   below       — measurement strictly below the detection limit
 *                 (sign='<'). The only state that supports favorable.
 *   absent      — EPA has no row of this contaminant for this system.
 *
 * Returns `{ kind: 'unknown' }` when LCR data isn't available
 * (`status !== 'available'`) — callers should drop any LCR clause
 * from their copy rather than fabricate a positive.
 */
export type LcrMetalState =
  | "above"
  | "approaching"
  | "detected"
  | "below"
  | "absent";
export type LcrAxisClassification =
  | { kind: "available"; lead: LcrMetalState; copper: LcrMetalState }
  | { kind: "unknown" };

function classifyMeasurement(
  m: LcrMeasurement | null,
  actionLevel: number,
): LcrMetalState {
  if (!m) return "absent";
  if (m.sign === "<") return "below";
  if (m.value >= actionLevel) return "above";
  if (m.value >= actionLevel * APPROACHING_THRESHOLD_RATIO) return "approaching";
  // Defensive: a sign='=' / '>' measurement of exactly zero is
  // semantically the same as below the detection limit. EPA wouldn't
  // normally send this combination — they'd use sign='<' instead —
  // but treating zero as below detection is the honest fallback.
  if (m.value <= 0) return "below";
  // Positive value strictly below the approaching threshold — the
  // contaminant is present at a sub-regulatory level. Worth
  // surfacing under Hearth's "any detection is worth knowing" frame.
  return "detected";
}

export function classifyLcrAxis(
  summary: LeadCopperSummary,
): LcrAxisClassification {
  if (summary.status !== "available") return { kind: "unknown" };
  const p = summary.most_recent_sampling_period;
  return {
    kind: "available",
    lead: classifyMeasurement(p.lead_90th_percentile, LEAD_ACTION_LEVEL_MG_L),
    copper: classifyMeasurement(
      p.copper_90th_percentile,
      COPPER_ACTION_LEVEL_MG_L,
    ),
  };
}
