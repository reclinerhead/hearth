import { describe, expect, it } from "vitest";
import {
  classifyLcrAxis,
  computeLcrSeverityInputs,
  COPPER_ACTION_LEVEL_MG_L,
  COPPER_CONTAMINANT_CODE,
  LEAD_ACTION_LEVEL_MG_L,
  LEAD_CONTAMINANT_CODE,
  normalizeSign,
  pickMostRecentMeasurements,
  summarizeLcr,
  toMeasurement,
} from "./lcr";
import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";

function sample(
  overrides: Partial<SdwisLcrSampleRecord> = {},
): SdwisLcrSampleRecord {
  return {
    pwsid: "MI0003520",
    sample_id: "MI381874",
    contaminant_code: LEAD_CONTAMINANT_CODE,
    sample_measure: 0.005,
    unit_of_measure: "mg/L",
    result_sign_code: null,
    ...overrides,
  };
}

describe("LCR contaminant codes", () => {
  it("uses PB90 for lead (EPA's LCR_SAMPLE_RESULT code, not the general SDWIS 5000)", () => {
    expect(LEAD_CONTAMINANT_CODE).toBe("PB90");
  });
  it("uses CU90 for copper (not the general SDWIS 1022)", () => {
    expect(COPPER_CONTAMINANT_CODE).toBe("CU90");
  });
});

describe("normalizeSign", () => {
  it("returns < or > or = based on EPA's sign code", () => {
    expect(normalizeSign("<")).toBe("<");
    expect(normalizeSign(">")).toBe(">");
    expect(normalizeSign("=")).toBe("=");
    expect(normalizeSign(null)).toBe("=");
    expect(normalizeSign(undefined)).toBe("=");
    expect(normalizeSign("ZZ")).toBe("=");
  });
});

describe("toMeasurement", () => {
  it("builds a measurement from an EPA row, defaulting unit to MG/L when missing", () => {
    const m = toMeasurement(
      sample({ sample_measure: 0.0053, unit_of_measure: null }),
    );
    expect(m).not.toBeNull();
    expect(m?.value).toBe(0.0053);
    expect(m?.unit).toBe("MG/L");
    expect(m?.sample_id).toBe("MI381874");
    expect(m?.sign).toBe("=");
  });

  it("preserves the EPA unit when present (lowercase 'mg/L' is real)", () => {
    const m = toMeasurement(sample({ unit_of_measure: "mg/L" }));
    expect(m?.unit).toBe("mg/L");
  });

  it("returns null when sample_measure isn't numeric", () => {
    expect(toMeasurement(sample({ sample_measure: null }))).toBeNull();
    expect(toMeasurement(sample({ sample_measure: undefined }))).toBeNull();
  });

  it("returns null when sample_id is missing", () => {
    expect(toMeasurement(sample({ sample_id: "" } as unknown as Partial<SdwisLcrSampleRecord>))).toBeNull();
  });
});

describe("pickMostRecentMeasurements", () => {
  it("returns null/null on an empty input", () => {
    const r = pickMostRecentMeasurements([]);
    expect(r.lead).toBeNull();
    expect(r.copper).toBeNull();
    expect(r.totalSampleCount).toBe(0);
  });

  it("ignores rows with non-PB90/CU90 contaminant codes", () => {
    const r = pickMostRecentMeasurements([
      sample({ contaminant_code: "1005" /* arsenic */ }),
    ]);
    expect(r.lead).toBeNull();
    expect(r.copper).toBeNull();
    expect(r.totalSampleCount).toBe(0);
  });

  it("picks the lead measurement with the highest (alphabetically last) sample_id", () => {
    const r = pickMostRecentMeasurements([
      sample({ sample_id: "MI207485", sample_measure: 0.004 }),
      sample({ sample_id: "MI381874", sample_measure: 0.0053 }),
      sample({ sample_id: "MI257263", sample_measure: 0.013 }),
    ]);
    expect(r.lead?.value).toBe(0.0053);
    expect(r.lead?.sample_id).toBe("MI381874");
    expect(r.copper).toBeNull();
    expect(r.totalSampleCount).toBe(3);
  });

  it("tracks lead and copper independently — they don't share a 'period'", () => {
    const r = pickMostRecentMeasurements([
      sample({ sample_id: "MI200000", contaminant_code: LEAD_CONTAMINANT_CODE, sample_measure: 0.005 }),
      sample({ sample_id: "MI100000", contaminant_code: COPPER_CONTAMINANT_CODE, sample_measure: 0.4 }),
    ]);
    expect(r.lead?.sample_id).toBe("MI200000");
    expect(r.copper?.sample_id).toBe("MI100000");
    expect(r.totalSampleCount).toBe(2);
  });

  it("counts every PB90/CU90 row that yielded a measurement, even older ones", () => {
    const r = pickMostRecentMeasurements([
      sample({ sample_id: "MI100000" }),
      sample({ sample_id: "MI200000" }),
      sample({ sample_id: "MI300000" }),
    ]);
    expect(r.totalSampleCount).toBe(3);
  });
});

