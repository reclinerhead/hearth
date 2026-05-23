import { describe, expect, it } from "vitest";
import {
  buildNhtsaDecodeUrl,
  extractVinFields,
  isValidVinFormat,
  normalizeVin,
  VIN_REGEX,
} from "./decode";

describe("normalizeVin", () => {
  it("uppercases the input", () => {
    expect(normalizeVin("jtezu17r868001234")).toBe("JTEZU17R868001234");
  });

  it("strips internal whitespace", () => {
    expect(normalizeVin("JTE ZU17R 868001234")).toBe("JTEZU17R868001234");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeVin("  JTEZU17R868001234  ")).toBe("JTEZU17R868001234");
  });
});

describe("VIN_REGEX / isValidVinFormat", () => {
  it("accepts a canonical 17-character VIN", () => {
    expect(VIN_REGEX.test("JTEZU17R868001234")).toBe(true);
    expect(isValidVinFormat("JTEZU17R868001234")).toBe(true);
  });

  it("normalizes case and whitespace before validating", () => {
    expect(isValidVinFormat("  jtezu17r868001234  ")).toBe(true);
    expect(isValidVinFormat("JTE ZU17R 868001234")).toBe(true);
  });

  it("rejects VINs containing the letter I", () => {
    // 17 chars, swap one valid char for I in position 5.
    expect(isValidVinFormat("JTEZI17R868001234")).toBe(false);
  });

  it("rejects VINs containing the letter O", () => {
    expect(isValidVinFormat("JTEZO17R868001234")).toBe(false);
  });

  it("rejects VINs containing the letter Q", () => {
    expect(isValidVinFormat("JTEZQ17R868001234")).toBe(false);
  });

  it("rejects VINs shorter than 17 characters", () => {
    expect(isValidVinFormat("JTEZU17R8680012")).toBe(false);
  });

  it("rejects VINs longer than 17 characters", () => {
    expect(isValidVinFormat("JTEZU17R868001234X")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidVinFormat("")).toBe(false);
  });

  it("rejects null / undefined", () => {
    expect(isValidVinFormat(null)).toBe(false);
    expect(isValidVinFormat(undefined)).toBe(false);
  });

  it("rejects VINs containing punctuation", () => {
    expect(isValidVinFormat("JTEZU-17R868001234")).toBe(false);
  });
});

describe("buildNhtsaDecodeUrl", () => {
  it("targets NHTSA's vDecoder endpoint and asks for JSON", () => {
    const url = buildNhtsaDecodeUrl("JTEZU17R868001234");
    expect(url).toContain("vpic.nhtsa.dot.gov");
    expect(url).toContain("/decodevin/");
    expect(url).toContain("format=json");
  });

  it("uppercases the VIN in the URL", () => {
    const url = buildNhtsaDecodeUrl("jtezu17r868001234");
    expect(url).toContain("JTEZU17R868001234");
    expect(url).not.toContain("jtezu17r868001234");
  });
});

describe("extractVinFields", () => {
  const baseRows = (overrides: Record<string, string | null>): Array<{ Variable: string; Value: string | null }> => {
    const fields = {
      Make: "TOYOTA",
      Model: "Land Cruiser",
      ModelYear: "2018",
      BodyClass: "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)",
      VehicleType: "MULTIPURPOSE PASSENGER VEHICLE (MPV)",
      EngineCylinders: "8",
      FuelTypePrimary: "Gasoline",
      DriveType: "AWD/All-Wheel Drive",
      Manufacturer: "TOYOTA MOTOR MANUFACTURING, INC.",
      ManufacturerId: "1006",
      PlantCity: "TAHARA",
      PlantState: null,
      PlantCountry: "JAPAN",
      "Some Irrelevant Field": "ignore me",
      ABS: "Standard",
      ...overrides,
    };
    return Object.entries(fields).map(([Variable, Value]) => ({ Variable, Value }));
  };

  it("extracts all promoted fields from a typical NHTSA response", () => {
    const fields = extractVinFields({ Results: baseRows({}) });
    expect(fields.Make).toBe("TOYOTA");
    expect(fields.Model).toBe("Land Cruiser");
    expect(fields.ModelYear).toBe("2018");
    expect(fields.EngineCylinders).toBe("8");
  });

  it("drops fields outside the promoted list", () => {
    const fields = extractVinFields({ Results: baseRows({}) });
    expect((fields as Record<string, unknown>)["Some Irrelevant Field"]).toBeUndefined();
    expect((fields as Record<string, unknown>).ABS).toBeUndefined();
  });

  it("collapses empty string / Not Applicable / 0 to null", () => {
    const fields = extractVinFields({
      Results: baseRows({
        Make: "",
        Model: "Not Applicable",
        EngineCylinders: "0",
      }),
    });
    expect(fields.Make).toBeNull();
    expect(fields.Model).toBeNull();
    expect(fields.EngineCylinders).toBeNull();
  });

  it("preserves null values verbatim", () => {
    const fields = extractVinFields({
      Results: baseRows({ PlantState: null }),
    });
    expect(fields.PlantState).toBeNull();
  });

  it("returns an empty object when Results is missing", () => {
    const fields = extractVinFields({});
    expect(fields).toEqual({});
  });

  it("returns an empty object when Results is an empty array", () => {
    const fields = extractVinFields({ Results: [] });
    expect(fields).toEqual({});
  });
});
