import { describe, expect, it } from "vitest";
import { summarizeWqaRecheckChanges } from "./recheck-summary";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import type { WqaFindings } from "./types";

function row(
  overrides: Partial<HabitatFindingRow> & {
    findings?: Partial<WqaFindings> | null;
  } = {},
): HabitatFindingRow {
  const { findings, ...rest } = overrides;
  const base: HabitatFindingRow = {
    module_key: "water_quality_awareness",
    status: "completed",
    severity: "neutral",
    headline: "",
    summary: "",
    findings: null,
    source_url: null,
    error: null,
    actions: null,
    activity_log: null,
    checked_at: "2026-05-28T12:00:00Z",
    ...rest,
  };
  if (findings === undefined) {
    return base;
  }
  if (findings === null) {
    return { ...base, findings: null };
  }
  return {
    ...base,
    findings: findings as unknown as Record<string, unknown>,
  };
}

function cwsNoCcrFindings(): WqaFindings {
  return {
    branch: "cws_no_ccr",
    system_card: {
      pws_name: "Kalamazoo Public Water Supply",
      pwsid: "MI0003520",
      description: "Groundwater system on file with EPA.",
      source_type: "groundwater",
      compliance_status_short: "no_active_violations",
      latest_ccr_status: "not_uploaded",
      source_water_protection_since: null,
    },
    branch_metadata: {
      branch: "cws_no_ccr",
      is_active: true,
      system_type: "CWS",
      admin_contact: null,
    },
  };
}

function cwsWithCcrFindings(args: {
  year: number;
  contaminantCount: number;
}): WqaFindings {
  const contaminants = Array.from({ length: args.contaminantCount }, (_, i) => ({
    contaminant_name: `Contaminant-${i + 1}`,
    contaminant_code: null,
    detected_level: 0.1,
    unit: "ppb",
    mcl: 1,
    mclg: 0,
    mcl_action_level: null,
    sources: null,
    monitoring_period: null,
    violation_in_period_ind: null,
    notes: null,
    tier: "context" as const,
  }));
  return {
    branch: "cws_with_ccr",
    system_card: {
      pws_name: "Kalamazoo Public Water Supply",
      pwsid: "MI0003520",
      description: "Groundwater system on file with EPA.",
      source_type: "groundwater",
      compliance_status_short: "no_active_violations",
      latest_ccr_status: { year: args.year },
      source_water_protection_since: null,
    },
    branch_metadata: {
      branch: "cws_with_ccr",
      is_active: true,
      system_type: "CWS",
      admin_contact: null,
    },
    ccr_findings: {
      report_year: args.year,
      published_date: null,
      contaminants,
      lead_copper_distribution: null,
      ucmr_results: null,
      free_testing_offer: null,
      ai_confidence: 0.9,
    },
  };
}

describe("summarizeWqaRecheckChanges", () => {
  describe("CCR-landed case", () => {
    it("returns the CCR-upload-aware copy when the source is 'ccr_upload' and CCR just landed", () => {
      const before = row({ findings: cwsNoCcrFindings() });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 17 }),
        severity: "caution",
      });
      const out = summarizeWqaRecheckChanges(before, after, "ccr_upload");
      expect(out).not.toBeNull();
      expect(out?.headline).toMatch(/just read your 2024 Water Quality Report/i);
      expect(out?.headline).toMatch(/17 contaminants/);
      expect(out?.tone).toBe("info");
    });

    it("returns the shared-cache-aware copy when the source is 'manual' and CCR just landed", () => {
      // Someone else on the same utility uploaded; this user's manual
      // recheck just picked it up from the shared cache.
      const before = row({ findings: cwsNoCcrFindings() });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 17 }),
        severity: "caution",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out).not.toBeNull();
      expect(out?.headline).toMatch(/another homeowner on the same system/i);
      expect(out?.headline).toMatch(/2024/);
      expect(out?.tone).toBe("info");
    });

    it("handles the no-prior-row case (modal opened after the trigger fired)", () => {
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
      });
      const out = summarizeWqaRecheckChanges(null, after, "ccr_upload");
      expect(out).not.toBeNull();
      expect(out?.headline).toMatch(/just read your 2024/);
    });

    it("falls back to a generic count clause when the report has zero detected contaminants", () => {
      const before = row({ findings: cwsNoCcrFindings() });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 0 }),
      });
      const out = summarizeWqaRecheckChanges(before, after, "ccr_upload");
      expect(out?.headline).toMatch(/full report is summarized below/);
    });

    it("does NOT fire CCR-landed copy when the row already had a CCR before", () => {
      // The CCR was already on file before the recheck; whatever
      // changed isn't the CCR landing. Either the severity transition
      // case fires or we return null.
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 10 }),
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 10 }),
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out).toBeNull();
    });
  });

  describe("severity-transition case", () => {
    it("surfaces the transition when severity changed AND CCR didn't just land", () => {
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "neutral",
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out).not.toBeNull();
      expect(out?.headline).toMatch(/worth knowing about/i);
      expect(out?.tone).toBe("info");
    });

    it("uses success tone when the transition is to 'favorable'", () => {
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "favorable",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out?.tone).toBe("success");
    });

    it("uses info tone when the transition is to 'concern'", () => {
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "concern",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out?.tone).toBe("info");
    });

    it("skips when there's no prior severity to compare against", () => {
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: null,
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out).toBeNull();
    });
  });

  describe("no-change case", () => {
    it("returns null when the row didn't meaningfully change", () => {
      const before = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const after = row({
        findings: cwsWithCcrFindings({ year: 2024, contaminantCount: 5 }),
        severity: "caution",
      });
      const out = summarizeWqaRecheckChanges(before, after, "manual");
      expect(out).toBeNull();
    });

    it("returns null when the after row has no findings yet (still running)", () => {
      const after = row({ findings: null });
      const out = summarizeWqaRecheckChanges(null, after, "manual");
      expect(out).toBeNull();
    });
  });
});
