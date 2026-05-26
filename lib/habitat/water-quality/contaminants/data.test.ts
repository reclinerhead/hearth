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
  it("includes lead and copper for WQA-4 (the LCR-surfaced contaminants)", () => {
    expect(WQA_CONTAMINANTS.map((c) => c.canonical_name)).toEqual(
      expect.arrayContaining(["Lead", "Copper"]),
    );
  });

  it("ships exactly two entries in WQA-4 (lead and copper)", () => {
    // WQA-3's CCR extraction will append more entries. This test
    // pins the v1 surface; loosen it when WQA-3 lands.
    expect(WQA_CONTAMINANTS).toHaveLength(2);
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

  it("trims whitespace before lookup", () => {
    expect(findWqaContaminantByAlias("  Lead  ")?.canonical_name).toBe("Lead");
  });

  it("returns null for unknown contaminants and falsy input", () => {
    expect(findWqaContaminantByAlias("9999")).toBeNull();
    expect(findWqaContaminantByAlias(null)).toBeNull();
    expect(findWqaContaminantByAlias(undefined)).toBeNull();
    expect(findWqaContaminantByAlias("")).toBeNull();
    expect(findWqaContaminantByAlias("   ")).toBeNull();
  });
});
