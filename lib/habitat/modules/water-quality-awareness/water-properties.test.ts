import { describe, expect, it } from "vitest";
import {
  classifyHardness,
  describeWaterProperties,
  extractWaterProperties,
  hardnessToMgL,
} from "./water-properties";
import type { CcrFindings, CcrSummarizedContaminant } from "./ccr";

function row(
  name: string,
  detected_level: number | null,
  unit: string | null,
): CcrSummarizedContaminant {
  return {
    contaminant_name: name,
    contaminant_code: null,
    detected_level,
    unit,
    mcl: null,
    mclg: null,
    mcl_action_level: null,
    sources: null,
    monitoring_period: null,
    violation_in_period_ind: null,
    notes: null,
    source_table_label: null,
    tier: "context",
    has_multiple_observations: false,
    other_observations: [],
  };
}

function ccr(rows: CcrSummarizedContaminant[]): CcrFindings {
  return {
    report_year: 2024,
    published_date: null,
    contaminants: rows,
    lead_copper_distribution: null,
    ucmr_results: null,
    free_testing_offer: null,
    ai_confidence: 0.9,
  };
}

describe("hardnessToMgL", () => {
  it("passes mg/L (and ppm / 'mg/L as CaCO3') through unchanged", () => {
    expect(hardnessToMgL(120, "mg/L")).toBe(120);
    expect(hardnessToMgL(120, "ppm")).toBe(120);
    expect(hardnessToMgL(120, "mg/L as CaCO3")).toBe(120);
  });

  it("converts grains/gallon to mg/L as CaCO3", () => {
    expect(hardnessToMgL(7, "grains/gallon")).toBeCloseTo(119.8, 1);
    expect(hardnessToMgL(10, "gpg")).toBeCloseTo(171.18, 1);
  });
});

describe("classifyHardness", () => {
  it("classifies at the USGS boundaries", () => {
    expect(classifyHardness(59)).toBe("soft");
    expect(classifyHardness(60)).toBe("moderate");
    expect(classifyHardness(119)).toBe("moderate");
    expect(classifyHardness(120)).toBe("hard");
    expect(classifyHardness(179)).toBe("hard");
    expect(classifyHardness(180)).toBe("very_hard");
  });
});

describe("extractWaterProperties", () => {
  it("reads hardness in mg/L and classifies it", () => {
    const props = extractWaterProperties(ccr([row("Total Hardness", 140, "mg/L")]));
    expect(props?.hardness?.mg_l_caco3).toBe(140);
    expect(props?.hardness?.classification).toBe("hard");
    expect(props?.affects_maintenance).toBe(true);
  });

  it("normalizes grains/gallon hardness (7 gpg → moderately hard)", () => {
    const props = extractWaterProperties(
      ccr([row("Hardness (as CaCO3)", 7, "gpg")]),
    );
    expect(props?.hardness?.classification).toBe("moderate");
    expect(props?.hardness?.grains_per_gallon).toBeCloseTo(7, 0);
  });

  it("detects iron and manganese", () => {
    const props = extractWaterProperties(
      ccr([row("Iron", 0.4, "mg/L"), row("Manganese", 0.05, "mg/L")]),
    );
    expect(props?.iron?.detected).toBe(true);
    expect(props?.iron?.mg_l).toBe(0.4);
    expect(props?.manganese?.detected).toBe(true);
    expect(props?.affects_maintenance).toBe(true);
  });

  it("soft water with no metals does not affect maintenance", () => {
    const props = extractWaterProperties(ccr([row("Total Hardness", 40, "mg/L")]));
    expect(props?.hardness?.classification).toBe("soft");
    expect(props?.affects_maintenance).toBe(false);
  });

  it("returns null when no water-touching property is present", () => {
    expect(extractWaterProperties(ccr([row("Atrazine", 0.5, "ppb")]))).toBeNull();
    expect(extractWaterProperties(ccr([]))).toBeNull();
    expect(extractWaterProperties(null)).toBeNull();
  });

  it("ignores a hardness row reported as non-detect (null/zero)", () => {
    expect(
      extractWaterProperties(ccr([row("Total Hardness", null, "mg/L")])),
    ).toBeNull();
  });

  it("does not mistake other contaminants for iron (word-boundary match)", () => {
    // A contaminant whose name merely contains the letters "iron"
    // shouldn't register as iron.
    const props = extractWaterProperties(ccr([row("Environmental marker", 1, "mg/L")]));
    expect(props).toBeNull();
  });
});

describe("describeWaterProperties", () => {
  it("names hardness and metals in one synthesis-readable sentence", () => {
    const props = extractWaterProperties(
      ccr([row("Total Hardness", 140, "mg/L"), row("Iron", 0.4, "mg/L")]),
    );
    const sentence = describeWaterProperties(props);
    expect(sentence).toMatch(/hard water/i);
    expect(sentence).toMatch(/iron/i);
    expect(sentence).toMatch(/maintenance cadence/i);
  });

  it("returns empty string when nothing is cadence-relevant", () => {
    const soft = extractWaterProperties(ccr([row("Total Hardness", 40, "mg/L")]));
    expect(describeWaterProperties(soft)).toBe("");
    expect(describeWaterProperties(null)).toBe("");
  });
});
