import { describe, expect, it } from "vitest";
import {
  contaminantNameFromCode,
  isKnownContaminantCode,
  lookupContaminant,
} from "./contaminant-codes";

describe("lookupContaminant", () => {
  it("returns the entry for a known code", () => {
    const entry = lookupContaminant("5000");
    expect(entry?.name).toBe("Lead");
    expect(entry?.category).toBe("inorganic");
  });

  it("returns null for unknown codes", () => {
    expect(lookupContaminant("9999")).toBeNull();
  });

  it("trims whitespace before lookup", () => {
    expect(lookupContaminant("  5000  ")?.name).toBe("Lead");
  });

  it("returns null for null / undefined / empty input", () => {
    expect(lookupContaminant(null)).toBeNull();
    expect(lookupContaminant(undefined)).toBeNull();
    expect(lookupContaminant("")).toBeNull();
  });

  it("maps the known DBP codes", () => {
    expect(lookupContaminant("2950")?.name).toMatch(/Trihalomethanes/i);
    expect(lookupContaminant("2456")?.name).toMatch(/Haloacetic/i);
  });

  it("maps lead and copper to the inorganic category", () => {
    expect(lookupContaminant("5000")?.category).toBe("inorganic");
    expect(lookupContaminant("1022")?.category).toBe("inorganic");
  });

  it("maps PFOA and PFOS to the pfas category", () => {
    expect(lookupContaminant("2810")?.category).toBe("pfas");
    expect(lookupContaminant("2811")?.category).toBe("pfas");
  });
});

describe("contaminantNameFromCode", () => {
  it("returns the human name for a known code", () => {
    expect(contaminantNameFromCode("5000")).toBe("Lead");
  });

  it("falls back to a Contaminant code N label for unknown codes", () => {
    expect(contaminantNameFromCode("9999")).toBe("Contaminant code 9999");
  });

  it("returns Unspecified contaminant for null / empty input", () => {
    expect(contaminantNameFromCode(null)).toBe("Unspecified contaminant");
    expect(contaminantNameFromCode("   ")).toBe("Unspecified contaminant");
  });
});

describe("isKnownContaminantCode", () => {
  it("returns true for mapped codes", () => {
    expect(isKnownContaminantCode("5000")).toBe(true);
  });
  it("returns false for unmapped codes", () => {
    expect(isKnownContaminantCode("9999")).toBe(false);
  });
});
