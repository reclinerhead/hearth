import { describe, expect, it } from "vitest";
import {
  buildCcrFindings,
  CAUTION_RATIO,
  ccrHasCautionSignal,
  ccrHasConcernSignal,
  classifyContaminantTier,
  extractEarliestYear,
  extractMostRecentYear,
  mclRatio,
  normalizeContaminantGroupKey,
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
    source_table_label: null,
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

  it("sorts within a tier by detected_level / mcl descending (issue #199)", () => {
    // Three concern-tier rows emitted in ascending-ratio order. The
    // pre-#199 summarizer preserved extraction order; the post-#199
    // summarizer floats the worst exceedance to the top of the tier.
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({ contaminant_name: "Concern-A", detected_level: 4, mcl: 3 }), // 1.33
          contaminant({ contaminant_name: "Concern-B", detected_level: 5, mcl: 3 }), // 1.67
          contaminant({ contaminant_name: "Concern-C", detected_level: 6, mcl: 3 }), // 2.00
        ],
      }),
    });
    expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
      "Concern-C",
      "Concern-B",
      "Concern-A",
    ]);
  });

  it("falls back to extraction order within a tier when neither row has a computable ratio", () => {
    // Two context rows, neither with an MCL — the comparator has no
    // ratio signal so extraction order survives as the tiebreaker.
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({
            contaminant_name: "First",
            detected_level: 0.5,
            mcl: null,
            mcl_action_level: null,
          }),
          contaminant({
            contaminant_name: "Second",
            detected_level: 0.5,
            mcl: null,
            mcl_action_level: null,
          }),
        ],
      }),
    });
    expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("sinks ratio'd-null rows below ratio'd rows within a tier", () => {
    // Both rows tier as context (one by MCL ratio, one because MCL is
    // missing). The ratio'd row floats above the null-ratio row even
    // though it appeared LATER in extraction order.
    const out = buildCcrFindings({
      reportYear: 2024,
      publishedDate: null,
      extractedData: extracted({
        detected_contaminants: [
          contaminant({
            contaminant_name: "No-MCL",
            detected_level: 0.5,
            mcl: null,
            mcl_action_level: null,
          }),
          contaminant({
            contaminant_name: "Has-MCL",
            detected_level: 0.5,
            mcl: 10,
          }),
        ],
      }),
    });
    expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
      "Has-MCL",
      "No-MCL",
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

  describe("single-observation rows (issue #200 regression)", () => {
    // Single-observation rows are the overwhelming majority. Their
    // shape, tier, and sort order must NOT change from pre-#200
    // behavior — only the grouping fields are added uniformly.

    it("stamps has_multiple_observations=false and an empty other_observations array on every single-obs row", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({
          detected_contaminants: [
            contaminant({ contaminant_name: "Atrazine", detected_level: 0.5, mcl: 3 }),
            contaminant({ contaminant_name: "Nitrate", detected_level: 2, mcl: 10 }),
          ],
        }),
      });
      expect(out.contaminants).toHaveLength(2);
      for (const c of out.contaminants ?? []) {
        expect(c.has_multiple_observations).toBe(false);
        expect(c.other_observations).toEqual([]);
      }
    });

    it("preserves shape, tier, and sort order for distinct-name rows (no grouping triggered)", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({
          detected_contaminants: [
            contaminant({ contaminant_name: "Context-A", detected_level: 0.1, mcl: 3 }),
            contaminant({ contaminant_name: "Concern-1", detected_level: 5, mcl: 3 }),
            contaminant({ contaminant_name: "Caution-1", detected_level: 2.5, mcl: 3 }),
          ],
        }),
      });
      expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
        "Concern-1",
        "Caution-1",
        "Context-A",
      ]);
      expect(out.contaminants?.map((c) => c.tier)).toEqual([
        "concern",
        "caution",
        "context",
      ]);
      expect(out.contaminants?.every((c) => !c.has_multiple_observations)).toBe(
        true,
      );
    });
  });

  describe("multi-observation grouping (issue #200)", () => {
    // Real-world fixture mirrors the Kalamazoo 2024 CCR: five PFAS
    // analytes printed in two co-printed tables — the federal
    // UCMR5 round (2023-2024 averages) and the utility's routine
    // PFAS monitoring (2024 highest running annual average). Four
    // analytes report different values across the two tables; PFOS
    // happens to print 5.7 in both.
    const KALAMAZOO_PFAS_ROWS: CcrDetectedContaminant[] = [
      // UCMR5 round
      contaminant({
        contaminant_name: "PFBS",
        detected_level: 6.2,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2023-2024",
        source_table_label: "2023-2024 EPA UCMR5 PFAS & LITHIUM MONITORING",
      }),
      contaminant({
        contaminant_name: "PFHxS",
        detected_level: 3.6,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2023-2024",
        source_table_label: "2023-2024 EPA UCMR5 PFAS & LITHIUM MONITORING",
      }),
      contaminant({
        contaminant_name: "PFHxA",
        detected_level: 5.2,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2023-2024",
        source_table_label: "2023-2024 EPA UCMR5 PFAS & LITHIUM MONITORING",
      }),
      contaminant({
        contaminant_name: "PFOA",
        detected_level: 2.2,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2023-2024",
        source_table_label: "2023-2024 EPA UCMR5 PFAS & LITHIUM MONITORING",
      }),
      contaminant({
        contaminant_name: "PFOS",
        detected_level: 5.7,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2023-2024",
        source_table_label: "2023-2024 EPA UCMR5 PFAS & LITHIUM MONITORING",
      }),
      // Utility routine monitoring (RAA, more recent)
      contaminant({
        contaminant_name: "PFBS",
        detected_level: 7.4,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2024",
        notes: "Highest Running Annual Average",
        source_table_label:
          "2024 PER- AND POLYFLUOROALKYL SUBSTANCES (PFAS) MONITORING",
      }),
      contaminant({
        contaminant_name: "PFHxS",
        detected_level: 4.0,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2024",
        notes: "Highest Running Annual Average",
        source_table_label:
          "2024 PER- AND POLYFLUOROALKYL SUBSTANCES (PFAS) MONITORING",
      }),
      contaminant({
        contaminant_name: "PFHxA",
        detected_level: 2.7,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2024",
        notes: "Highest Running Annual Average",
        source_table_label:
          "2024 PER- AND POLYFLUOROALKYL SUBSTANCES (PFAS) MONITORING",
      }),
      contaminant({
        contaminant_name: "PFOA",
        detected_level: 3.1,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2024",
        notes: "Highest Running Annual Average",
        source_table_label:
          "2024 PER- AND POLYFLUOROALKYL SUBSTANCES (PFAS) MONITORING",
      }),
      contaminant({
        contaminant_name: "PFOS",
        detected_level: 5.7,
        unit: "ppt",
        mcl: 100,
        monitoring_period: "2024",
        notes: "Highest Running Annual Average",
        source_table_label:
          "2024 PER- AND POLYFLUOROALKYL SUBSTANCES (PFAS) MONITORING",
      }),
    ];

    it("collapses ten PFAS rows across two tables into five grouped findings", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: KALAMAZOO_PFAS_ROWS }),
      });
      expect(out.contaminants).toHaveLength(5);
      const names = out.contaminants?.map((c) => c.contaminant_name).sort();
      expect(names).toEqual(["PFBS", "PFHxA", "PFHxS", "PFOA", "PFOS"]);
    });

    it("marks every grouped row has_multiple_observations=true with one other_observation", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: KALAMAZOO_PFAS_ROWS }),
      });
      for (const c of out.contaminants ?? []) {
        expect(c.has_multiple_observations).toBe(true);
        expect(c.other_observations).toHaveLength(1);
      }
    });

    it("classifies each analyte ONCE — tier count equals analyte count, not observation count", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: KALAMAZOO_PFAS_ROWS }),
      });
      const tiers = out.contaminants?.map((c) => c.tier) ?? [];
      // Five analyte groups → five tier values, NOT ten (which is
      // what the pre-#200 flat-array summarizer emitted).
      expect(tiers).toHaveLength(5);
      // Tier comes from classifying the display observation, never
      // from any of the alternate observations — for these PFAS
      // analytes whose names happen to be in PFAS_NAME_HINTS the
      // result is caution; for analytes outside the hint list the
      // result follows the MCL-ratio rules. Either way, tier is a
      // valid tier value.
      for (const t of tiers) {
        expect(["concern", "caution", "context"]).toContain(t);
      }
      // For the PFOS row (whose name IS a PFAS hint), positive
      // detection forces caution — proves the display observation
      // (not the count of observations) drives classification.
      const pfos = out.contaminants?.find((c) => c.contaminant_name === "PFOS");
      expect(pfos?.tier).toBe("caution");
    });

    it("preserves PFOS 5.7-in-both as display + one other (NOT collapsed into a single observation)", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: KALAMAZOO_PFAS_ROWS }),
      });
      const pfos = out.contaminants?.find((c) => c.contaminant_name === "PFOS");
      expect(pfos).toBeDefined();
      expect(pfos?.detected_level).toBe(5.7);
      expect(pfos?.other_observations).toHaveLength(1);
      expect(pfos?.other_observations[0].detected_level).toBe(5.7);
      // Display and other must come from different tables — same
      // value, different provenance.
      expect(pfos?.source_table_label).not.toBe(
        pfos?.other_observations[0].source_table_label,
      );
    });

    it("chooses the more-recent observation as display (2024 RAA beats 2023-2024 UCMR5)", () => {
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: KALAMAZOO_PFAS_ROWS }),
      });
      const pfbs = out.contaminants?.find((c) => c.contaminant_name === "PFBS");
      expect(pfbs?.detected_level).toBe(7.4);
      expect(pfbs?.monitoring_period).toBe("2024");
      expect(pfbs?.other_observations[0].detected_level).toBe(6.2);
      expect(pfbs?.other_observations[0].monitoring_period).toBe("2023-2024");
    });

    it("falls back to monitoring_period for grouping disambiguation when source_table_label is null (v1 row compatibility)", () => {
      // Two PFOA rows with no source_table_label (legacy v1 rows that
      // haven't been reanalyzed). monitoring_period still differs.
      const v1Rows: CcrDetectedContaminant[] = [
        contaminant({
          contaminant_name: "PFOA",
          detected_level: 2.2,
          unit: "ppt",
          mcl: 100,
          monitoring_period: "2023-2024",
          source_table_label: null,
        }),
        contaminant({
          contaminant_name: "PFOA",
          detected_level: 3.1,
          unit: "ppt",
          mcl: 100,
          monitoring_period: "2024",
          source_table_label: null,
        }),
      ];
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: v1Rows }),
      });
      expect(out.contaminants).toHaveLength(1);
      expect(out.contaminants?.[0].has_multiple_observations).toBe(true);
      expect(out.contaminants?.[0].monitoring_period).toBe("2024");
      expect(out.contaminants?.[0].other_observations[0].monitoring_period).toBe(
        "2023-2024",
      );
    });

    it("groups case-insensitively (PFOA / pfoa / PFOA  treated as one analyte)", () => {
      const rows: CcrDetectedContaminant[] = [
        contaminant({ contaminant_name: "PFOA", detected_level: 2 }),
        contaminant({ contaminant_name: "pfoa", detected_level: 3 }),
        contaminant({ contaminant_name: "PFOA  ", detected_level: 4 }),
      ];
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: rows }),
      });
      expect(out.contaminants).toHaveLength(1);
      expect(out.contaminants?.[0].other_observations).toHaveLength(2);
    });

    it("does not merge rows that happen to share a monitoring_period when names differ", () => {
      // PFOA and PFOS both extracted from the same table — they must
      // remain as separate analytes, not collapse on table identity.
      const rows: CcrDetectedContaminant[] = [
        contaminant({
          contaminant_name: "PFOA",
          detected_level: 2.2,
          mcl: 100,
          monitoring_period: "2024",
          source_table_label: "T1",
        }),
        contaminant({
          contaminant_name: "PFOS",
          detected_level: 5.7,
          mcl: 100,
          monitoring_period: "2024",
          source_table_label: "T1",
        }),
      ];
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: rows }),
      });
      expect(out.contaminants).toHaveLength(2);
      expect(out.contaminants?.every((c) => !c.has_multiple_observations)).toBe(
        true,
      );
    });

    it("sorts grouped rows by tier on display_observation only (concern wins even when alt observation is below caution)", () => {
      // Grouped analyte A: display 5 vs MCL 3 (concern), other 0.1
      // vs MCL 3 (context). Tier on the DISPLAY → concern.
      // Single-observation analyte B: context.
      const rows: CcrDetectedContaminant[] = [
        contaminant({
          contaminant_name: "Trihalomethanes",
          detected_level: 0.1,
          mcl: 3,
          monitoring_period: "2023",
        }),
        contaminant({
          contaminant_name: "Trihalomethanes",
          detected_level: 5,
          mcl: 3,
          monitoring_period: "2024",
        }),
        contaminant({
          contaminant_name: "Atrazine",
          detected_level: 0.1,
          mcl: 3,
        }),
      ];
      const out = buildCcrFindings({
        reportYear: 2024,
        publishedDate: null,
        extractedData: extracted({ detected_contaminants: rows }),
      });
      expect(out.contaminants?.map((c) => c.contaminant_name)).toEqual([
        "Trihalomethanes",
        "Atrazine",
      ]);
      expect(out.contaminants?.[0].tier).toBe("concern");
    });
  });
});

