import { describe, expect, it } from "vitest";
import {
  computeLcrSeverityInputs,
  COPPER_ACTION_LEVEL_MG_L,
  COPPER_CONTAMINANT_CODE,
  groupLcrByPeriod,
  LEAD_ACTION_LEVEL_MG_L,
  LEAD_CONTAMINANT_CODE,
  mostRecentPeriod,
  normalizeSign,
  summarizeLcr,
} from "./lcr";
import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";

function sample(
  overrides: Partial<SdwisLcrSampleRecord> = {},
): SdwisLcrSampleRecord {
  return {
    pwsid: "MI0003520",
    sample_id: "S1",
    contaminant_code: LEAD_CONTAMINANT_CODE,
    sampling_start_date: "2024-01-01T00:00:00Z",
    sampling_end_date: "2024-06-30T00:00:00Z",
    sample_measure: 0.005,
    unit_of_measure: "MG/L",
    result_sign_code: "=",
    ...overrides,
  };
}

describe("normalizeSign", () => {
  it("returns < or > or = based on EPA's sign code", () => {
    expect(normalizeSign("<")).toBe("<");
    expect(normalizeSign(">")).toBe(">");
    expect(normalizeSign("=")).toBe("=");
    expect(normalizeSign(null)).toBe("=");
    expect(normalizeSign("ZZ")).toBe("=");
  });
});

describe("groupLcrByPeriod", () => {
  it("groups lead and copper rows in the same sampling period", () => {
    const periods = groupLcrByPeriod([
      sample({ sample_id: "L", contaminant_code: LEAD_CONTAMINANT_CODE, sample_measure: 0.005 }),
      sample({
        sample_id: "C",
        contaminant_code: COPPER_CONTAMINANT_CODE,
        sample_measure: 0.2,
      }),
    ]);
    expect(periods.size).toBe(1);
    const period = periods.values().next().value!;
    expect(period.lead_90th_percentile?.value).toBe(0.005);
    expect(period.copper_90th_percentile?.value).toBe(0.2);
  });

  it("ignores rows for contaminants that aren't lead or copper", () => {
    const periods = groupLcrByPeriod([
      sample({ contaminant_code: "1005" /* arsenic */ }),
    ]);
    expect(periods.size).toBe(0);
  });

  it("ignores rows without a sample_measure or sampling_end_date", () => {
    expect(
      groupLcrByPeriod([sample({ sample_measure: null })]).size,
    ).toBe(0);
    expect(
      groupLcrByPeriod([sample({ sampling_end_date: null })]).size,
    ).toBe(0);
  });
});

describe("mostRecentPeriod", () => {
  it("returns the period with the latest sampling_end_date", () => {
    const periods = groupLcrByPeriod([
      sample({ sample_id: "A", sampling_end_date: "2020-12-31T00:00:00Z", sample_measure: 0.001 }),
      sample({ sample_id: "B", sampling_end_date: "2024-06-30T00:00:00Z", sample_measure: 0.005 }),
    ]);
    expect(mostRecentPeriod(periods)?.sampling_end_date).toBe("2024-06-30T00:00:00Z");
  });
});

describe("summarizeLcr", () => {
  it("reports no_samples_on_file when the input is empty", () => {
    expect(summarizeLcr([]).status).toBe("no_samples_on_file");
  });

  it("returns the most recent sampling period when samples exist", () => {
    const s = summarizeLcr([
      sample({ sample_id: "L", sample_measure: 0.005 }),
      sample({
        sample_id: "C",
        contaminant_code: COPPER_CONTAMINANT_CODE,
        sample_measure: 0.6,
      }),
    ]);
    expect(s.status).toBe("available");
    if (s.status === "available") {
      expect(s.most_recent_sampling_period.lead_90th_percentile?.value).toBe(0.005);
      expect(s.most_recent_sampling_period.copper_90th_percentile?.value).toBe(0.6);
      expect(s.sampling_period_count).toBe(1);
    }
  });
});

describe("computeLcrSeverityInputs", () => {
  it("returns all-false when summary is no_samples_on_file or unavailable", () => {
    const a = computeLcrSeverityInputs({ status: "no_samples_on_file" });
    const b = computeLcrSeverityInputs({ status: "unavailable" });
    for (const r of [a, b]) {
      expect(r.lead_above_action).toBe(false);
      expect(r.copper_above_action).toBe(false);
      expect(r.any_approaching).toBe(false);
      expect(r.any_below_action).toBe(false);
    }
  });

  it("flags lead_above_action when lead 90th percentile is at or above 0.015 mg/L", () => {
    const r = computeLcrSeverityInputs(
      summarizeLcr([
        sample({ sample_measure: LEAD_ACTION_LEVEL_MG_L }),
      ]),
    );
    expect(r.lead_above_action).toBe(true);
  });

  it("flags copper_above_action when copper 90th percentile is at or above 1.3 mg/L", () => {
    const r = computeLcrSeverityInputs(
      summarizeLcr([
        sample({
          contaminant_code: COPPER_CONTAMINANT_CODE,
          sample_measure: COPPER_ACTION_LEVEL_MG_L,
        }),
      ]),
    );
    expect(r.copper_above_action).toBe(true);
  });

  it("flags any_approaching when a measurement is at 80%+ of the action level but below", () => {
    const r = computeLcrSeverityInputs(
      summarizeLcr([
        sample({ sample_measure: 0.013 }),
      ]),
    );
    expect(r.any_approaching).toBe(true);
    expect(r.lead_above_action).toBe(false);
  });

  it("treats a < (below detection) measurement as below_action regardless of value", () => {
    const r = computeLcrSeverityInputs(
      summarizeLcr([
        sample({ sample_measure: 0.001, result_sign_code: "<" }),
      ]),
    );
    expect(r.any_below_action).toBe(true);
    expect(r.lead_above_action).toBe(false);
    expect(r.any_approaching).toBe(false);
  });
});
