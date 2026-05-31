import { describe, it, expect } from "vitest";
import type { CcrSummarizedContaminant } from "@/lib/habitat/modules/water-quality-awareness/ccr";
import type { CcrFreeTestingOffer } from "@/lib/documents/ai/ccr-schema";
import type { DetectedContaminantInput } from "@/lib/habitat/water-quality/remediation/recommend";
import { TODDTECH_HEARTH_URL } from "../constants";
import {
  buildWaterQualityReport,
  waterQualityReportSignature,
  type WaterQualityReportInput,
} from "./report";

/** Minimal CcrSummarizedContaminant fixtures — only the fields the report reads. */
function contaminant(
  name: string,
  tier: CcrSummarizedContaminant["tier"],
  level: number | null,
  unit: string | null,
  mcl: number | null,
): CcrSummarizedContaminant {
  return {
    contaminant_name: name,
    detected_level: level,
    unit,
    mcl,
    tier,
    has_multiple_observations: false,
    other_observations: [],
  } as unknown as CcrSummarizedContaminant;
}

function baseInput(overrides: Partial<WaterQualityReportInput> = {}): WaterQualityReportInput {
  const contaminants = [
    contaminant("Lead", "concern", 0.018, "mg/L", 0.015),
    contaminant("PFOA", "caution", 0.000006, "mg/L", 0.000004),
    contaminant("Total Trihalomethanes", "context", 0.02, "mg/L", 0.08),
  ];
  const detected: DetectedContaminantInput[] = [
    { name: "Lead", code: "PB90", level_label: "18 ppb" },
    { name: "PFOA", code: null, level_label: "6 ppt" },
  ];
  return {
    address: "123 Maple St, Kalamazoo, MI 49001",
    reportDateLabel: "May 31, 2026",
    utilityName: "City of Kalamazoo Water",
    pwsid: "MI0000123",
    sourceWaterLabel: "ground water",
    reportYear: 2024,
    contaminants,
    detected,
    freeTestingOffer: null,
    adminContact: { name: "James Baker", email: "water@kalamazoo.gov", phone: "(269) 555-0100" },
    ccrArchiveUrl: null,
    ...overrides,
  };
}

describe("buildWaterQualityReport", () => {
  it("renders the address in the header and the running footer", () => {
    const html = buildWaterQualityReport(baseInput());
    // Header + footer both carry the address (footer survives page separation).
    const occurrences = html.split("123 Maple St, Kalamazoo, MI 49001").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("lists detected contaminants in the summarizer's order with verbal tier cues", () => {
    const html = buildWaterQualityReport(baseInput());
    const leadAt = html.indexOf("Lead");
    const pfoaAt = html.indexOf("PFOA");
    const tthmAt = html.indexOf("Total Trihalomethanes");
    expect(leadAt).toBeGreaterThan(-1);
    expect(leadAt).toBeLessThan(pfoaAt);
    expect(pfoaAt).toBeLessThan(tthmAt);
    expect(html).toContain("Worth acting on"); // concern
    expect(html).toContain("Worth knowing"); // caution
    expect(html).toContain("Context"); // context
  });

  it("carries each contaminant's why-it-matters and a working EPA reference link", () => {
    const html = buildWaterQualityReport(baseInput());
    // Description text from the reference table (Lead entry).
    expect(html).toContain("There is no known safe level of lead exposure");
    // The per-contaminant EPA learn_more_url.
    expect(html).toContain(
      "https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water",
    );
    expect(html).toContain("https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas");
  });

  it("renders all four distinct matrix cell states", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("●"); // full
    expect(html).toContain("◐"); // partial
    expect(html).toContain("△"); // unreliable — distinct from none
    expect(html).toContain("—"); // none
  });

  it("highlights detected rows in the matrix", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("row-detected");
    expect(html).toContain("in your water");
  });

  it("links the footer attribution to the Hearth portfolio page with the in-app tagline", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("Home Awareness");
    expect(html).toContain(`href="${TODDTECH_HEARTH_URL}"`);
    expect(html).toContain("Powered by");
  });

  it("shows the free-testing affordance only when an offer is present", () => {
    const withoutOffer = buildWaterQualityReport(baseInput({ freeTestingOffer: null }));
    expect(withoutOffer).not.toContain("offers free residential water testing");

    const offer: CcrFreeTestingOffer = {
      offered: true,
      contact_method: "phone",
      contact_value: "(269) 555-0100",
    } as unknown as CcrFreeTestingOffer;
    const withOffer = buildWaterQualityReport(baseInput({ freeTestingOffer: offer }));
    expect(withOffer).toContain("offers free residential water testing");
  });

  it("never leaks contaminant codes into the PDF", () => {
    const html = buildWaterQualityReport(baseInput());
    // SDWIS / LCR codes that exist in the detected inputs and reference
    // aliases must not render — users see names, never codes.
    expect(html).not.toContain("PB90");
    expect(html).not.toContain("5000");
  });

  it("surfaces the spelled-out PWSID in the utility contact block (issue #207 exception)", () => {
    const html = buildWaterQualityReport(baseInput({ pwsid: "MI0000123" }));
    expect(html).toContain("Public Water Supply ID (PWSID)");
    expect(html).toContain("MI0000123");
    // ...but only when present.
    const withoutPwsid = buildWaterQualityReport(baseInput({ pwsid: null }));
    expect(withoutPwsid).not.toContain("Public Water Supply ID (PWSID)");
  });

  it("renders a clean-water message when nothing was detected", () => {
    const html = buildWaterQualityReport(baseInput({ contaminants: [], detected: [] }));
    expect(html).toContain("no measurable detections");
  });
});

describe("waterQualityReportSignature", () => {
  it("is stable for the same finding content version", () => {
    expect(waterQualityReportSignature("2026-05-31T00:00:00Z")).toBe(
      waterQualityReportSignature("2026-05-31T00:00:00Z"),
    );
  });

  it("changes when the finding's content version changes", () => {
    expect(waterQualityReportSignature("2026-05-31T00:00:00Z")).not.toBe(
      waterQualityReportSignature("2026-06-15T00:00:00Z"),
    );
  });
});
