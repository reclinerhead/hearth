import { describe, expect, it } from "vitest";
import {
  inventoryNameMatches,
  normalizeInventoryName,
} from "./match-name";

describe("normalizeInventoryName", () => {
  it("lowercases and trims", () => {
    expect(normalizeInventoryName("  Furnace  ")).toBe("furnace");
    expect(normalizeInventoryName("MICROWAVE")).toBe("microwave");
  });

  it("strips punctuation and collapses whitespace", () => {
    // "Air-Conditioner" lands at "air conditioner" via punctuation
    // strip + whitespace collapse, then the alias rule rewrites it to
    // the canonical "air conditioner" (already canonical here).
    expect(normalizeInventoryName("Air-Conditioner")).toBe("air conditioner");
    expect(normalizeInventoryName("Water   Heater")).toBe("water heater");
  });

  it("returns empty string for empty or whitespace-only input", () => {
    expect(normalizeInventoryName("")).toBe("");
    expect(normalizeInventoryName("   ")).toBe("");
  });

  it("maps microwave variants to a single canonical", () => {
    expect(normalizeInventoryName("Microwave")).toBe("microwave");
    expect(normalizeInventoryName("Microwave Oven")).toBe("microwave");
  });

  it("maps washing-machine variants to a single canonical", () => {
    expect(normalizeInventoryName("Washer")).toBe("washing machine");
    expect(normalizeInventoryName("Washing Machine")).toBe("washing machine");
    expect(normalizeInventoryName("Clothes Washer")).toBe("washing machine");
  });

  it("maps dryer variants to a single canonical", () => {
    expect(normalizeInventoryName("Dryer")).toBe("dryer");
    expect(normalizeInventoryName("Clothes Dryer")).toBe("dryer");
  });

  it("maps water-heater variants to a single canonical", () => {
    expect(normalizeInventoryName("Water Heater")).toBe("water heater");
    expect(normalizeInventoryName("Hot Water Heater")).toBe("water heater");
  });

  it("maps refrigerator variants to a single canonical", () => {
    expect(normalizeInventoryName("Refrigerator")).toBe("refrigerator");
    expect(normalizeInventoryName("Fridge")).toBe("refrigerator");
  });

  it("maps air-conditioner variants to a single canonical", () => {
    expect(normalizeInventoryName("Air Conditioner")).toBe("air conditioner");
    expect(normalizeInventoryName("AC")).toBe("air conditioner");
    expect(normalizeInventoryName("Air Conditioning")).toBe("air conditioner");
  });

  it("maps furnace variants to a single canonical", () => {
    expect(normalizeInventoryName("Furnace")).toBe("furnace");
    expect(normalizeInventoryName("Gas Furnace")).toBe("furnace");
  });

  it("leaves unknown names alone after lowercase/whitespace normalization", () => {
    // Names outside the alias map pass through after only cosmetic
    // normalization. This is the "keep tight" contract: we don't try
    // to be clever, and we don't silently rewrite words we haven't
    // explicitly opted into.
    expect(normalizeInventoryName("Dishwasher")).toBe("dishwasher");
    expect(normalizeInventoryName("Sump Pump")).toBe("sump pump");
    expect(normalizeInventoryName("Generator")).toBe("generator");
  });

  it("does not rewrite 'washer' inside a different equipment name", () => {
    // The alias is a whole-string rule, not a substring rule — so
    // "Pressure Washer" must NOT collapse to "Washing Machine", and
    // "Dishwasher" must NOT match "Washer".
    expect(normalizeInventoryName("Pressure Washer")).toBe("pressure washer");
    expect(normalizeInventoryName("Dishwasher")).toBe("dishwasher");
  });

  it("does not rewrite tokens that happen to appear inside larger words", () => {
    // "Refrigerator" is its own alias target, but "refrigerator" inside
    // a compound name should not invoke the whole-string rule.
    expect(normalizeInventoryName("Wine Refrigerator")).toBe("wine refrigerator");
  });
});

describe("inventoryNameMatches", () => {
  it("matches identical names ignoring case and whitespace", () => {
    expect(inventoryNameMatches("Furnace", "furnace")).toBe(true);
    expect(inventoryNameMatches(" Furnace ", "FURNACE")).toBe(true);
  });

  it("matches microwave ↔ microwave oven", () => {
    expect(inventoryNameMatches("Microwave", "Microwave Oven")).toBe(true);
    expect(inventoryNameMatches("Microwave Oven", "Microwave")).toBe(true);
  });

  it("matches washing-machine synonyms", () => {
    expect(inventoryNameMatches("Washing Machine", "Washer")).toBe(true);
    expect(inventoryNameMatches("Washer", "Clothes Washer")).toBe(true);
    expect(inventoryNameMatches("Clothes Washer", "Washing Machine")).toBe(true);
  });

  it("matches dryer ↔ clothes dryer", () => {
    expect(inventoryNameMatches("Dryer", "Clothes Dryer")).toBe(true);
  });

  it("matches water-heater ↔ hot water heater", () => {
    expect(inventoryNameMatches("Water Heater", "Hot Water Heater")).toBe(true);
  });

  it("matches refrigerator ↔ fridge", () => {
    expect(inventoryNameMatches("Refrigerator", "Fridge")).toBe(true);
  });

  it("matches ac ↔ air conditioner ↔ air conditioning", () => {
    expect(inventoryNameMatches("Air Conditioner", "AC")).toBe(true);
    expect(inventoryNameMatches("Air Conditioner", "Air Conditioning")).toBe(true);
    expect(inventoryNameMatches("AC", "Air Conditioning")).toBe(true);
  });

  it("matches furnace ↔ gas furnace", () => {
    expect(inventoryNameMatches("Furnace", "Gas Furnace")).toBe(true);
  });

  it("does not match different equipment", () => {
    expect(inventoryNameMatches("Microwave", "Refrigerator")).toBe(false);
    expect(inventoryNameMatches("Furnace", "Water Heater")).toBe(false);
    expect(inventoryNameMatches("Washer", "Dryer")).toBe(false);
  });

  it("does not match near-misses that fall outside the alias map", () => {
    // "Pressure Washer" and "Washing Machine" are different products
    // even though "washer" appears in both — the whole-string rule
    // prevents the false positive.
    expect(inventoryNameMatches("Pressure Washer", "Washing Machine")).toBe(false);
    // "Dishwasher" must not match "Washer".
    expect(inventoryNameMatches("Dishwasher", "Washer")).toBe(false);
    // "Wine Refrigerator" must not match "Refrigerator" — different
    // physical unit.
    expect(inventoryNameMatches("Wine Refrigerator", "Refrigerator")).toBe(
      false,
    );
  });

  it("treats empty input as non-matching even against another empty", () => {
    // An inventory row with a blank name should not absorb every new
    // photo by virtue of normalizing to "".
    expect(inventoryNameMatches("", "")).toBe(false);
    expect(inventoryNameMatches("", "Microwave")).toBe(false);
    expect(inventoryNameMatches("Microwave", "")).toBe(false);
    expect(inventoryNameMatches("   ", "Microwave")).toBe(false);
  });
});
