import { describe, it, expect } from "vitest";
import type { CcrSummarizedContaminant } from "@/lib/habitat/modules/water-quality-awareness/ccr";
import type { CcrFreeTestingOffer } from "@/lib/documents/ai/ccr-schema";
import type { DetectedContaminantInput } from "@/lib/habitat/water-quality/remediation/recommend";
import { TODDTECH_HEARTH_URL } from "../constants";
import { buildReportFooterTemplate } from "../theme";
import {
  groupPfasFamily,
  PFAS_FAMILY_HEADING,
} from "@/lib/habitat/water-quality/contaminants/pfas-grouping";
import {
  buildWaterQualityReport,
  waterQualityReportSignature,
  type WaterQualityReportInput,
} from "./report";

/** The EPA PFAS reference URL, used by the family card (from the data entry). */
const PFAS_LEARN_MORE_URL = "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas";

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
    usedSdwis: true,
    ccrProvenance: { year: 2024, uploadedByName: null, uploadedOnLabel: "May 31, 2026" },
    adminContact: { name: "James Baker", email: "water@kalamazoo.gov", phone: "(269) 555-0100" },
    ccrArchiveUrl: null,
    ...overrides,
  };
}

describe("buildWaterQualityReport", () => {
  it("renders the address in the header", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("123 Maple St, Kalamazoo, MI 49001");
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

  it("renders all four distinct matrix cell states as inline SVG (not font glyphs)", () => {
    const html = buildWaterQualityReport(baseInput());
    // Each state is present and distinct.
    expect(html).toContain("eff-full");
    expect(html).toContain("eff-partial");
    expect(html).toContain("eff-unreliable");
    expect(html).toContain("eff-none");
    // Shapes are SVG vectors, so they embed font-independently and render on
    // iOS / every PDF viewer (issue #241) — not the old Unicode glyphs that
    // relied on a font fallback that didn't survive into the PDF.
    expect(html).toContain("<svg");
    expect(html).not.toContain("●");
    expect(html).not.toContain("◐");
    expect(html).not.toContain("△");
  });

  it("highlights detected rows in the matrix", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("row-detected");
    expect(html).toContain("in your water");
  });

  it("carries a guaranteed-clickable ToddTech credit in the document body", () => {
    const html = buildWaterQualityReport(baseInput());
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

  it("lists data sources with acronyms spelled out and a dated CCR provenance (no name)", () => {
    const html = buildWaterQualityReport(baseInput());
    expect(html).toContain("Where this data comes from");
    expect(html).toContain("Consumer Confidence Report (CCR)");
    expect(html).toContain("Safe Drinking Water Information System (SDWIS)");
    expect(html).toContain("2024 Consumer Confidence Report");
    // Dated provenance, but the uploader's name is intentionally not shown
    // (the report is forwardable — name + address shouldn't travel together).
    expect(html).toContain("uploaded May 31, 2026");
    expect(html).not.toContain("uploaded by");
  });

  it("omits the SDWIS bullet when SDWIS wasn't a source", () => {
    const html = buildWaterQualityReport(baseInput({ usedSdwis: false }));
    expect(html).not.toContain("Safe Drinking Water Information System");
  });

  it("still supports an uploader name when one is supplied (template capability)", () => {
    const html = buildWaterQualityReport(
      baseInput({ ccrProvenance: { year: 2024, uploadedByName: "Todd Wyatt", uploadedOnLabel: "May 31, 2026" } }),
    );
    expect(html).toContain("uploaded by Todd Wyatt on May 31, 2026");
  });

  it("renders a clean-water message when nothing was detected", () => {
    const html = buildWaterQualityReport(baseInput({ contaminants: [], detected: [] }));
    expect(html).toContain("no measurable detections");
  });
});

function pfas(name: string, level: number, mcl: number): CcrSummarizedContaminant {
  return contaminant(name, "caution", level, "ppt", mcl);
}

describe("groupPfasFamily (issue #234)", () => {
  it("folds 2+ PFAS analytes into one family entry at the first PFAS position", () => {
    const items = groupPfasFamily([
      contaminant("Lead", "concern", 9, "ppb", 15),
      pfas("Perfluorooctanoic acid (PFOA)", 6, 4),
      pfas("Perfluorooctane sulfonic acid (PFOS)", 10, 4),
      contaminant("Total Trihalomethanes", "context", 20, "ppb", 80),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["single", "pfasFamily", "single"]);
    const family = items[1];
    if (family.kind !== "pfasFamily") throw new Error("expected family");
    expect(family.analytes).toHaveLength(2);
  });

  it("orders analytes within the family by detected level, descending", () => {
    const items = groupPfasFamily([
      pfas("Perfluorooctanoic acid (PFOA)", 6, 4),
      pfas("Perfluorohexane sulfonic acid (PFHxS)", 10, 51),
    ]);
    const family = items[0];
    if (family.kind !== "pfasFamily") throw new Error("expected family");
    expect(family.analytes[0].contaminant_name).toContain("PFHxS");
  });

  it("leaves a lone PFAS analyte as a normal single card (0/1-row guard)", () => {
    const items = groupPfasFamily([
      contaminant("Lead", "concern", 9, "ppb", 15),
      pfas("Perfluorooctanoic acid (PFOA)", 6, 4),
    ]);
    expect(items.every((i) => i.kind === "single")).toBe(true);
  });
});

describe("PFAS family card rendering", () => {
  function withFivePfas(): WaterQualityReportInput {
    return baseInput({
      contaminants: [
        contaminant("Copper", "caution", 1, "ppm", 1.3),
        contaminant("Lead", "caution", 9, "ppb", 15),
        pfas("Perfluorooctanoic acid (PFOA)", 6, 4),
        pfas("Perfluorooctane sulfonic acid (PFOS)", 10, 4),
        pfas("Perfluorohexane sulfonic acid (PFHxS)", 4, 51),
        pfas("Perfluorobutane sulfonic acid (PFBS)", 3, 2000),
        pfas("Perfluorohexanoic acid (PFHxA)", 5, 400000),
      ],
    });
  }

  it("renders one family card (body + all five analytes + a single EPA link)", () => {
    const html = buildWaterQualityReport(withFivePfas());
    // Heading + family body (the dedicated reference description) present.
    expect(html).toContain(PFAS_FAMILY_HEADING);
    expect(html).toContain("per- and polyfluoroalkyl substances");
    // All five analytes listed by their printed names.
    for (const a of ["PFOA", "PFOS", "PFHxS", "PFBS", "PFHxA"]) {
      expect(html).toContain(a);
    }
    // Exactly one EPA reference link for the family.
    const links = html.split(`href="${PFAS_LEARN_MORE_URL}"`).length - 1;
    expect(links).toBe(1);
    // Non-PFAS contaminants still render their own cards.
    expect(html).toContain("Copper");
    expect(html).toContain("Lead");
  });

  it("does not render a family wrapper when only one PFAS analyte is present", () => {
    // baseInput has a single PFAS analyte (PFOA).
    const html = buildWaterQualityReport(baseInput());
    expect(html).not.toContain(PFAS_FAMILY_HEADING);
  });
});

describe("buildReportFooterTemplate (running per-page footer)", () => {
  it("carries the in-app tagline, the address, and the ToddTech attribution", () => {
    const footer = buildReportFooterTemplate("123 Maple St, Kalamazoo, MI 49001");
    expect(footer).toContain("Home Awareness");
    expect(footer).toContain("123 Maple St, Kalamazoo, MI 49001");
    expect(footer).toContain("Powered by");
    expect(footer).toContain(`href="${TODDTECH_HEARTH_URL}"`);
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
