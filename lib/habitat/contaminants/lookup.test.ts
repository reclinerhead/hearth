import { describe, it, expect } from "vitest";
import { findContaminantByAlias } from "./lookup";

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
