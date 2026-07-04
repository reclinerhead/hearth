import { describe, expect, it } from "vitest";
import { buildPublicWaterSummary } from "./water-summary";
import type { EnvirofactsWaterSystemRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/envirofacts";
import type { SdwisViolationRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/sdwis-violations";
import type { SdwisLcrSampleRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/sdwis-lcr-samples";
import type {
  CcrDetectedContaminant,
  CcrExtractionResult,
} from "@/lib/documents/ai/ccr-schema";

const NOW = new Date("2026-07-01T00:00:00Z");

const record: EnvirofactsWaterSystemRecord = {
  pwsid: "MI0003520",
  pws_name: "KALAMAZOO",
  pws_activity_code: "A",
  pws_type_code: "CWS",
  gw_sw_code: "GW",
  population_served_count: 192992,
  service_connections_count: 41411,
  source_water_protection_code: "Y",
  source_protection_begin_date: "2004-06-01",
  // Admin contact present on the EPA record — the view model must
  // never carry it (epic #298 hard rule 7).
  admin_name: "BAKER, JAMES",
  email_addr: "someone@example.gov",
  phone_number: "555-0100",
};

function violation(
  overrides: Partial<SdwisViolationRecord> = {},
): SdwisViolationRecord {
  return {
    pwsid: "MI0003520",
    violation_id: "V1",
    is_health_based_ind: "N",
    viol_first_reported_date: "2024-03-01",
    rtc_date: "2024-06-01",
    ...overrides,
  };
}

function lcrSample(
  overrides: Partial<SdwisLcrSampleRecord> = {},
): SdwisLcrSampleRecord {
  return {
    pwsid: "MI0003520",
    sample_id: "MI381874",
    contaminant_code: "PB90",
    sample_measure: 0.005,
    unit_of_measure: "MG/L",
    result_sign_code: "=",
    ...overrides,
  };
}

function contaminant(
  overrides: Partial<CcrDetectedContaminant> = {},
): CcrDetectedContaminant {
  return {
    contaminant_name: "Nitrate",
    contaminant_code: null,
    detected_level: 1.2,
    unit: "ppm",
    mcl: 10,
    mclg: 10,
    mcl_action_level: null,
    sources: null,
    monitoring_period: "2024",
    violation_in_period_ind: null,
    notes: null,
    source_table_label: null,
    ...overrides,
  };
}

function extraction(
  overrides: Partial<CcrExtractionResult> = {},
): CcrExtractionResult {
  return {
    header_metadata: null,
    detected_contaminants: [],
    lead_copper_distribution: null,
    ucmr_results: null,
    free_testing_offer: null,
    ai_confidence: 0.9,
    ...overrides,
  };
}

function ccrYear(
  reportYear: number,
  extractedData: CcrExtractionResult,
): { reportYear: number; publishedDate: string | null; extractedData: CcrExtractionResult } {
  return { reportYear, publishedDate: null, extractedData };
}

describe("identity", () => {
  it("derives the display name and stats from the EPA record", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: null,
      lcrSamples: null,
      ccrYears: [],
      now: NOW,
    });
    expect(s.identity.name).toBe("Kalamazoo Public Water Supply");
    expect(s.identity.sourceLabel).toBe("Groundwater");
    expect(s.identity.populationServed).toBe(192992);
    expect(s.identity.serviceConnections).toBe(41411);
    expect(s.identity.sourceProtectionSinceYear).toBe(2004);
  });

  it("never carries admin contact fields anywhere in the view model", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain("BAKER");
    expect(serialized).not.toContain("James");
    expect(serialized).not.toContain("example.gov");
    expect(serialized).not.toContain("555-0100");
    // Machine identifiers stay internal too (hard rule 3).
    expect(serialized).not.toContain("MI0003520");
  });
});

describe("compliance block", () => {
  it("maps a failed fetch to unknown, not to a clean record", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: null,
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    expect(s.compliance).toEqual({ kind: "unknown" });
  });

  it("summarizes a resolved history with recent counts", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [
        violation(),
        violation({ violation_id: "V2", viol_first_reported_date: "2010-01-01" }),
      ],
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    expect(s.compliance).toEqual({
      kind: "known",
      status: "no_active_violations",
      recentTotal: 1,
      recentHealthBased: 0,
    });
  });

  it("flags active health-based violations and escalates severity", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [violation({ is_health_based_ind: "Y", rtc_date: null })],
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    expect(s.compliance.kind).toBe("known");
    if (s.compliance.kind === "known") {
      expect(s.compliance.status).toBe("active_violations");
    }
  });
});