describe("normalizeContaminantGroupKey", () => {
  it("lowercases and trims the name", () => {
    expect(normalizeContaminantGroupKey("  PFOA  ")).toBe("pfoa");
  });

  it("preserves distinguishing punctuation (display name nuance lives on the rows)", () => {
    expect(normalizeContaminantGroupKey("Total Trihalomethanes")).toBe(
      "total trihalomethanes",
    );
  });
});

describe("extractMostRecentYear", () => {
  it("returns null for null", () => {
    expect(extractMostRecentYear(null)).toBeNull();
  });

  it("returns null when no plausible year is present", () => {
    expect(extractMostRecentYear("Annual")).toBeNull();
    expect(extractMostRecentYear("Q3")).toBeNull();
  });

  it("extracts a single year", () => {
    expect(extractMostRecentYear("2024")).toBe(2024);
    expect(extractMostRecentYear("Q3 2023")).toBe(2023);
  });

  it("returns the highest year in a range string", () => {
    expect(extractMostRecentYear("2023-2024")).toBe(2024);
    expect(extractMostRecentYear("2020 to 2022")).toBe(2022);
  });

  it("ignores out-of-range four-digit numbers", () => {
    // A bare "1899" is unlikely in a CCR period, but if it appears
    // we don't want it; the regex only accepts 19xx / 20xx / 21xx.
    expect(extractMostRecentYear("Period 1899")).toBeNull();
  });
});

