import { describe, expect, it } from "vitest";
import {
  WQA_CONTAMINANTS,
  type WqaContaminant,
} from "./data";
import { findWqaContaminantByAlias } from "./lookup";

function get(name: string): WqaContaminant {
  const hit = WQA_CONTAMINANTS.find((c) => c.canonical_name === name);
  if (!hit) throw new Error(`Test fixture: ${name} not in WQA_CONTAMINANTS`);
  return hit;
}

describe("WQA_CONTAMINANTS coverage", () => {
  it("includes lead and copper (the LCR-surfaced contaminants)", () => {
    expect(WQA_CONTAMINANTS.map((c) => c.canonical_name)).toEqual(
      expect.arrayContaining(["Lead", "Copper"]),
    );
  });

  it("covers the common-CCR set rounded out in WQA-5", () => {
    // WQA-5 expanded the WQA-4 lead/copper stub with the contaminants a
    // typical municipal CCR prints. These are the load-bearing ones the
    // remediation matrix and the findings view's "What this means"
    // disclosures rely on resolving.
    const names = WQA_CONTAMINANTS.map((c) => c.canonical_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Total Trihalomethanes",
        "Haloacetic Acids",
        "PFOA",
        "PFOS",
        "Arsenic",
        "Nitrate",
        "Fluoride",
        "1,2-Dichloroethane",
        "cis-1,2-Dichloroethylene",
        "Atrazine",
        "Uranium",
      ]),
    );
  });

  it("has unique canonical names and at least one alias each", () => {
    const names = WQA_CONTAMINANTS.map((c) => c.canonical_name);
    expect(new Set(names).size).toBe(names.length);
    // Contaminants with genuinely no federal limit (regulated via the
    // PFAS Hazard Index, or simply unregulated) carry an empty
    // federal_limits list rather than an invented number (issue #303).
    const NO_FEDERAL_LIMIT = new Set(["PFBS", "PFHxA", "Sodium", "2-Butanone"]);
    for (const c of WQA_CONTAMINANTS) {
      expect(c.aliases.length).toBeGreaterThan(0);
      if (NO_FEDERAL_LIMIT.has(c.canonical_name)) {
        expect(c.federal_limits).toEqual([]);
      } else {
        expect(c.federal_limits.length).toBeGreaterThan(0);
      }
    }
  });

  it("covers the Kalamazoo CCR tail added for the public page (issue #303)", () => {
    const names = WQA_CONTAMINANTS.map((c) => c.canonical_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "PFHxS",
        "PFBS",
        "PFHxA",
        "Dibromochloromethane",
        "Sodium",
        "2-Butanone",
      ]),
    );
  });
});

describe("WQA federal limits", () => {
  it("lead has the federal action level at 0.015 mg/L and MCLG at 0", () => {
    const lead = get("Lead");
    const action = lead.federal_limits.find((l) => l.kind === "action_level");
    const mclg = lead.federal_limits.find((l) => l.kind === "mclg");
    expect(action?.value_mg_l).toBe(0.015);
    expect(mclg?.value_mg_l).toBe(0);
  });

  it("copper has the federal action level at 1.3 mg/L", () => {
    const copper = get("Copper");
    const action = copper.federal_limits.find((l) => l.kind === "action_level");
    expect(action?.value_mg_l).toBe(1.3);
  });
});

