import { describe, expect, it } from "vitest";
import { resolveServiceLife } from "./service-life";

describe("resolveServiceLife", () => {
  it("resolves a furnace name to the furnace entry", () => {
    const entry = resolveServiceLife("Carrier furnace");
    expect(entry).toEqual({ label: "Furnace", typicalYears: 18 });
  });

  it("resolves an asphalt-shingle roof to the roof entry", () => {
    const entry = resolveServiceLife("Asphalt shingle roof");
    expect(entry).toEqual({ label: "Roof", typicalYears: 22 });
  });

  it("prefers the more specific water-heater category over a bare match", () => {
    // The shared matcher orders "water heater" ahead of any bare heater
    // rule; this just confirms the service-life table is keyed off the
    // resolved category, not the raw string.
    const entry = resolveServiceLife("Rheem hot water heater");
    expect(entry).toEqual({ label: "Water heater", typicalYears: 11 });
  });

  it("returns null for an item with no tracked category", () => {
    expect(resolveServiceLife("Sony television")).toBeNull();
    expect(resolveServiceLife("")).toBeNull();
  });

  it("carries a single typicalYears number for every category it returns", () => {
    const entry = resolveServiceLife("Whirlpool dishwasher");
    expect(entry).not.toBeNull();
    expect(typeof entry?.typicalYears).toBe("number");
    expect(entry?.typicalYears).toBeGreaterThan(0);
  });
});
