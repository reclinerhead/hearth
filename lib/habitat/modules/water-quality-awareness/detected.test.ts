import { describe, expect, it } from "vitest";
import { deriveDetectedContaminants } from "./detected";
import type { CcrFindings, CcrSummarizedContaminant } from "./ccr";
import type { LeadCopperSummary } from "./lcr";
import type { CcrLeadCopperDistribution } from "@/lib/documents/ai/ccr-schema";

/* ---------- fixtures ---------------------------------------------------- */

function ccrContaminant(
  name: string,
  detected_level: number | null,
  unit: string | null,
): CcrSummarizedContaminant {
  return {
    contaminant_name: name,
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

function distribution(
  leadP90: number | null,
  copperP90: number | null,
): CcrLeadCopperDistribution {
  const entry = (p90: number | null) =>
    p90 === null
      ? null
      : {
          percentile_90: p90,
          unit: p90 < 1 ? "mg/L" : "ppb",
          action_level: null,
          samples_collected: null,
          samples_exceeding_action_level: null,
          monitoring_period: null,
        };
  return {
    lead: entry(leadP90),
    copper: entry(copperP90),
    lead_service_line_count: null,
  };
}

function ccrFindings(overrides: Partial<CcrFindings>): CcrFindings {
  return {
    report_year: 2024,
    published_date: null,
    contaminants: null,
    lead_copper_distribution: null,
    ucmr_results: null,
    free_testing_offer: null,
    ai_confidence: 0.9,
    ...overrides,
  };
}

function lcrAvailable(leadValue: number, sign: "<" | "=" | ">"): LeadCopperSummary {
  return {
    status: "available",
    sampling_period_count: 1,
    most_recent_sampling_period: {
      sampling_end_date: null,
      lead_90th_percentile: {
        value: leadValue,
        unit: "mg/L",
        sign,
        sample_id: "MI381874",
      },
      copper_90th_percentile: null,
    },
  };
}

function names(inputs: ReturnType<typeof deriveDetectedContaminants>): string[] {
  return inputs.map((i) => i.name);
}

/* ---------- cws_with_ccr ------------------------------------------------ */

describe("deriveDetectedContaminants — cws_with_ccr", () => {
  it("includes lead from the CCR lead/copper distribution, not just the contaminants table", () => {
    // Regression: lead is reported in lead_copper_distribution, NOT in
    // the contaminants array. Before the fix it showed as 'not detected'
    // in the matrix even though EPA/the CCR detected it.
    const result = deriveDetectedContaminants({
      branch: "cws_with_ccr",
      ccrFindings: ccrFindings({
        contaminants: [ccrContaminant("Arsenic", 3, "ppb")],
        lead_copper_distribution: distribution(0.009, null),
      }),
      leadCopper: null,
    });
    expect(names(result)).toEqual(expect.arrayContaining(["Arsenic", "Lead"]));
    const lead = result.find((r) => r.name === "Lead")!;
    expect(lead.level_label).toBe("0.009 mg/L");
  });

  it("falls back to EPA LCR samples for lead when the CCR didn't report it", () => {
    const result = deriveDetectedContaminants({
      branch: "cws_with_ccr",
      ccrFindings: ccrFindings({
        contaminants: [ccrContaminant("Fluoride", 0.7, "ppm")],
        lead_copper_distribution: null,
      }),
      leadCopper: lcrAvailable(0.0053, "="),
    });
    expect(names(result)).toEqual(expect.arrayContaining(["Fluoride", "Lead"]));
  });

  it("includes PFAS reported in the CCR's UCMR section", () => {
    // Regression: PFAS (PFOA/PFOS) is monitored under UCMR and printed
    // in ucmr_results, a separate field from the contaminants table.
    const result = deriveDetectedContaminants({
      branch: "cws_with_ccr",
      ccrFindings: ccrFindings({
        contaminants: [ccrContaminant("Total Trihalomethanes", 28.5, "ppb")],
        ucmr_results: [
          { contaminant_name: "PFOA", detected_level: 2.2, unit: "ng/L", monitoring_period: "2024" },
          { contaminant_name: "PFOS", detected_level: 4.0, unit: "ng/L", monitoring_period: "2024" },
        ],
      }),
      leadCopper: null,
    });
    expect(names(result)).toEqual(
      expect.arrayContaining(["Total Trihalomethanes", "PFOA", "PFOS"]),
    );
  });

  it("skips UCMR rows that were monitored but not detected (null/zero level)", () => {
    const result = deriveDetectedContaminants({
      branch: "cws_with_ccr",
      ccrFindings: ccrFindings({
        ucmr_results: [
          { contaminant_name: "PFNA", detected_level: null, unit: "ng/L", monitoring_period: "2024" },
          { contaminant_name: "PFBS", detected_level: 0, unit: "ng/L", monitoring_period: "2024" },
          { contaminant_name: "PFOA", detected_level: 2.2, unit: "ng/L", monitoring_period: "2024" },
        ],
      }),
      leadCopper: null,
    });
    expect(names(result)).toEqual(["PFOA"]);
  });

  it("prefers the CCR's own lead number over the EPA LCR fallback", () => {
    const result = deriveDetectedContaminants({
      branch: "cws_with_ccr",
      ccrFindings: ccrFindings({
        lead_copper_distribution: distribution(0.009, null),
      }),
      leadCopper: lcrAvailable(0.0053, "="),
    });
    const lead = result.find((r) => r.name === "Lead")!;
    expect(lead.level_label).toBe("0.009 mg/L");
  });
});

/* ---------- non-CCR branches ------------------------------------------- */

describe("deriveDetectedContaminants — non-CCR branches", () => {
  it("uses EPA LCR samples on cws_no_ccr", () => {
    const result = deriveDetectedContaminants({
      branch: "cws_no_ccr",
      ccrFindings: null,
      leadCopper: lcrAvailable(0.0053, "="),
    });
    expect(names(result)).toEqual(["Lead"]);
  });

  it("excludes below-detection lead ('<' sign)", () => {
    const result = deriveDetectedContaminants({
      branch: "cws_no_ccr",
      ccrFindings: null,
      leadCopper: lcrAvailable(0.001, "<"),
    });
    expect(result).toEqual([]);
  });

  it("returns nothing when there's no detection data at all", () => {
    expect(
      deriveDetectedContaminants({
        branch: "cws_no_ccr",
        ccrFindings: null,
        leadCopper: { status: "no_samples_on_file" },
      }),
    ).toEqual([]);
  });
});
