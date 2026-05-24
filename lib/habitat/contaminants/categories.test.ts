import { describe, expect, it } from "vitest";
import {
  capitalizeCategoryPhrase,
  CONTAMINANT_CATEGORY_LABELS,
  summarizeContaminantCategories,
} from "./categories";
import { findContaminantByAlias } from "./lookup";
import type { Contaminant } from "./data";

/** Resolve a list of canonical names to Contaminant objects. Throws on
 *  any unknown name so a test typo is loud rather than a silent skip. */
function resolve(names: string[]): Contaminant[] {
  return names.map((n) => {
    const c = findContaminantByAlias(n);
    if (!c) {
      throw new Error(`fixture: unknown contaminant ${n}`);
    }
    return c;
  });
}

describe("summarizeContaminantCategories", () => {
  it("returns empty string for empty input", () => {
    expect(summarizeContaminantCategories([])).toBe("");
  });

  it("returns a single category label when all contaminants share one category", () => {
    // Lead + Arsenic + Mercury are all heavy_metal.
    expect(
      summarizeContaminantCategories(resolve(["Lead", "Arsenic", "Mercury"])),
    ).toBe("heavy metals");
  });

  it("joins two categories with 'and' (no Oxford comma at length 2)", () => {
    // Lead (heavy_metal) + Trichloroethene (vocs). VOCs has higher
    // priority so it leads.
    expect(
      summarizeContaminantCategories(
        resolve(["Lead", "Trichloroethene"]),
      ),
    ).toBe("volatile organic compounds and heavy metals");
  });

  it("joins three categories with Oxford comma and 'and'", () => {
    // VOC (TCE) + heavy_metal (Lead) + pcbs_dioxins (PCBs).
    expect(
      summarizeContaminantCategories(
        resolve(["Trichloroethene", "Lead", "Polychlorinated biphenyls"]),
      ),
    ).toBe("volatile organic compounds, heavy metals, and PCBs and dioxins");
  });

  it("truncates at the default cap (3 labels) and suffixes 'and other contaminants' when there are more categories", () => {
    // Six distinct categories — should show the top three by priority
    // (vocs, heavy_metal, pcbs_dioxins) then "and other contaminants".
    const result = summarizeContaminantCategories(
      resolve([
        "Trichloroethene", // vocs
        "Lead", // heavy_metal
        "Polychlorinated biphenyls", // pcbs_dioxins
        "Benzo(a)pyrene", // pahs
        "PFOA", // pfas
        "DDT", // pesticides
      ]),
    );
    expect(result).toBe(
      "volatile organic compounds, heavy metals, and PCBs and dioxins, and other contaminants",
    );
  });

  it("honors a custom maxLabels option", () => {
    // Same six-category input, but truncate to two — the trailing
    // "and other contaminants" still fires because there were more
    // than maxLabels categories.
    const result = summarizeContaminantCategories(
      resolve([
        "Trichloroethene",
        "Lead",
        "Polychlorinated biphenyls",
        "Benzo(a)pyrene",
      ]),
      { maxLabels: 2 },
    );
    expect(result).toBe(
      "volatile organic compounds and heavy metals, and other contaminants",
    );
  });

  it("dedups categories so the same chemical at five sites counts once", () => {
    expect(
      summarizeContaminantCategories(
        resolve(["Lead", "Lead", "Lead", "Lead", "Lead"]),
      ),
    ).toBe("heavy metals");
  });

  it("orders categories by editorial priority regardless of input order", () => {
    // Same two contaminants, two input orders → same output.
    const a = summarizeContaminantCategories(
      resolve(["Lead", "Trichloroethene"]),
    );
    const b = summarizeContaminantCategories(
      resolve(["Trichloroethene", "Lead"]),
    );
    expect(a).toBe(b);
  });
});

describe("capitalizeCategoryPhrase", () => {
  it("uppercases the first character of a lowercase-leading phrase", () => {
    expect(capitalizeCategoryPhrase("heavy metals")).toBe("Heavy metals");
    expect(capitalizeCategoryPhrase("volatile organic compounds")).toBe(
      "Volatile organic compounds",
    );
  });

  it("leaves an already-capitalized phrase alone (PFAS, PCBs)", () => {
    expect(capitalizeCategoryPhrase("PFAS")).toBe("PFAS");
    expect(capitalizeCategoryPhrase("PCBs and dioxins")).toBe(
      "PCBs and dioxins",
    );
  });

  it("returns the empty string when given an empty string", () => {
    expect(capitalizeCategoryPhrase("")).toBe("");
  });
});

describe("CONTAMINANT_CATEGORY_LABELS", () => {
  it("has a label for every ContaminantCategory value the canonical table uses", () => {
    // Guard rail: a new category added to data.ts's union with no
    // matching label here would break the helper silently. This test
    // pins the relationship.
    expect(Object.keys(CONTAMINANT_CATEGORY_LABELS).sort()).toEqual([
      "common_mineral",
      "heavy_metal",
      "industrial_chemical",
      "nutrient",
      "pahs",
      "pcbs_dioxins",
      "pesticides",
      "petroleum",
      "pfas",
      "radionuclide",
      "vocs",
    ]);
  });
});
