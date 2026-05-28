// Regression tests for the CCR extraction Zod schema. Issue #176 — WQA-3.
//
// Two contracts the schema enforces:
//
//   1. Partial extractions validate. Every top-level section is
//      independently nullable so the model can return honest partial
//      data when a CCR is missing a section. The tests below confirm
//      a fully-null payload (with just ai_confidence set) is valid.
//
//   2. Out-of-scope categories have nowhere to land. The schema has no
//      fields for source-water info, infrastructure plans, customer
//      tips, etc. — generateObject rejects unknown fields by default,
//      so even if the model tried to extract them they wouldn't make
//      it through. The tests below confirm a sample of excluded
//      field names are rejected.

import { describe, it, expect } from "vitest";
import { ccrExtractionSchema } from "./ccr-schema";

describe("ccrExtractionSchema", () => {
  describe("happy path", () => {
    it("validates a complete extraction with every section populated", () => {
      const valid = {
        header_metadata: {
          utility_name: "<placeholder utility name>",
          pwsid: "AB1234567",
          report_year: 2024,
          publication_date: "2025-05-15",
        },
        detected_contaminants: [
          {
            contaminant_name: "<contaminant A>",
            contaminant_code: null,
            detected_level: 0.5,
            unit: "ppb",
            mcl: 10,
            mclg: 0,
            mcl_action_level: null,
            sources: "<source boilerplate>",
            monitoring_period: "2024",
            violation_in_period_ind: false,
            notes: null,
          },
        ],
        lead_copper_distribution: {
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
        },
        ucmr_results: [
          {
            contaminant_name: "<UCMR contaminant>",
            detected_level: 0.0021,
            unit: "ppt",
            monitoring_period: "2023-2025",
          },
        ],
        free_testing_offer: {
          offered: true,
          contact_method: "phone",
          contact_value: "<phone as printed>",
        },
        ai_confidence: 0.91,
      };

      expect(() => ccrExtractionSchema.parse(valid)).not.toThrow();
    });

    it("validates a fully-null payload (ai_confidence the only required field)", () => {
      const minimal = {
        header_metadata: null,
        detected_contaminants: null,
        lead_copper_distribution: null,
        ucmr_results: null,
        free_testing_offer: null,
        ai_confidence: 0.1,
      };

      expect(() => ccrExtractionSchema.parse(minimal)).not.toThrow();
    });

    it("validates an extraction with some sections populated and others null", () => {
      const partial = {
        header_metadata: {
          utility_name: "<placeholder>",
          pwsid: "AB1234567",
          report_year: 2024,
          publication_date: null,
        },
        detected_contaminants: [],
        lead_copper_distribution: null,
        ucmr_results: null,
        free_testing_offer: null,
        ai_confidence: 0.7,
      };

      expect(() => ccrExtractionSchema.parse(partial)).not.toThrow();
    });
  });

  describe("nullability — sections", () => {
    it("accepts null for header_metadata", () => {
      const data = baseValid({ header_metadata: null });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts null for detected_contaminants", () => {
      const data = baseValid({ detected_contaminants: null });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts an empty array for detected_contaminants", () => {
      const data = baseValid({ detected_contaminants: [] });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts null for lead_copper_distribution", () => {
      const data = baseValid({ lead_copper_distribution: null });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts null for ucmr_results", () => {
      const data = baseValid({ ucmr_results: null });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts null for free_testing_offer", () => {
      const data = baseValid({ free_testing_offer: null });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });
  });

  describe("free_testing_offer shape", () => {
    it("accepts offered=true with full contact info", () => {
      const data = baseValid({
        free_testing_offer: {
          offered: true,
          contact_method: "phone",
          contact_value: "<phone as printed>",
        },
      });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts offered=true with null contact (offer present but no method recorded)", () => {
      const data = baseValid({
        free_testing_offer: {
          offered: true,
          contact_method: null,
          contact_value: null,
        },
      });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("accepts offered=false (no free testing in this CCR)", () => {
      const data = baseValid({
        free_testing_offer: {
          offered: false,
          contact_method: null,
          contact_value: null,
        },
      });
      expect(() => ccrExtractionSchema.parse(data)).not.toThrow();
    });

    it("rejects contact_method outside the enum", () => {
      const data = baseValid({
        free_testing_offer: {
          offered: true,
          contact_method: "fax",
          contact_value: "<phone as printed>",
        },
      });
      expect(() => ccrExtractionSchema.parse(data)).toThrow();
    });
  });

  describe("scope discipline — out-of-scope categories have no schema home", () => {
    // These assertions are the schema-level enforcement of the
    // ignore-narrative rule in the prompt. Even if the model tried to
    // extract source-water assessments, infrastructure plans, or
    // customer tips, the schema would reject them because the fields
    // simply do not exist on the type.

    it("does not expose any 'source_water' field", () => {
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.source_water).toBeUndefined();
      expect(shape.source_water_information).toBeUndefined();
      expect(shape.source_water_assessment).toBeUndefined();
      expect(shape.watershed).toBeUndefined();
    });

    it("does not expose any 'infrastructure' / 'improvements' field", () => {
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.infrastructure).toBeUndefined();
      expect(shape.infrastructure_plans).toBeUndefined();
      expect(shape.improvements).toBeUndefined();
      expect(shape.capital_projects).toBeUndefined();
    });

    it("does not expose any 'tips' / 'education' / 'narrative' field", () => {
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.tips).toBeUndefined();
      expect(shape.customer_tips).toBeUndefined();
      expect(shape.education).toBeUndefined();
      expect(shape.educational_narrative).toBeUndefined();
      expect(shape.narrative).toBeUndefined();
      expect(shape.narrative_facts).toBeUndefined();
    });

    it("does not expose any 'awards' / 'certifications' field", () => {
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.awards).toBeUndefined();
      expect(shape.recognitions).toBeUndefined();
      expect(shape.certifications).toBeUndefined();
    });

    it("does not expose any 'pricing' / 'rates' / 'billing' field", () => {
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.pricing).toBeUndefined();
      expect(shape.rates).toBeUndefined();
      expect(shape.rate_structure).toBeUndefined();
      expect(shape.billing).toBeUndefined();
    });

    it("does not expose any 'lead_service_line_program' / 'replacement_plan' narrative field", () => {
      // The lead_copper_distribution.lead_service_line_count COUNT is
      // the only LSL field we extract; the narrative around the
      // replacement program has no schema home.
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.lead_service_line_program).toBeUndefined();
      expect(shape.lsl_program).toBeUndefined();
      expect(shape.replacement_plan).toBeUndefined();
      expect(shape.replacement_program).toBeUndefined();
    });

    it("does not expose any 'compliance_summary' / 'violation_narrative' field", () => {
      // Actual compliance signal comes from WQA-2's SDWIS pull, not
      // from CCR prose.
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      expect(shape.compliance).toBeUndefined();
      expect(shape.compliance_summary).toBeUndefined();
      expect(shape.violation_narrative).toBeUndefined();
      expect(shape.violation_summary).toBeUndefined();
    });

    it("exposes ONLY the five in-scope sections plus ai_confidence", () => {
      // The headline invariant. Any future edit adding a sixth top-
      // level field must explicitly update this assertion (and the
      // architecture issue), forcing a deliberate decision rather
      // than quiet scope creep.
      const shape = ccrExtractionSchema.shape as Record<string, unknown>;
      const keys = Object.keys(shape).sort();
      expect(keys).toEqual(
        [
          "ai_confidence",
          "detected_contaminants",
          "free_testing_offer",
          "header_metadata",
          "lead_copper_distribution",
          "ucmr_results",
        ].sort(),
      );
    });
  });

  describe("validation rejects malformed shapes", () => {
    it("rejects ai_confidence outside [0, 1]", () => {
      const data = baseValid({ ai_confidence: 1.5 });
      expect(() => ccrExtractionSchema.parse(data)).toThrow();

      const negative = baseValid({ ai_confidence: -0.1 });
      expect(() => ccrExtractionSchema.parse(negative)).toThrow();
    });

    it("rejects a missing ai_confidence", () => {
      const incomplete = {
        header_metadata: null,
        detected_contaminants: null,
        lead_copper_distribution: null,
        ucmr_results: null,
        free_testing_offer: null,
      };
      expect(() => ccrExtractionSchema.parse(incomplete)).toThrow();
    });

    it("rejects a contaminant row missing the required contaminant_name", () => {
      const data = baseValid({
        detected_contaminants: [
          {
            contaminant_code: null,
            detected_level: 0.5,
            unit: "ppb",
            mcl: 10,
            mclg: 0,
            mcl_action_level: null,
            sources: null,
            monitoring_period: null,
            violation_in_period_ind: null,
            notes: null,
          } as unknown,
        ],
      });
      expect(() => ccrExtractionSchema.parse(data)).toThrow();
    });

    it("rejects header_metadata.report_year outside the sanity range", () => {
      const tooEarly = baseValid({
        header_metadata: {
          utility_name: null,
          pwsid: null,
          report_year: 1899,
          publication_date: null,
        },
      });
      expect(() => ccrExtractionSchema.parse(tooEarly)).toThrow();

      const tooLate = baseValid({
        header_metadata: {
          utility_name: null,
          pwsid: null,
          report_year: 3001,
          publication_date: null,
        },
      });
      expect(() => ccrExtractionSchema.parse(tooLate)).toThrow();
    });

    it("rejects a UCMR result missing the required contaminant_name", () => {
      const data = baseValid({
        ucmr_results: [
          {
            detected_level: 0.0021,
            unit: "ppt",
            monitoring_period: null,
          } as unknown,
        ],
      });
      expect(() => ccrExtractionSchema.parse(data)).toThrow();
    });
  });
});

// Helper to build a valid baseline payload that individual tests
// override. Keeping it inline (not exported) so a future edit to the
// schema doesn't accidentally rebuild the wrong shape elsewhere.
function baseValid(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    header_metadata: null,
    detected_contaminants: null,
    lead_copper_distribution: null,
    ucmr_results: null,
    free_testing_offer: null,
    ai_confidence: 0.8,
    ...overrides,
  };
}
