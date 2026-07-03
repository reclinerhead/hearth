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

describe("identity", () => {
  it("derives the display name and stats from the EPA record", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: null,
      lcrSamples: null,
      ccr: null,
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
      ccr: null,
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
      ccr: null,
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
      ccr: null,
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
      ccr: null,
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
      ccr: null,
      now: NOW,
    });
    expect(failed.leadCopper).toEqual({ kind: "unknown" });

    const empty = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccr: null,
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
      ccr: null,
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
      ccr: null,
      now: NOW,
    });
    expect(s.ccr).toEqual({ kind: "none" });
    expect(s.pfas).toEqual({ kind: "no_data" });
  });

  it("counts detected contaminants and reports all-below status", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccr: {
        reportYear: 2024,
        publishedDate: null,
        extractedData: extraction({
          detected_contaminants: [
            contaminant(),
            contaminant({ contaminant_name: "Fluoride", detected_level: 0.7, mcl: 4 }),
          ],
        }),
      },
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
      ccr: {
        reportYear: 2024,
        publishedDate: null,
        extractedData: extraction({
          detected_contaminants: [
            contaminant({ source_table_label: "Regulated" }),
            contaminant({ source_table_label: "Routine monitoring" }),
          ],
        }),
      },
      now: NOW,
    });
    expect(s.ccr).toMatchObject({ detectedContaminantCount: 1 });
  });

  it("flags at-or-above-limit when any row hits its MCL", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccr: {
        reportYear: 2024,
        publishedDate: null,
        extractedData: extraction({
          detected_contaminants: [
            contaminant({ contaminant_name: "Arsenic", detected_level: 12, mcl: 10 }),
          ],
        }),
      },
      now: NOW,
    });
    expect(s.ccr).toMatchObject({ status: "at_or_above_limit" });
  });

  it("reports none_detected for a clean report", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccr: { reportYear: 2024, publishedDate: null, extractedData: extraction() },
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

describe("PFAS block", () => {
  it("counts PFAS rows from the UCMR section and tiers them as caution", () => {
    const s = buildPublicWaterSummary({
      record,
      violations: [],
      lcrSamples: [],
      ccr: {
        reportYear: 2024,
        publishedDate: null,
        extractedData: extraction({
          ucmr_results: [
            {
              contaminant_name: "PFOA",
              detected_level: 2.2,
              unit: "ppt",
              monitoring_period: "2024",
            },
            {
              contaminant_name: "PFOS",
              detected_level: 5.7,
              unit: "ppt",
              monitoring_period: "2024",
            },
            // Monitored-but-clean rows don't count as detections.
            {
              contaminant_name: "Lithium",
              detected_level: null,
              unit: null,
              monitoring_period: "2024",
            },
          ],
        }),
      },
      now: NOW,
    });
    expect(s.pfas).toEqual({
      kind: "detected",
      count: 2,
      anyAtOrAboveLimit: false,
    });
    expect(s.ccr).toMatchObject({ detectedContaminantCount: 2 });
  });
});