describe("summarizeLcr", () => {
  it("reports no_samples_on_file when the input is empty", () => {
    expect(summarizeLcr([]).status).toBe("no_samples_on_file");
  });

  it("reports no_samples_on_file when no rows are PB90 or CU90", () => {
    expect(
      summarizeLcr([sample({ contaminant_code: "1005" })]).status,
    ).toBe("no_samples_on_file");
  });

  it("returns available with the most recent lead measurement", () => {
    const s = summarizeLcr([
      sample({ sample_id: "MI200000", sample_measure: 0.012 }),
      sample({ sample_id: "MI381874", sample_measure: 0.0053 }),
    ]);
    expect(s.status).toBe("available");
    if (s.status === "available") {
      expect(s.most_recent_sampling_period.lead_90th_percentile?.value).toBe(0.0053);
      expect(s.most_recent_sampling_period.copper_90th_percentile).toBeNull();
      expect(s.most_recent_sampling_period.sampling_end_date).toBeNull();
      expect(s.sampling_period_count).toBe(2);
    }
  });

  it("returns available when only copper rows exist", () => {
    const s = summarizeLcr([
      sample({
        sample_id: "MI400000",
        contaminant_code: COPPER_CONTAMINANT_CODE,
        sample_measure: 0.5,
      }),
    ]);
    expect(s.status).toBe("available");
    if (s.status === "available") {
      expect(s.most_recent_sampling_period.lead_90th_percentile).toBeNull();
      expect(s.most_recent_sampling_period.copper_90th_percentile?.value).toBe(0.5);
    }
  });

  it("regression: real Kalamazoo data shape (17 PB90 rows, no copper, no dates) returns available with the lowest-sample_id-first picked from highest sample_id", () => {
    // Mirrors the actual EPA response shape: only contaminant_code,
    // sample_measure, unit_of_measure, sample_id. No dates, no
    // result_sign_code. The newest sample is the alphabetically
    // last sample_id.
    const records: SdwisLcrSampleRecord[] = [
      "MI207485",
      "MI257263",
      "MI266401",
      "MI287028",
      "MI287029",
      "MI287030",
      "MI287031",
      "MI293204",
      "MI303220",
      "MI310696",
      "MI320570",
      "MI329505",
      "MI338908",
      "MI347586",
      "MI357717",
      "MI370412",
      "MI381874",
    ].map((id, i) => ({
      pwsid: "MI0003520",
      sample_id: id,
      contaminant_code: "PB90",
      sample_measure: [0.004, 0.013, 0.015, 0.013, 0.015, 0.0077, 0.0045, 0.0079, 0.013, 0.0073, 0.0084, 0.0073, 0.0087, 0.0063, 0.009, 0.003, 0.0053][i],
      unit_of_measure: "mg/L",
      result_sign_code: null,
    }));

    const s = summarizeLcr(records);
    expect(s.status).toBe("available");
    if (s.status === "available") {
      expect(s.most_recent_sampling_period.lead_90th_percentile?.value).toBe(0.0053);
      expect(s.most_recent_sampling_period.lead_90th_percentile?.sample_id).toBe(
        "MI381874",
      );
      expect(s.sampling_period_count).toBe(17);
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

  it("regression: Kalamazoo's most-recent 0.0053 mg/L lead is below_action, no_approach, not_above", () => {
    const summary = summarizeLcr([
      sample({ sample_id: "MI381874", sample_measure: 0.0053 }),
    ]);
    const r = computeLcrSeverityInputs(summary);
    expect(r.lead_above_action).toBe(false);
    expect(r.any_approaching).toBe(false);
    expect(r.any_below_action).toBe(true);
  });
});

describe("classifyLcrAxis", () => {
  it("returns { kind: 'unknown' } when the summary isn't available", () => {
    expect(classifyLcrAxis({ status: "no_samples_on_file" })).toEqual({
      kind: "unknown",
    });
    expect(classifyLcrAxis({ status: "unavailable" })).toEqual({
      kind: "unknown",
    });
  });

  it("classifies lead and copper independently — both above action", () => {
    const r = classifyLcrAxis(
      summarizeLcr([
        sample({ sample_measure: LEAD_ACTION_LEVEL_MG_L }),
        sample({
          contaminant_code: COPPER_CONTAMINANT_CODE,
          sample_measure: COPPER_ACTION_LEVEL_MG_L,
        }),
      ]),
    );
    expect(r).toEqual({ kind: "available", lead: "above", copper: "above" });
  });

  it("classifies a metal as 'approaching' between 80% and 100% of action", () => {
    const r = classifyLcrAxis(
      summarizeLcr([
        sample({ sample_measure: 0.013 }), // 87% of lead action level
      ]),
    );
    expect(r).toEqual({
      kind: "available",
      lead: "approaching",
      copper: "absent",
    });
  });

  it("treats a '<' (below detection) row as 'below' regardless of value", () => {
    const r = classifyLcrAxis(
      summarizeLcr([
        sample({ sample_measure: 0.5, result_sign_code: "<" }),
      ]),
    );
    expect(r).toEqual({
      kind: "available",
      lead: "below",
      copper: "absent",
    });
  });

  it("returns 'absent' for a metal with no rows on file", () => {
    const r = classifyLcrAxis(
      summarizeLcr([sample({ sample_measure: 0.005 })]),
    );
    expect(r).toEqual({
      kind: "available",
      lead: "below",
      copper: "absent",
    });
  });

  it("regression: Kalamazoo's 0.0053 mg/L lead reads as 'below', not 'approaching'", () => {
    // Same data the computeLcrSeverityInputs regression above uses, so
    // the two helpers stay in lockstep on real EPA inputs.
    const r = classifyLcrAxis(
      summarizeLcr([sample({ sample_id: "MI381874", sample_measure: 0.0053 })]),
    );
    expect(r).toEqual({
      kind: "available",
      lead: "below",
      copper: "absent",
    });
  });

  it("ranks 'above' above 'approaching' when a metal has a single row at the boundary", () => {
    // At the exact action level the sample is 'above', not 'approaching'.
    const r = classifyLcrAxis(
      summarizeLcr([sample({ sample_measure: LEAD_ACTION_LEVEL_MG_L })]),
    );
    expect(r.kind).toBe("available");
    if (r.kind === "available") {
      expect(r.lead).toBe("above");
    }
  });
});
