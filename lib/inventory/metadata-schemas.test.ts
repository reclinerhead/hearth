import { describe, expect, it } from "vitest";
import {
  isValidVin,
  parsePetMetadata,
  parseVehicleMetadata,
  petMetadataSchema,
  vehicleMetadataSchema,
} from "./metadata-schemas";

describe("vehicleMetadataSchema", () => {
  it("accepts a fully-populated vehicle metadata bag", () => {
    const valid = {
      license_plate: "ABC-1234",
      license_plate_state: "MI",
      model_year: 2018,
      purchase_price_cents: 6_500_000,
      purchased_from: "Toyota of Kalamazoo",
      vin_decode: {
        source: "nhtsa_vdecoder" as const,
        decoded_at: "2026-05-23T14:22:00.000Z",
        raw: {
          Make: "TOYOTA",
          Model: "Land Cruiser",
        },
      },
    };
    expect(() => vehicleMetadataSchema.parse(valid)).not.toThrow();
  });

  it("accepts an empty object (no metadata captured yet)", () => {
    expect(() => vehicleMetadataSchema.parse({})).not.toThrow();
  });

  it("rejects model_year outside [1900, 2100]", () => {
    expect(() =>
      vehicleMetadataSchema.parse({ model_year: 1801 }),
    ).toThrow();
    expect(() =>
      vehicleMetadataSchema.parse({ model_year: 3100 }),
    ).toThrow();
  });

  it("requires license_plate_state to be exactly 2 characters", () => {
    expect(() =>
      vehicleMetadataSchema.parse({ license_plate_state: "MICH" }),
    ).toThrow();
    expect(() =>
      vehicleMetadataSchema.parse({ license_plate_state: "M" }),
    ).toThrow();
    expect(() =>
      vehicleMetadataSchema.parse({ license_plate_state: "MI" }),
    ).not.toThrow();
  });

  it("rejects negative purchase_price_cents", () => {
    expect(() =>
      vehicleMetadataSchema.parse({ purchase_price_cents: -1 }),
    ).toThrow();
  });

  it("rejects a vin_decode block with the wrong source tag", () => {
    expect(() =>
      vehicleMetadataSchema.parse({
        vin_decode: {
          source: "carfax",
          decoded_at: "2026-05-23T00:00:00Z",
          raw: {},
        },
      }),
    ).toThrow();
  });
});

describe("parseVehicleMetadata", () => {
  it("returns the parsed shape for a valid object", () => {
    const out = parseVehicleMetadata({
      license_plate: "ABC-1234",
      model_year: 2018,
    });
    expect(out.license_plate).toBe("ABC-1234");
    expect(out.model_year).toBe(2018);
  });

  it("falls back to {} for unparseable input rather than throwing", () => {
    // metadata can be written by an older app version or land malformed
    // — the renderer must keep working even when the bag is wrong.
    expect(parseVehicleMetadata({ model_year: "not-a-year" })).toEqual({});
    expect(parseVehicleMetadata("not-an-object")).toEqual({});
    expect(parseVehicleMetadata(undefined)).toEqual({});
  });

  it("treats null as empty (matches the DB column's default)", () => {
    expect(parseVehicleMetadata(null)).toEqual({});
  });

  it("drops unknown keys silently (zod default behavior)", () => {
    const out = parseVehicleMetadata({
      license_plate: "ABC-1234",
      extra_garbage: "should be ignored",
    });
    expect(out.license_plate).toBe("ABC-1234");
    expect(out).not.toHaveProperty("extra_garbage");
  });
});

describe("petMetadataSchema", () => {
  it("accepts a typical pet metadata bag", () => {
    expect(() =>
      petMetadataSchema.parse({
        species: "Cat",
        breed: "Domestic Shorthair",
        color: "Tabby",
        sex: "female",
        microchip_number: "985121012345678",
      }),
    ).not.toThrow();
  });

  it("rejects sex values outside the enum", () => {
    expect(() =>
      petMetadataSchema.parse({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sex: "other" as any,
      }),
    ).toThrow();
  });

  it("requires birth_date to look like YYYY-MM-DD", () => {
    expect(() => petMetadataSchema.parse({ birth_date: "2020" })).toThrow();
    expect(() => petMetadataSchema.parse({ birth_date: "2020-13-01" })).not.toThrow();
    // ^ regex is shape-only, not calendar-validating; that's fine —
    // the DatePicker emits canonical values.
    expect(() =>
      petMetadataSchema.parse({ birth_date: "2020-01-15" }),
    ).not.toThrow();
  });
});

describe("parsePetMetadata", () => {
  it("returns empty for unparseable input", () => {
    expect(parsePetMetadata("garbage")).toEqual({});
    expect(parsePetMetadata(null)).toEqual({});
    expect(parsePetMetadata(undefined)).toEqual({});
  });

  it("returns the parsed values for a valid bag", () => {
    const out = parsePetMetadata({ species: "Dog", breed: "Lab" });
    expect(out.species).toBe("Dog");
    expect(out.breed).toBe("Lab");
  });
});

describe("isValidVin", () => {
  // The canonical regex test cases live in vin-decode/decode.test.ts —
  // these are sanity checks that the metadata-schemas helper agrees.
  it("accepts a valid 17-char VIN", () => {
    expect(isValidVin("JTEZU17R868001234")).toBe(true);
  });

  it("normalizes case before validating", () => {
    expect(isValidVin("jtezu17r868001234")).toBe(true);
  });

  it("rejects empty / null", () => {
    expect(isValidVin("")).toBe(false);
    expect(isValidVin(null)).toBe(false);
    expect(isValidVin(undefined)).toBe(false);
  });

  it("rejects VINs containing forbidden letters", () => {
    expect(isValidVin("JTEZI17R868001234")).toBe(false);
    expect(isValidVin("JTEZO17R868001234")).toBe(false);
    expect(isValidVin("JTEZQ17R868001234")).toBe(false);
  });
});
