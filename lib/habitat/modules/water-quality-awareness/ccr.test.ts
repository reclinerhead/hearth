import { describe, expect, it } from "vitest";
import {
  buildCcrFindings,
  CAUTION_RATIO,
  ccrHasCautionSignal,
  ccrHasConcernSignal,
  classifyContaminantTier,
  PFAS_NAME_HINTS,
} from "./ccr";
import type {
  CcrDetectedContaminant,
  CcrExtractionResult,
} from "@/lib/documents/ai/ccr-schema";

function contaminant(
  overrides: Partial<CcrDetectedContaminant> = {},
): CcrDetectedContaminant {
  return {
    contaminant_name: "Atrazine",
    contaminant_code: null,
    detected_level: 0.5,
    unit: "ppb",
    mcl: 3,
    mclg: 3,
    mcl_action_level: null,
    sources: null,
    monitoring_period: null,
    violation_in_period_ind: null,
    notes: null,
    ...overrides,
  };
}

function extracted(
  overrides: Partial<CcrExtractionResult> = {},
): CcrExtractionResult {
  return {
    header_metadata: null,
    detected_contaminants: [],
    lead_copper_distribution: null,
    ucmr_results: null,
    free_testing_offer: null,
    ai_confidence: 0.85,
    ...overrides,
  };
}

describe("classifyContaminantTier", () => {
  describe("MCL ratio rules", () => {
    it("returns 'concern' when detected_level equals MCL", () => {
      const c = contaminant({ detected_level: 3, mcl: 3 });
      expect(classifyContaminantTier(c)).toBe("concern");
    });

    it("returns 'concern' when detected_level exceeds MCL", () => {
      const c = contaminant({ detected_level: 4, mcl: 3 });
      expect(classifyContaminantTier(c)).toBe("concern");
    });

    it("returns 'caution' at exactly 80% of MCL (CAUTION_RATIO boundary)", () => {
      // Cleanly-divisible inputs so JS floating point gives us 0.8 exactly.
      const c = contaminant({ detected_level: 4, mcl: 5 });
      expect(CAUTION_RATIO).toBe(0.8);
      expect(classifyContaminantTier(c)).toBe("caution");
    });

    it("returns 'caution' above 80% but below 100% of MCL", () => {
      const c = contaminant({ detected_level: 2.7, mcl: 3 });
      expect(classifyContaminantTier(c)).toBe("caution");
    });

    it("returns 'context' below 80% of MCL", () => {
      const c = contaminant({ detected_level: 0.5, mcl: 3 });
      expect(classifyContaminantTier(c)).toBe("context");
    });
  });

  describe("missing-data fallbacks", () => {
    it("returns 'context' when MCL is null and there's no action level", () => {
      const c = contaminant({ mcl: null, mcl_action_level: null });
      expect(classifyContaminantTier(c)).toBe("context");
    });

    it("returns 'context' when detected_level is null", () => {
      const c = contaminant({ detected_level: null });
      expect(classifyContaminantTier(c)).toBe("context");
    });

    it("uses mcl_action_level when MCL is null (lead / copper LCR pattern)", () => {
      const c = contaminant({
        contaminant_name: "Lead",
        detected_level: 15,
        mcl: null,
        mcl_action_level: 15,
      });
      expect(classifyContaminantTier(c)).toBe("concern");
    });

    it("returns 'context' when MCL is zero or negative (defensive)", () => {
      expect(classifyContaminantTier(contaminant({ mcl: 0 }))).toBe("context");
      expect(classifyContaminantTier(contaminant({ mcl: -1 }))).toBe("context");
    });
  });

  describe("PFAS-at-any-level rule", () => {
    // PFAS naming is inconsistent across CCRs; the family is matched
    // by name hint, not by code. Any positive detection escalates the
    // row to 'caution' regardless of MCL ratio.

    it.each(PFAS_NAME_HINTS.map((hint) => [hint] as const))(
      "matches PFAS family name hint %s",
      (hint) => {
        const c = contaminant({
          contaminant_name: hint.toUpperCase(),
          detected_level: 0.0001,
          mcl: 100, // very high MCL — no ratio escalation
        });
        expect(classifyContaminantTier(c)).toBe("caution");
      },
    );

    it("matches PFAS hints case-insensitively inside the contaminant name", () => {
      const c = contaminant({
        contaminant_name: "Perfluorooctanoic acid (PFOA)",
        detected_level: 0.000002,
        mcl: 100,
      });
      expect(classifyContaminantTier(c)).toBe("caution");
    });

    it("does NOT escalate a PFAS row whose detected_level is zero or null", () => {
      // "PFAS at any level" specifically means positive detection. A
      // null or zero level is a non-detect and stays in 'context'.
      expect(
        classifyContaminantTier(
          contaminant({
            contaminant_name: "PFOA",
            detected_level: 0,
            mcl: 100,
          }),
        ),
      ).toBe("context");
      expect(
        classifyContaminantTier(
          contaminant({
            contaminant_name: "PFOA",
            detected_level: null,
            mcl: 100,
          }),
        ),
      ).toBe("context");
    });

    it("does NOT match unrelated contaminants that happen to contain 'pf' as substring elsewhere", () => {
      // Sanity check that the hint list isn't dangerously loose.
      // "Sulfate" doesn't contain any PFAS hint substring.
      const c = contaminant({
        contaminant_name: "Sulfate",
        detected_level: 50,
        mcl: 250,
      });
      expect(classifyContaminantTier(c)).toBe("context");
    });
  });
});