describe("mclRatio (issue #199 sort signal)", () => {
  it("returns detected_level / mcl when both are present", () => {
    expect(mclRatio(contaminant({ detected_level: 2, mcl: 10 }))).toBe(0.2);
  });

  it("falls back to mcl_action_level when MCL is null (LCR pattern)", () => {
    expect(
      mclRatio(
        contaminant({ detected_level: 12, mcl: null, mcl_action_level: 15 }),
      ),
    ).toBeCloseTo(0.8);
  });

  it("returns null when detected_level is null", () => {
    expect(mclRatio(contaminant({ detected_level: null }))).toBeNull();
  });

  it("returns null when neither MCL nor action level is present", () => {
    expect(
      mclRatio(
        contaminant({
          detected_level: 5,
          mcl: null,
          mcl_action_level: null,
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the limit is zero or negative (defensive)", () => {
    expect(mclRatio(contaminant({ detected_level: 1, mcl: 0 }))).toBeNull();
    expect(mclRatio(contaminant({ detected_level: 1, mcl: -1 }))).toBeNull();
  });
});

describe("extractEarliestYear", () => {
  it("returns the lowest year mentioned in a range string", () => {
    expect(extractEarliestYear("2023-2024")).toBe(2023);
    expect(extractEarliestYear("2020 to 2022")).toBe(2020);
  });

  it("returns the single year for a point period", () => {
    expect(extractEarliestYear("2024")).toBe(2024);
  });

  it("returns null when no plausible year is present", () => {
    expect(extractEarliestYear(null)).toBeNull();
    expect(extractEarliestYear("Annual")).toBeNull();
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