describe("lead / copper block", () => {
  it("distinguishes no-samples from fetch-failed", () => {
    const failed = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: null,
      ccrYears: [],
      now: NOW,
    });
    expect(failed.leadCopper).toEqual({ kind: "unknown" });

    const empty = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    expect(empty.leadCopper).toEqual({ kind: "no_samples" });
  });

  it("carries values, units, and the classified state per metal", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [
        lcrSample(),
        lcrSample({
          sample_id: "MI381875",
          contaminant_code: "CU90",
          sample_measure: 0.2,
        }),
      ],
      ccrYears: [],
      now: NOW,
    });
    expect(s.leadCopper).toEqual({
      kind: "available",
      lead: {
        state: "detected",
        value: 0.005,
        unit: "MG/L",
        actionLevelMgL: 0.015,
      },
      copper: {
        state: "detected",
        value: 0.2,
        unit: "MG/L",
        actionLevelMgL: 1.3,
      },
    });
  });
});

describe("CCR block", () => {
  it("reports none when no report has been contributed", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [],
      now: NOW,
    });
    expect(s.ccr).toEqual({ kind: "none" });
    expect(s.pfas).toEqual({ kind: "no_data" });
    expect(s.detected).toEqual({ kind: "no_data" });
  });

  it("counts detected contaminants and reports all-below status", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant(),
              contaminant({ contaminant_name: "Fluoride", detected_level: 0.7, mcl: 4 }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    expect(s.ccr).toEqual({
      kind: "on_file",
      year: 2024,
      detectedContaminantCount: 2,
      status: "all_below_limits",
    });
    expect(s.pfas).toEqual({ kind: "none_reported" });
  });

  it("dedupes multi-observation analytes so one contaminant counts once", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant({ source_table_label: "Regulated" }),
              contaminant({ source_table_label: "Routine monitoring" }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    expect(s.ccr).toMatchObject({ detectedContaminantCount: 1 });
  });

  it("flags at-or-above-limit when any row hits its MCL", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant({ contaminant_name: "Arsenic", detected_level: 12, mcl: 10 }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    expect(s.ccr).toMatchObject({ status: "at_or_above_limit" });
  });

  it("uses the LATEST year for the displayed list when several are on file", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(2023, extraction({ detected_contaminants: [contaminant()] })),
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant(),
              contaminant({ contaminant_name: "Fluoride", detected_level: 0.7, mcl: 4 }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    expect(s.ccr).toMatchObject({ year: 2024, detectedContaminantCount: 2 });
  });

  it("reports none_detected for a clean report", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [ccrYear(2024, extraction())],
      now: NOW,
    });
    expect(s.ccr).toEqual({
      kind: "on_file",
      year: 2024,
      detectedContaminantCount: 0,
      status: "none_detected",
    });
  });
});

