import { describe, expect, it } from "vitest";
import { validateZillowResponse } from "./zillow";

describe("validateZillowResponse", () => {
  it("returns a fully-populated, plausible response as-is", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 1934,
      living_area_sqft: 1840,
      lot_size_sqft: 7840,
      bedrooms: 3,
      bathrooms: 1.5,
      description: "Charming 1934 craftsman with original woodwork.",
      source_url: "https://www.zillow.com/homedetails/123/",
    });

    expect(result).toEqual({
      dataFound: true,
      yearBuilt: 1934,
      livingAreaSqft: 1840,
      lotSizeSqft: 7840,
      bedrooms: 3,
      bathrooms: 1.5,
      description: "Charming 1934 craftsman with original woodwork.",
      sourceUrl: "https://www.zillow.com/homedetails/123/",
    });
  });

  it("preserves nulls on partially-populated responses", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 1990,
      living_area_sqft: null,
      lot_size_sqft: null,
      bedrooms: 3,
      bathrooms: null,
      description: null,
      source_url: "https://www.zillow.com/homedetails/456/",
    });

    expect(result.dataFound).toBe(true);
    expect(result.yearBuilt).toBe(1990);
    expect(result.livingAreaSqft).toBeNull();
    expect(result.lotSizeSqft).toBeNull();
    expect(result.bedrooms).toBe(3);
    expect(result.bathrooms).toBeNull();
    expect(result.description).toBeNull();
    expect(result.sourceUrl).toBe("https://www.zillow.com/homedetails/456/");
  });

  it("nulls out a year_built that's too far in the past", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 1500,
      living_area_sqft: 1840,
    });

    expect(result.yearBuilt).toBeNull();
    expect(result.livingAreaSqft).toBe(1840);
  });

  it("nulls out a year_built that's too far in the future", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 9999,
    });

    expect(result.yearBuilt).toBeNull();
  });

  it("nulls out an absurdly large living_area_sqft", () => {
    const result = validateZillowResponse({
      data_found: true,
      living_area_sqft: 100000,
    });

    expect(result.livingAreaSqft).toBeNull();
  });

  it("nulls out a too-small living_area_sqft", () => {
    const result = validateZillowResponse({
      data_found: true,
      living_area_sqft: 50,
    });

    expect(result.livingAreaSqft).toBeNull();
  });

  it("nulls out bedrooms that are out of range", () => {
    expect(
      validateZillowResponse({ data_found: true, bedrooms: 0 }).bedrooms,
    ).toBeNull();
    expect(
      validateZillowResponse({ data_found: true, bedrooms: 25 }).bedrooms,
    ).toBeNull();
    expect(
      validateZillowResponse({ data_found: true, bedrooms: -3 }).bedrooms,
    ).toBeNull();
  });

  it("accepts decimal bedrooms and bathrooms", () => {
    const result = validateZillowResponse({
      data_found: true,
      bedrooms: 2.5,
      bathrooms: 1.5,
    });

    expect(result.bedrooms).toBe(2.5);
    expect(result.bathrooms).toBe(1.5);
  });

  it("nulls every data field when data_found is false", () => {
    const result = validateZillowResponse({
      data_found: false,
      year_built: 1934,
      living_area_sqft: 1840,
      bedrooms: 3,
      bathrooms: 1.5,
      description: "Should be ignored",
      source_url: "https://example.com",
    });

    expect(result).toEqual({
      dataFound: false,
      yearBuilt: null,
      livingAreaSqft: null,
      lotSizeSqft: null,
      bedrooms: null,
      bathrooms: null,
      description: null,
      sourceUrl: null,
    });
  });

  it("treats a missing data_found as false", () => {
    const result = validateZillowResponse({
      year_built: 1934,
      living_area_sqft: 1840,
    });

    expect(result.dataFound).toBe(false);
    expect(result.yearBuilt).toBeNull();
    expect(result.livingAreaSqft).toBeNull();
  });

  it("ignores extra fields not in our schema", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 1934,
      extra_zillow_field: "not used",
      another_one: { nested: true },
    });

    expect(result.yearBuilt).toBe(1934);
    expect(result).not.toHaveProperty("extra_zillow_field");
  });

  it("nulls strings that are empty or whitespace-only", () => {
    const result = validateZillowResponse({
      data_found: true,
      description: "   ",
      source_url: "",
    });

    expect(result.description).toBeNull();
    expect(result.sourceUrl).toBeNull();
  });

  it("trims description whitespace", () => {
    const result = validateZillowResponse({
      data_found: true,
      description: "  Charming craftsman.  ",
    });

    expect(result.description).toBe("Charming craftsman.");
  });

  it("throws on non-object input (signals the workflow step to retry)", () => {
    expect(() => validateZillowResponse(null)).toThrow();
    expect(() => validateZillowResponse(undefined)).toThrow();
    expect(() => validateZillowResponse("a string")).toThrow();
    expect(() => validateZillowResponse(42)).toThrow();
    expect(() => validateZillowResponse([1, 2, 3])).toThrow();
  });

  it("nulls a non-integer year_built", () => {
    const result = validateZillowResponse({
      data_found: true,
      year_built: 1934.5,
    });

    expect(result.yearBuilt).toBeNull();
  });
});
