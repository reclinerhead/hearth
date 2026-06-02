import { describe, expect, it } from "vitest";
import type { VinDecodeResult } from "./decode";
import {
  buildVinPrefill,
  composeVehicleName,
  isGenericVehicleName,
  parseModelYear,
  toTitleCase,
} from "./prefill";

describe("parseModelYear", () => {
  it("parses a numeric year string", () => {
    expect(parseModelYear("2018")).toBe(2018);
  });

  it("returns null for null / empty / undefined", () => {
    expect(parseModelYear(null)).toBeNull();
    expect(parseModelYear(undefined)).toBeNull();
    expect(parseModelYear("")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseModelYear("not a year")).toBeNull();
  });

  it("rejects years outside the 1900–2100 sanity window", () => {
    expect(parseModelYear("1899")).toBeNull();
    expect(parseModelYear("2101")).toBeNull();
    expect(parseModelYear("1900")).toBe(1900);
    expect(parseModelYear("2100")).toBe(2100);
  });

  it("parses a leading integer from a mixed string", () => {
    // parseInt semantics — NHTSA only ever sends clean digits, but the
    // helper shouldn't throw on a stray suffix.
    expect(parseModelYear("2018.0")).toBe(2018);
  });
});

describe("toTitleCase", () => {
  it("title-cases SCREAMING CAPS makes", () => {
    expect(toTitleCase("TOYOTA")).toBe("Toyota");
  });

  it("preserves internal spacing across multi-word makes", () => {
    expect(toTitleCase("MERCEDES BENZ")).toBe("Mercedes Benz");
  });

  it("title-cases each side of a hyphen", () => {
    expect(toTitleCase("ROLLS-ROYCE")).toBe("Rolls-Royce");
  });
});

describe("composeVehicleName", () => {
  it("composes year + make + model", () => {
    expect(
      composeVehicleName({ year: 2018, make: "Toyota", model: "Land Cruiser" }),
    ).toBe("2018 Toyota Land Cruiser");
  });

  it("composes make + model when the year is unknown", () => {
    expect(
      composeVehicleName({ year: null, make: "Toyota", model: "Tacoma" }),
    ).toBe("Toyota Tacoma");
  });

  it("returns null when fewer than two parts are known", () => {
    expect(composeVehicleName({ year: null, make: "Toyota", model: null })).toBeNull();
    expect(composeVehicleName({ year: 2018, make: null, model: null })).toBeNull();
    expect(composeVehicleName({ year: null, make: null, model: null })).toBeNull();
  });

  it("treats whitespace-only parts as absent", () => {
    expect(
      composeVehicleName({ year: 2018, make: "   ", model: "  " }),
    ).toBeNull();
  });
});

describe("isGenericVehicleName", () => {
  it("treats empty / whitespace / null as generic", () => {
    expect(isGenericVehicleName(null)).toBe(true);
    expect(isGenericVehicleName(undefined)).toBe(true);
    expect(isGenericVehicleName("")).toBe(true);
    expect(isGenericVehicleName("   ")).toBe(true);
  });

  it("matches the generic vocabulary case-insensitively", () => {
    expect(isGenericVehicleName("Vehicle")).toBe(true);
    expect(isGenericVehicleName("TRUCK")).toBe(true);
    expect(isGenericVehicleName("my car")).toBe(true);
  });

  it("preserves a personalized name", () => {
    expect(isGenericVehicleName("Beth's Car")).toBe(false);
    expect(isGenericVehicleName("2018 Toyota Land Cruiser")).toBe(false);
  });
});

describe("buildVinPrefill", () => {
  function resultWith(raw: VinDecodeResult["raw"]): VinDecodeResult {
    return { source: "nhtsa_vdecoder", decoded_at: "2026-06-02T00:00:00.000Z", raw };
  }

  it("title-cases the make, parses the year, and composes the name", () => {
    const prefill = buildVinPrefill(
      resultWith({ Make: "TOYOTA", Model: "Land Cruiser", ModelYear: "2018" }),
    );
    expect(prefill).toEqual({
      manufacturer: "Toyota",
      model: "Land Cruiser",
      modelYear: 2018,
      displayName: "2018 Toyota Land Cruiser",
    });
  });

  it("leaves the display name null when only the make is known", () => {
    const prefill = buildVinPrefill(
      resultWith({ Make: "TOYOTA", Model: null, ModelYear: null }),
    );
    expect(prefill.manufacturer).toBe("Toyota");
    expect(prefill.model).toBeNull();
    expect(prefill.modelYear).toBeNull();
    expect(prefill.displayName).toBeNull();
  });

  it("nulls out fields NHTSA didn't return", () => {
    const prefill = buildVinPrefill(resultWith({}));
    expect(prefill).toEqual({
      manufacturer: null,
      model: null,
      modelYear: null,
      displayName: null,
    });
  });
});