describe("detected block (issue #303)", () => {
  it("renders resolved rows with canonical names, reference copy, and numeric level/limit", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant(), // Nitrate 1.2 ppm / 10
            ],
          }),
        ),
      ],
      now: NOW,
    });
    expect(s.detected.kind).toBe("available");
    if (s.detected.kind !== "available") return;
    expect(s.detected.reportYear).toBe(2024);
    expect(s.detected.reportsOnFile).toEqual({
      count: 1,
      firstYear: 2024,
      lastYear: 2024,
    });
    expect(s.detected.omittedCount).toBe(0);
    expect(s.detected.items).toHaveLength(1);
    const item = s.detected.items[0];
    expect(item.kind).toBe("single");
    if (item.kind !== "single") return;
    expect(item.row.name).toBe("Nitrate");
    expect(item.row.level).toBe(1.2);
    expect(item.row.unit).toBe("ppm");
    expect(item.row.limit).toBe(10);
    expect(item.row.tier).toBe("context");
    // Editorial copy comes from OUR reference, never the extraction.
    expect(item.row.description).toContain("fertilizer");
    expect(item.row.learnMoreUrl).toContain("epa.gov");
    // Single year → no trend block.
    expect(item.row.trend).toBeNull();
  });

  it("omits rows that don't resolve against the canonical reference and counts them", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant(),
              contaminant({
                // A crafted upload's attacker-chosen "contaminant".
                contaminant_name: "Buy pills at scam-site dot com",
                detected_level: 99,
                mcl: 10,
              }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    if (s.detected.kind !== "available") throw new Error("expected available");
    expect(s.detected.items).toHaveLength(1);
    expect(s.detected.omittedCount).toBe(1);
    expect(s.detected.omittedAnyConcern).toBe(true); // 99 >= 10 → concern
    // The attacker text never reaches the view model at all.
    expect(JSON.stringify(s)).not.toContain("scam");
    expect(JSON.stringify(s)).not.toContain("pills");
  });

  it("omits rows whose unit fails the allowlist even when the name resolves", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [
              contaminant({ unit: "ppm — call 555-1234 now" }),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    if (s.detected.kind !== "available") throw new Error("expected available");
    expect(s.detected.items).toHaveLength(0);
    expect(s.detected.omittedCount).toBe(1);
    expect(JSON.stringify(s)).not.toContain("555-1234");
  });

  it("keeps a null unit renderable (number without a unit)", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            detected_contaminants: [contaminant({ unit: null })],
          }),
        ),
      ],
      now: NOW,
    });
    if (s.detected.kind !== "available") throw new Error("expected available");
    expect(s.detected.items).toHaveLength(1);
    const item = s.detected.items[0];
    if (item.kind !== "single") throw new Error("expected single");
    expect(item.row.unit).toBeNull();
  });

  it("computes falling trends across years and carries sanitized points", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(2023, extraction({ detected_contaminants: [contaminant({ detected_level: 2.0 })] })),
        ccrYear(2024, extraction({ detected_contaminants: [contaminant({ detected_level: 1.2 })] })),
      ],
      now: NOW,
    });
    if (s.detected.kind !== "available") throw new Error("expected available");
    expect(s.detected.reportsOnFile).toEqual({
      count: 2,
      firstYear: 2023,
      lastYear: 2024,
    });
    const item = s.detected.items[0];
    if (item.kind !== "single") throw new Error("expected single");
    expect(item.row.trend).not.toBeNull();
    expect(item.row.trend?.direction).toBe("falling");
    expect(item.row.trend?.word).toBe("Falling");
    expect(item.row.trend?.tone).toBe("positive");
    expect(item.row.trend?.spanLabel).toBe("2 readings · 2023–2024");
    expect(item.row.trend?.previous).toEqual({ year: 2023, level: 2.0 });
    expect(item.row.trend?.points).toEqual([
      { year: 2023, level: 2.0 },
      { year: 2024, level: 1.2 },
    ]);
  });
});

describe("PFAS block (issue #303 — real list with trends)", () => {
  const ucmr = (name: string, level: number) => ({
    contaminant_name: name,
    detected_level: level,
    unit: "ppt",
    monitoring_period: "2024",
  });

  it("folds 2+ PFAS analytes into the family card with canonical names", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(
          2024,
          extraction({
            ucmr_results: [
              ucmr("Perfluorooctanoic acid (PFOA)", 2.2),
              ucmr("Perfluorooctane sulfonic acid (PFOS)", 5.7),
            ],
          }),
        ),
      ],
      now: NOW,
    });
    if (s.detected.kind !== "available") throw new Error("expected available");
    const family = s.detected.items.find((i) => i.kind === "pfas_family");
    expect(family).toBeDefined();
    if (family?.kind !== "pfas_family") return;
    // Level-descending order, canonical short names — never upload text.
    expect(family.analytes.map((a) => a.name)).toEqual(["PFOS", "PFOA"]);
    expect(family.description).toContain("forever chemicals");
    expect(JSON.stringify(s)).not.toContain("Perfluorooctanoic acid (PFOA)");
  });

  it("tallies per-analyte trend directions for the news-section sentence", () => {
    const year = (y: number, pfoa: number, pfos: number) =>
      ccrYear(
        y,
        extraction({
          ucmr_results: [
            ucmr("Perfluorooctanoic acid (PFOA)", pfoa),
            ucmr("Perfluorooctane sulfonic acid (PFOS)", pfos),
          ],
        }),
      );
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      // PFOA falls 5.0 → 2.2; PFOS rises 2.0 → 5.7.
      ccrYears: [year(2023, 5.0, 2.0), year(2024, 2.2, 5.7)],
      now: NOW,
    });
    expect(s.pfas).toEqual({
      kind: "detected",
      count: 2,
      anyAtOrAboveLimit: false,
      falling: 1,
      rising: 1,
      stable: 0,
      inconclusive: 0,
    });
  });

  it("still reports none_reported when the report has no PFAS rows", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccrYears: [
        ccrYear(2024, extraction({ detected_contaminants: [contaminant()] })),
      ],
      now: NOW,
    });
    expect(s.pfas).toEqual({ kind: "none_reported" });
  });
});