describe("learn_more URLs", () => {
  it("every entry has a learn_more_url that points at epa.gov", () => {
    for (const c of WQA_CONTAMINANTS) {
      expect(c.learn_more_url).toMatch(/^https:\/\/(www\.)?epa\.gov\//);
    }
  });
});

describe("curated EPA reference links (issue #237)", () => {
  it("points copper, fluoride, and chromium at their dedicated EPA pages", () => {
    expect(get("Copper").learn_more_url).toBe(
      "https://www.epa.gov/ground-water-and-drinking-water/lead-and-copper-101",
    );
    expect(get("Fluoride").learn_more_url).toBe(
      "https://www.epa.gov/sdwa/fluoride-drinking-water",
    );
    expect(get("Chromium").learn_more_url).toBe(
      "https://www.epa.gov/sdwa/chromium-drinking-water",
    );
  });

  it("points contaminants without a dedicated page at the NPDWR table, not the generic rules page", () => {
    for (const name of ["Arsenic", "Nitrate", "Barium", "Selenium", "Atrazine"]) {
      expect(get(name).learn_more_url).toBe(
        "https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations",
      );
    }
    // The old generic "Chemical Contaminant Rules" page is no longer used.
    for (const c of WQA_CONTAMINANTS) {
      expect(c.learn_more_url).not.toContain("chemical-contaminant-rules");
    }
  });
});

describe("chlorine / chloramine reference entry (issue #237)", () => {
  it("resolves chlorine and chloramine to a populated entry", () => {
    const chlorine = findWqaContaminantByAlias("Chlorine");
    expect(chlorine?.canonical_name).toBe("Chlorine");
    expect(chlorine?.description.length ?? 0).toBeGreaterThan(0);
    expect(chlorine?.learn_more_url).toContain("epa.gov");
    expect(findWqaContaminantByAlias("Chloramine")?.canonical_name).toBe("Chlorine");
    expect(findWqaContaminantByAlias("Free Chlorine")?.canonical_name).toBe("Chlorine");
  });
});

describe("findWqaContaminantByAlias", () => {
  it("looks up lead by canonical name", () => {
    expect(findWqaContaminantByAlias("Lead")?.canonical_name).toBe("Lead");
  });

  it("looks up lead by LCR_SAMPLE_RESULT code PB90", () => {
    expect(findWqaContaminantByAlias("PB90")?.canonical_name).toBe("Lead");
  });

  it("looks up lead by VIOLATION-table code 5000", () => {
    expect(findWqaContaminantByAlias("5000")?.canonical_name).toBe("Lead");
  });

  it("looks up lead by 'LEAD' (ALL-CAPS, case-insensitive)", () => {
    expect(findWqaContaminantByAlias("LEAD")?.canonical_name).toBe("Lead");
  });

  it("looks up copper by canonical name and code variants", () => {
    expect(findWqaContaminantByAlias("Copper")?.canonical_name).toBe("Copper");
    expect(findWqaContaminantByAlias("CU90")?.canonical_name).toBe("Copper");
    expect(findWqaContaminantByAlias("1022")?.canonical_name).toBe("Copper");
  });

  it("resolves the WQA-5 CCR contaminants by their extracted names", () => {
    expect(
      findWqaContaminantByAlias("Total Trihalomethanes (TTHMs)")?.canonical_name,
    ).toBe("Total Trihalomethanes");
    expect(
      findWqaContaminantByAlias("Haloacetic Acids (HAA5)")?.canonical_name,
    ).toBe("Haloacetic Acids");
    expect(findWqaContaminantByAlias("PFOA")?.canonical_name).toBe("PFOA");
    expect(findWqaContaminantByAlias("Fluoride")?.canonical_name).toBe(
      "Fluoride",
    );
    expect(
      findWqaContaminantByAlias("cis-1,2-Dichloroethylene")?.canonical_name,
    ).toBe("cis-1,2-Dichloroethylene");
  });

  it("trims whitespace before lookup", () => {
    expect(findWqaContaminantByAlias("  Lead  ")?.canonical_name).toBe("Lead");
  });

  it("survives real-world CCR name variance (issue #303 normalization)", () => {
    // Stray internal space around a hyphen — as printed in Kalamazoo's CCR.
    expect(
      findWqaContaminantByAlias("Cis-1,2- Dichloroethylene")?.canonical_name,
    ).toBe("cis-1,2-Dichloroethylene");
    // Collapsed whitespace runs.
    expect(
      findWqaContaminantByAlias("Total   Trihalomethanes")?.canonical_name,
    ).toBe("Total Trihalomethanes");
  });

  it("resolves combined 'Full name (ABBR)' forms by decomposition (issue #303)", () => {
    expect(
      findWqaContaminantByAlias("Perfluorooctanoic acid (PFOA)")?.canonical_name,
    ).toBe("PFOA");
    expect(
      findWqaContaminantByAlias("Perfluorooctane sulfonic acid (PFOS)")
        ?.canonical_name,
    ).toBe("PFOS");
    expect(
      findWqaContaminantByAlias("Perfluorohexane sulfonic acid (PFHxS)")
        ?.canonical_name,
    ).toBe("PFHxS");
    expect(
      findWqaContaminantByAlias("Perfluorobutane sulfonic acid (PFBS)")
        ?.canonical_name,
    ).toBe("PFBS");
    expect(
      findWqaContaminantByAlias("Perfluorohexanoic acid (PFHxA)")
        ?.canonical_name,
    ).toBe("PFHxA");
    // An alias that itself contains a parenthetical still resolves via
    // the exact path first — decomposition never shadows it.
    expect(findWqaContaminantByAlias("Nitrate (as N)")?.canonical_name).toBe(
      "Nitrate",
    );
    expect(
      findWqaContaminantByAlias("Chromium (total)")?.canonical_name,
    ).toBe("Chromium");
  });

  it("returns null for unknown contaminants and falsy input", () => {
    expect(findWqaContaminantByAlias("9999")).toBeNull();
    expect(findWqaContaminantByAlias(null)).toBeNull();
    expect(findWqaContaminantByAlias(undefined)).toBeNull();
    expect(findWqaContaminantByAlias("")).toBeNull();
    expect(findWqaContaminantByAlias("   ")).toBeNull();
  });
});
