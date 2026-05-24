import { describe, it, expect } from "vitest";
import {
  findContaminantByAlias,
  getPathwayExplanation,
  getPathwaysForContaminants,
} from "./lookup";
import { CONTAMINANTS, PATHWAY_EXPLANATIONS } from "./data";

/**
 * Lookup is the only spot where modules resolve raw EPA contaminant
 * strings against Hearth's canonical table, so it gets a focused test:
 * known aliases land on the right canonical entry, casing and surrounding
 * whitespace don't matter, and an unknown string returns null rather than
 * any kind of "closest match" fallback.
 */

describe("findContaminantByAlias", () => {
  it("resolves the canonical spelling exactly", () => {
    const hit = findContaminantByAlias("Arsenic");
    expect(hit?.canonical_name).toBe("Arsenic");
  });

  it("resolves uppercase aliases like SEMS emits", () => {
    const hit = findContaminantByAlias("LEAD");
    expect(hit?.canonical_name).toBe("Lead");
  });

  it("is case-insensitive and whitespace-trimmed", () => {
    const a = findContaminantByAlias("  polychlorinated biphenyls  ");
    expect(a?.canonical_name).toBe("Polychlorinated biphenyls");

    const b = findContaminantByAlias("pCbS");
    expect(b?.canonical_name).toBe("Polychlorinated biphenyls");
  });

  it("returns null for an unknown contaminant string", () => {
    expect(findContaminantByAlias("Phlogiston-42")).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(findContaminantByAlias("")).toBeNull();
    expect(findContaminantByAlias("   ")).toBeNull();
  });
});

describe("getPathwaysForContaminants", () => {
  it("returns [] for an empty list", () => {
    expect(getPathwaysForContaminants([])).toEqual([]);
  });

  it("returns [] when every input is unknown to the canonical table", () => {
    expect(
      getPathwaysForContaminants(["Phlogiston-42", "Elementum mysticum"]),
    ).toEqual([]);
  });

  it("returns a single contaminant's pathways in canonical order", () => {
    // TCE is a volatile chlorinated solvent: groundwater + vapor intrusion
    // are the canonical pathways the Superfund recommended-actions logic
    // (#144) gates on. Order is the data.ts enum order, so groundwater
    // (declared first) leads.
    expect(getPathwaysForContaminants(["Trichloroethene"])).toEqual([
      "groundwater",
      "vapor_intrusion",
    ]);
  });

  it("dedups pathways across a multi-contaminant site", () => {
    // Lead is soil_exposure + groundwater; arsenic is groundwater +
    // soil_exposure. The union has two distinct pathways, not four.
    expect(getPathwaysForContaminants(["Lead", "Arsenic"])).toEqual([
      "groundwater",
      "soil_exposure",
    ]);
  });

  it("preserves the canonical enum ordering regardless of input order", () => {
    // Same input set, two orderings — both must produce the same output
    // (groundwater, vapor_intrusion, soil_exposure) so downstream
    // rendering is deterministic across runs.
    const a = getPathwaysForContaminants(["Lead", "Trichloroethene"]);
    const b = getPathwaysForContaminants(["Trichloroethene", "Lead"]);
    expect(a).toEqual(b);
    expect(a).toEqual(["groundwater", "vapor_intrusion", "soil_exposure"]);
  });

  it("ignores unknown contaminants but still resolves the known ones", () => {
    expect(
      getPathwaysForContaminants(["Lead", "Phlogiston-42", "Arsenic"]),
    ).toEqual(["groundwater", "soil_exposure"]);
  });

  it("resolves contaminants through the alias map (case-insensitive)", () => {
    // Mirrors the SEMS-style ALL CAPS strings the upstream emits.
    expect(getPathwaysForContaminants(["LEAD", "TCE"])).toEqual([
      "groundwater",
      "vapor_intrusion",
      "soil_exposure",
    ]);
  });
});

describe("getPathwayExplanation", () => {
  it("returns the editorial copy keyed off PATHWAY_EXPLANATIONS", () => {
    // Pin the source-of-truth wiring — the helper is a thin wrapper.
    expect(getPathwayExplanation("groundwater")).toBe(
      PATHWAY_EXPLANATIONS.groundwater,
    );
    expect(getPathwayExplanation("vapor_intrusion")).toBe(
      PATHWAY_EXPLANATIONS.vapor_intrusion,
    );
  });

  it("has a non-empty paragraph for every pathway in the enum", () => {
    for (const pathway of [
      "groundwater",
      "vapor_intrusion",
      "soil_exposure",
      "surface_water",
      "airborne_particulate",
    ] as const) {
      const copy = getPathwayExplanation(pathway);
      expect(copy.length).toBeGreaterThan(40);
    }
  });
});

describe("canonical contaminants table (issue #147)", () => {
  // Guard rail: every entry must claim at least one pathway. A
  // contaminant with no plausible homeowner-relevant pathway has
  // no business being in the table at all — without this assertion
  // a future addition could land with `pathways: []` and silently
  // remove that chemical from the recommended-actions logic.
  it("every entry has at least one pathway populated", () => {
    const missing = CONTAMINANTS.filter((c) => c.pathways.length === 0);
    expect(missing).toEqual([]);
  });

  // Sanity-check: every claimed pathway is one of the enum values.
  // TypeScript already enforces this at compile time, but a runtime
  // check catches any accidental string-literal entry that snuck in
  // via copy-paste (e.g. a "groundwwater" typo that compiles only
  // because the array is widened somewhere).
  it("every claimed pathway is a recognized enum value", () => {
    const valid = new Set([
      "groundwater",
      "vapor_intrusion",
      "soil_exposure",
      "surface_water",
      "airborne_particulate",
    ]);
    const offenders: Array<{ name: string; pathway: string }> = [];
    for (const c of CONTAMINANTS) {
      for (const p of c.pathways) {
        if (!valid.has(p)) offenders.push({ name: c.canonical_name, pathway: p });
      }
    }
    expect(offenders).toEqual([]);
  });
});
