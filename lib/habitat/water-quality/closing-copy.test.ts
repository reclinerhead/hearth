import { describe, it, expect } from "vitest";
import {
  buildWqaNextSteps,
  buildWqaDataSources,
} from "./closing-copy";

describe("buildWqaNextSteps", () => {
  it("returns Learn → Test → Get involved in order", () => {
    const steps = buildWqaNextSteps({ freeTestingOffer: null });
    expect(steps.map((s) => s.key)).toEqual(["learn", "test", "involve"]);
    expect(steps[0].title).toBe("Learn.");
    expect(steps[2].title).toBe("Get involved.");
  });

  it("points at the utility's free testing (with the CCR contact) when offered", () => {
    const steps = buildWqaNextSteps({
      freeTestingOffer: { offered: true, contact_value: "(269) 337-8550" },
    });
    const test = steps.find((s) => s.key === "test")!;
    expect(test.body).toContain("offers free residential water testing");
    expect(test.body).toContain("reach them at (269) 337-8550");
  });

  it("omits the 'reach them at' clause when the offer has no contact value", () => {
    const steps = buildWqaNextSteps({
      freeTestingOffer: { offered: true, contact_value: null },
    });
    const test = steps.find((s) => s.key === "test")!;
    expect(test.body).toContain("offers free residential water testing");
    expect(test.body).not.toContain("reach them at");
  });

  it("uses the generic tap-test guidance when no offer is on file", () => {
    const steps = buildWqaNextSteps({ freeTestingOffer: null });
    const test = steps.find((s) => s.key === "test")!;
    expect(test.body).not.toContain("offers free residential water testing");
    expect(test.body).toContain("county health department");
  });

  it("treats an offer with offered:false as no offer", () => {
    const steps = buildWqaNextSteps({
      freeTestingOffer: { offered: false, contact_value: "(269) 337-8550" },
    });
    const test = steps.find((s) => s.key === "test")!;
    expect(test.body).not.toContain("offers free residential water testing");
    expect(test.body).not.toContain("(269) 337-8550");
  });
});

describe("buildWqaDataSources", () => {
  it("lists CCR then SDWIS when both are sources", () => {
    const sources = buildWqaDataSources({
      ccrProvenance: { year: 2024, uploadedByName: null, uploadedOnLabel: null },
      usedSdwis: true,
    });
    expect(sources.map((s) => s.key)).toEqual(["ccr", "sdwis"]);
    expect(sources[0].title).toContain("2024 Consumer Confidence Report (CCR)");
    expect(sources[1].title).toContain("Safe Drinking Water Information System (SDWIS)");
  });

  it("omits the SDWIS entry when SDWIS wasn't a source", () => {
    const sources = buildWqaDataSources({
      ccrProvenance: { year: 2024, uploadedByName: null, uploadedOnLabel: null },
      usedSdwis: false,
    });
    expect(sources.map((s) => s.key)).toEqual(["ccr"]);
  });

  it("omits the CCR entry when there's no CCR provenance", () => {
    const sources = buildWqaDataSources({ ccrProvenance: null, usedSdwis: true });
    expect(sources.map((s) => s.key)).toEqual(["sdwis"]);
  });

  it("returns an empty list when neither source applies", () => {
    expect(buildWqaDataSources({ ccrProvenance: null, usedSdwis: false })).toEqual([]);
  });

  it("shows a dated credit without a name when only the date is known", () => {
    const [ccr] = buildWqaDataSources({
      ccrProvenance: { year: 2024, uploadedByName: null, uploadedOnLabel: "May 31, 2026" },
      usedSdwis: false,
    });
    expect(ccr.body).toContain("(uploaded May 31, 2026)");
    expect(ccr.body).not.toContain("uploaded by");
  });

  it("names the uploader when both name and date are supplied", () => {
    const [ccr] = buildWqaDataSources({
      ccrProvenance: { year: 2024, uploadedByName: "Todd Wyatt", uploadedOnLabel: "May 31, 2026" },
      usedSdwis: false,
    });
    expect(ccr.body).toContain("(uploaded by Todd Wyatt on May 31, 2026)");
  });

  it("drops the year prefix when the coverage year is unknown", () => {
    const [ccr] = buildWqaDataSources({
      ccrProvenance: { year: null, uploadedByName: null, uploadedOnLabel: null },
      usedSdwis: false,
    });
    expect(ccr.title).toBe("Your utility's Consumer Confidence Report (CCR)");
  });
});
