import { describe, it, expect } from "vitest";
import {
  extractCounty,
  extractAddress,
  type MapboxRetrievedFeature,
} from "./extract-address";

describe("extractCounty", () => {
  it("strips a trailing 'County' suffix from a district entry", () => {
    expect(
      extractCounty([
        { id: "country.123", text: "United States" },
        { id: "region.456", text: "Michigan" },
        { id: "district.789", text: "Kalamazoo County" },
      ]),
    ).toBe("Kalamazoo");
  });

  it("returns the text as-is when no 'County' suffix is present", () => {
    expect(extractCounty([{ id: "district.1", text: "Washtenaw" }])).toBe(
      "Washtenaw",
    );
  });

  it("returns null when no district entry exists", () => {
    expect(
      extractCounty([
        { id: "country.123", text: "United States" },
        { id: "region.456", text: "Michigan" },
      ]),
    ).toBeNull();
  });

  it("returns null on undefined or empty context", () => {
    expect(extractCounty(undefined)).toBeNull();
    expect(extractCounty([])).toBeNull();
  });

  it("returns null when the district entry has no text", () => {
    expect(extractCounty([{ id: "district.1" }])).toBeNull();
  });

  it("uses the first district entry when several exist", () => {
    expect(
      extractCounty([
        { id: "district.1", text: "Kalamazoo County" },
        { id: "district.2", text: "Some Other County" },
      ]),
    ).toBe("Kalamazoo");
  });

  it("matches 'County' case-insensitively", () => {
    expect(extractCounty([{ id: "district.1", text: "Kent county" }])).toBe(
      "Kent",
    );
  });
});

describe("extractAddress", () => {
  const baseFeature: MapboxRetrievedFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-85.5872, 42.2917] },
    properties: {
      mapbox_id: "dXJuOm1ieGFkcjphYmM",
      address_line1: "100 Fixture Ave",
      address_level1: "Michigan",
      address_level2: "Kalamazoo",
      postcode: "49006",
      country: "United States",
      country_code: "us",
      context: [{ id: "district.123", text: "Kalamazoo County" }],
    },
  };

  it("maps a complete feature to our canonical address shape", () => {
    expect(extractAddress(baseFeature)).toEqual({
      address_line1: "100 Fixture Ave",
      address_line2: null,
      city: "Kalamazoo",
      state: "Michigan",
      postal_code: "49006",
      country: "US",
      county: "Kalamazoo",
      latitude: 42.2917,
      longitude: -85.5872,
      mapbox_id: "dXJuOm1ieGFkcjphYmM",
    });
  });

  it("normalizes country_code to uppercase", () => {
    const result = extractAddress({
      ...baseFeature,
      properties: { ...baseFeature.properties, country_code: "ca" },
    });
    expect(result.country).toBe("CA");
  });

  it("defaults country to 'US' when country_code is absent", () => {
    const result = extractAddress({
      ...baseFeature,
      properties: { ...baseFeature.properties, country_code: undefined },
    });
    expect(result.country).toBe("US");
  });

  it("preserves address_line2 when present", () => {
    const result = extractAddress({
      ...baseFeature,
      properties: { ...baseFeature.properties, address_line2: "Apt 3" },
    });
    expect(result.address_line2).toBe("Apt 3");
  });

  it("returns null county when no district is in context", () => {
    const result = extractAddress({
      ...baseFeature,
      properties: { ...baseFeature.properties, context: [] },
    });
    expect(result.county).toBeNull();
  });

  it("throws when address_line1 is missing", () => {
    expect(() =>
      extractAddress({
        ...baseFeature,
        properties: { ...baseFeature.properties, address_line1: undefined },
      }),
    ).toThrow(/address_line1/);
  });

  it("throws when geometry coordinates are missing", () => {
    expect(() =>
      extractAddress({ ...baseFeature, geometry: undefined }),
    ).toThrow(/coordinates/);
  });
});