describe("buildCcrFindings", () => {
  it("populates report_year and published_date from the orchestrator args (not extraction header)", () => {
    // The persisted row's coverage year is authoritative; we never
    // pull this from extractedData.header_metadata.
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: "2025-05-15",
      extractedData: extracted({
        header_metadata: {
          utility_name: "<placeholder>",
          pwsid: null,
          report_year: 9999, // intentionally absurd to confirm we don't use it
          publication_date: null,
        },
      }),
    });
    expect(out.report_year).toBe(2024);
    expect(out.published_date).toBe("2025-05-15");
  });

  it("returns an empty array when detected_contaminants is []", () => {
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ detected_contaminants: [] }),
    });
    expect(out.contaminants).toEqual([]);
  });

  it("returns null contaminants when extracted_data has null", () => {
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ detected_contaminants: null }),
    });
    expect(out.contaminants).toBeNull();
  });

  it("classifies each contaminant and sorts concern → caution → context", () => {
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({ contaminant_name: "Context-A", detected_level: 0.1, mcl: 3 }),
          contaminant({ contaminant_name: "Concern-1", detected_level: 5, mcl: 3 }),
          contaminant({ contaminant_name: "Caution-1", detected_level: 2.5, mcl: 3 }),
          contaminant({ contaminant_name: "Context-B", detected_level: 0.05, mcl: 3 }),
        ],
      }),
    });
    expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
      "Concern-1",
      "Caution-1",
      "Context-A",
      "Context-B",
    ]);
    expect(out.contaminants?.map((c) => c.tier)).toEqual([
      "concern",
      "caution",
      "context",
      "context",
    ]);
  });

  it("preserves within-tier ordering from the extraction", () => {
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({ contaminant_name: "Concern-A", detected_level: 4, mcl: 3 }),
          contaminant({ contaminant_name: "Concern-B", detected_level: 5, mcl: 3 }),
          contaminant({ contaminant_name: "Concern-C", detected_level: 6, mcl: 3 }),
        ],
      }),
    });
    expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
      "Concern-A",
      "Concern-B",
      "Concern-C",
    ]);
  });

  it("passes lead_copper_distribution and ucmr_results through unchanged", () => {
    const lcr = {
      lead: {
        percentile_90: 3.2,
        unit: "ppb",
        action_level: 15,
        samples_collected: 50,
        samples_exceeding_action_level: 2,
        monitoring_period: "2024",
      },
      copper: null,
      lead_service_line_count: 1200,
    };
    const ucmr = [
      {
        contaminant_name: "PFBS",
        detected_level: 0.002,
        unit: "ppb",
        monitoring_period: "2024",
      },
    ];
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        lead_copper_distribution: lcr,
        ucmr_results: ucmr,
      }),
    });
    expect(out.lead_copper_distribution).toEqual(lcr);
    expect(out.ucmr_results).toEqual(ucmr);
  });

  it("passes the free_testing_offer through unchanged", () => {
    const offer = {
      offered: true,
      contact_method: "phone" as const,
      contact_value: "<phone as printed>",
    };
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ free_testing_offer: offer }),
    });
    expect(out.free_testing_offer).toEqual(offer);
  });

  it("passes ai_confidence through", () => {
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ ai_confidence: 0.42 }),
    });
    expect(out.ai_confidence).toBe(0.42);
  });
});

describe("ccrHasConcernSignal / ccrHasCautionSignal", () => {
  it("returns false on null contaminants (degraded extraction)", () => {
    const f = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ detected_contaminants: null }),
    });
    expect(ccrHasConcernSignal(f)).toBe(false);
    expect(ccrHasCautionSignal(f)).toBe(false);
  });

  it("returns false on empty contaminants (clean CCR)", () => {
    const f = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({ detected_contaminants: [] }),
    });
    expect(ccrHasConcernSignal(f)).toBe(false);
    expect(ccrHasCautionSignal(f)).toBe(false);
  });

  it("returns true on a concern row", () => {
    const f = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({ detected_level: 5, mcl: 3 }),
        ],
      }),
    });
    expect(ccrHasConcernSignal(f)).toBe(true);
    // Concern also implies the existence of an escalation; caution
    // is conceptually a weaker signal. The flag is row-level: a
    // concern row is NOT also a caution row.
    expect(ccrHasCautionSignal(f)).toBe(false);
  });

  it("returns true on a PFAS caution row even when no MCL escalation", () => {
    const f = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({
            contaminant_name: "PFOA",
            detected_level: 0.0001,
            mcl: 100,
          }),
        ],
      }),
    });
    expect(ccrHasCautionSignal(f)).toBe(true);
    expect(ccrHasConcernSignal(f)).toBe(false);
  });
});
