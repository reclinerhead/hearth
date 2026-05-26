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
 * federal action level?". The summarizer preserves the system-level
 * caveat in the activity-log narration without burying the headline.
 */

import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";

export const LEAD_ACTION_LEVEL_MG_L = 0.015;
export const COPPER_ACTION_LEVEL_MG_L = 1.3;
export const APPROACHING_THRESHOLD_RATIO = 0.8;

export const LEAD_CONTAMINANT_CODE = "5000";
export const COPPER_CONTAMINANT_CODE = "1022";

export type LcrSign = "<" | "=" | ">";

export type LcrMeasurement = {
  value: number;
  unit: string;
  sign: LcrSign;
};

/**
 * One sampling-period summary on the payload — lead and copper
 * 90th-percentile values, or null when EPA's row for that contaminant
 * is missing in the period.
 */
export type LcrSamplingPeriod = {
  sampling_end_date: string; // ISO
  lead_90th_percentile: LcrMeasurement | null;
  copper_90th_percentile: LcrMeasurement | null;
};

/**
 * Persisted shape — discriminated union so the UI can render
 * three distinct empty/loaded states without scattered null checks.
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
 * measured equality.
 *
 * Exported for the test suite.
 */
export function normalizeSign(raw: string | null | undefined): LcrSign {
  if (raw === "<") return "<";
  if (raw === ">") return ">";
  return "=";
}

/**
 * Group LCR records by sampling period (sampling_end_date). Each
 * group holds at most one row per contaminant (lead, copper). Records
 * without a sample_measure or sampling_end_date are dropped.
 *
 * Exported for the test suite.
 */
export function groupLcrByPeriod(
  records: SdwisLcrSampleRecord[],
): Map<string, LcrSamplingPeriod> {
  const periods = new Map<string, LcrSamplingPeriod>();

  for (const r of records) {
    if (typeof r.sampling_end_date !== "string") continue;
    if (typeof r.sample_measure !== "number") continue;
    if (typeof r.contaminant_code !== "string") continue;

    const code = r.contaminant_code;
    if (code !== LEAD_CONTAMINANT_CODE && code !== COPPER_CONTAMINANT_CODE) {
      continue;
    }
    const periodKey = r.sampling_end_date;
    const measurement: LcrMeasurement = {
      value: r.sample_measure,
      unit:
        typeof r.unit_of_measure === "string" && r.unit_of_measure.length > 0
          ? r.unit_of_measure
          : "MG/L",
      sign: normalizeSign(r.result_sign_code),
    };
    const existing = periods.get(periodKey);
    if (existing) {
      if (code === LEAD_CONTAMINANT_CODE) existing.lead_90th_percentile = measurement;
      else existing.copper_90th_percentile = measurement;
    } else {
      periods.set(periodKey, {
        sampling_end_date: periodKey,
        lead_90th_percentile:
          code === LEAD_CONTAMINANT_CODE ? measurement : null,
        copper_90th_percentile:
          code === COPPER_CONTAMINANT_CODE ? measurement : null,
      });
    }
  }
  return periods;
}

/**
 * Pick the most recent sampling period from a grouped map. Ties on
 * date prefer the period with the most data populated (both lead and
 * copper > only one). Returns null when the map is empty.
 */
export function mostRecentPeriod(
  periods: Map<string, LcrSamplingPeriod>,
): LcrSamplingPeriod | null {
  let winner: LcrSamplingPeriod | null = null;
  let winnerDate = Number.NEGATIVE_INFINITY;
  for (const period of periods.values()) {
    const t = new Date(period.sampling_end_date).getTime();
    if (Number.isNaN(t)) continue;
    if (t > winnerDate) {
      winner = period;
      winnerDate = t;
    } else if (t === winnerDate && winner) {
      const winnerCount =
        (winner.lead_90th_percentile ? 1 : 0) +
        (winner.copper_90th_percentile ? 1 : 0);
      const candidateCount =
        (period.lead_90th_percentile ? 1 : 0) +
        (period.copper_90th_percentile ? 1 : 0);
      if (candidateCount > winnerCount) winner = period;
    }
  }
  return winner;
}

/**
 * Build the persisted lead/copper summary from a raw records array.
 */
export function summarizeLcr(
  records: SdwisLcrSampleRecord[],
): LeadCopperSummary {
  const periods = groupLcrByPeriod(records);
  if (periods.size === 0) {
    return { status: "no_samples_on_file" };
  }
  const winner = mostRecentPeriod(periods);
  if (!winner) {
    // Defensive — groupLcrByPeriod only produces entries with a
    // parseable sampling_end_date, but if every entry's date fails
    // to parse we report no samples rather than crash.
    return { status: "no_samples_on_file" };
  }
  return {
    status: "available",
    most_recent_sampling_period: winner,
    sampling_period_count: periods.size,
  };
}

/**
 * Severity inputs derived from a sampling period. The three flags
 * payload.ts reads to decide between favorable / caution / concern.
 *
 * - lead_above_action / copper_above_action: at-or-above the federal
 *   action level on a measured (sign='=' or '>') value. A below-
 *   detection ('<') row never trips these.
 * - any_approaching: at least 80% of the action level but below.
 * - any_below_action: at least one measurement strictly below the
 *   action level. Used together with the absence of above-action
 *   measurements to support "favorable".
 */
export type LcrSeverityInputs = {
  lead_above_action: boolean;
  copper_above_action: boolean;
  any_approaching: boolean;
  any_below_action: boolean;
};

export function computeLcrSeverityInputs(
  summary: LeadCopperSummary,
): LcrSeverityInputs {
  if (summary.status !== "available") {
    return {
      lead_above_action: false,
      copper_above_action: false,
      any_approaching: false,
      any_below_action: false,
    };
  }
  const p = summary.most_recent_sampling_period;
  let lead_above_action = false;
  let copper_above_action = false;
  let any_approaching = false;
  let any_below_action = false;

  const check = (m: LcrMeasurement | null, actionLevel: number, isLead: boolean) => {
    if (!m) return;
    // '<' (below detection) is always below the action level by
    // definition and is the strongest "favorable" signal.
    if (m.sign === "<") {
      any_below_action = true;
      return;
    }
    if (m.value >= actionLevel) {
      if (isLead) lead_above_action = true;
      else copper_above_action = true;
      return;
    }
    if (m.value >= actionLevel * APPROACHING_THRESHOLD_RATIO) {
      any_approaching = true;
    }
    any_below_action = true;
  };

  check(p.lead_90th_percentile, LEAD_ACTION_LEVEL_MG_L, true);
  check(p.copper_90th_percentile, COPPER_ACTION_LEVEL_MG_L, false);

  return {
    lead_above_action,
    copper_above_action,
    any_approaching,
    any_below_action,
  };
}
