import { describe, expect, it } from "vitest";
import {
  computePortfolioLabel,
  computeSiteLabel,
  labelWeight,
  LABEL_WORD,
  LABEL_COLOR,
} from "./label";

describe("computeSiteLabel", () => {
  it("returns worth_acting_on for Tier 1 + Final NPL + a high-concern contaminant", () => {
    expect(
      computeSiteLabel({ tier: 1, nplCode: "F", contaminants: ["Lead"] }),
    ).toBe("worth_acting_on");
    expect(
      computeSiteLabel({
        tier: 1,
        nplCode: "P",
        contaminants: ["Arsenic", "Mercury"],
      }),
    ).toBe("worth_acting_on");
  });

  it("returns worth_knowing for Tier 1 + Final NPL + only unknown chemistry (no enrichments match)", () => {
    expect(
      computeSiteLabel({
        tier: 1,
        nplCode: "F",
        contaminants: ["Some industrial residue"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for any Tier 1 site — including 'A' (part-of-NPL) and 'D' (deleted)", () => {
    expect(
      computeSiteLabel({ tier: 1, nplCode: "A", contaminants: [] }),
    ).toBe("worth_knowing");
    expect(
      computeSiteLabel({ tier: 1, nplCode: "D", contaminants: [] }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for Tier 2 + active cleanup (F or P)", () => {
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Trichloroethylene"],
      }),
    ).toBe("worth_knowing");
    expect(
      computeSiteLabel({ tier: 2, nplCode: "P", contaminants: [] }),
    ).toBe("worth_knowing");
  });

  it("promotes any tier with a high-concern contaminant to worth_knowing", () => {
    expect(
      computeSiteLabel({
        tier: 3,
        nplCode: "F",
        contaminants: ["Lead"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for Tier 2 with a moderate-concern contaminant", () => {
    // Toluene lands at concern_level='moderate' in the canonical
    // contaminants table — a realistic VOC for an inactive site.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "A",
        contaminants: ["Toluene"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns informational for Tier 3 + Final NPL + only unknown chemistry", () => {
    expect(
      computeSiteLabel({
        tier: 3,
        nplCode: "F",
        contaminants: ["Some industrial residue"],
      }),
    ).toBe("informational");
  });

  it("suppresses (null) for Tier 3 + no contaminants published", () => {
    expect(
      computeSiteLabel({ tier: 3, nplCode: "F", contaminants: [] }),
    ).toBeNull();
  });
});

describe("computePortfolioLabel", () => {
  it("returns the max non-null label across sites (n=1 / n=3 / n=5)", () => {
    // n=1
    expect(computePortfolioLabel(["worth_knowing"])).toBe("worth_knowing");
    // n=3
    expect(
      computePortfolioLabel([
        "informational",
        "worth_knowing",
        "informational",
      ]),
    ).toBe("worth_knowing");
    // n=5 with a worth_acting_on entry
    expect(
      computePortfolioLabel([
        "informational",
        "worth_knowing",
        "worth_acting_on",
        "worth_knowing",
        "informational",
      ]),
    ).toBe("worth_acting_on");
  });

  it("ignores null entries when finding the max", () => {
    expect(computePortfolioLabel([null, "informational", null])).toBe(
      "informational",
    );
    expect(computePortfolioLabel([null, "worth_knowing", null, null])).toBe(
      "worth_knowing",
    );
  });

  it("returns null when every per-site label is suppressed", () => {
    expect(computePortfolioLabel([null, null])).toBeNull();
    expect(computePortfolioLabel([null])).toBeNull();
  });

  it("returns null for an empty input (no qualifying sites)", () => {
    expect(computePortfolioLabel([])).toBeNull();
  });
});

describe("labelWeight", () => {
  it("treats null as the lowest weight so suppressed sites sort last", () => {
    expect(labelWeight(null)).toBe(0);
    expect(labelWeight("informational")).toBeGreaterThan(0);
    expect(labelWeight("worth_knowing")).toBeGreaterThan(
      labelWeight("informational"),
    );
    expect(labelWeight("worth_acting_on")).toBeGreaterThan(
      labelWeight("worth_knowing"),
    );
  });
});

describe("LABEL_WORD / LABEL_COLOR", () => {
  it("uses sentence-case words suitable for surface display", () => {
    expect(LABEL_WORD.worth_acting_on).toBe("Worth acting on");
    expect(LABEL_WORD.worth_knowing).toBe("Worth knowing");
    expect(LABEL_WORD.informational).toBe("Informational");
  });

  it("maps every label to a CSS variable token", () => {
    for (const label of [
      "worth_acting_on",
      "worth_knowing",
      "informational",
    ] as const) {
      expect(LABEL_COLOR[label]).toMatch(/^var\(--/);
    }
  });
});
