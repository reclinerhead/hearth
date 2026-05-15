import { describe, expect, it } from "vitest";
import { getBriefingMessage } from "./getBriefingMessage";

describe("getBriefingMessage", () => {
  it("renders all four facts when every field is populated", () => {
    expect(
      getBriefingMessage({
        year_built: 1934,
        living_area_sqft: 2210,
        bedrooms: 3,
        bathrooms: 3,
      }),
    ).toBe("Found your home data — built in 1934, 2,210 sq ft, 3 bed / 3 bath");
  });

  it("omits living area when it is null and keeps the rest in order", () => {
    expect(
      getBriefingMessage({
        year_built: 1934,
        living_area_sqft: null,
        bedrooms: 3,
        bathrooms: 3,
      }),
    ).toBe("Found your home data — built in 1934, 3 bed / 3 bath");
  });

  it("omits year built when it is null", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: 2210,
        bedrooms: 3,
        bathrooms: 3,
      }),
    ).toBe("Found your home data — 2,210 sq ft, 3 bed / 3 bath");
  });

  it("renders bedrooms alone when bathrooms is null", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: null,
        bedrooms: 3,
        bathrooms: null,
      }),
    ).toBe("Found your home data — 3 bed");
  });

  it("renders bathrooms alone when bedrooms is null", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: null,
        bedrooms: null,
        bathrooms: 2,
      }),
    ).toBe("Found your home data — 2 bath");
  });

  it("renders half-bath / half-bed counts with one decimal", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: null,
        bedrooms: 2.5,
        bathrooms: 1.5,
      }),
    ).toBe("Found your home data — 2.5 bed / 1.5 bath");
  });

  it("formats large living areas with a thousands separator", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: 12500,
        bedrooms: null,
        bathrooms: null,
      }),
    ).toBe("Found your home data — 12,500 sq ft");
  });

  it("falls back to a graceful sentence when every field is null", () => {
    expect(
      getBriefingMessage({
        year_built: null,
        living_area_sqft: null,
        bedrooms: null,
        bathrooms: null,
      }),
    ).toBe("Looked up your home's public records");
  });

  it("renders year-built only when it is the only populated field", () => {
    expect(
      getBriefingMessage({
        year_built: 1902,
        living_area_sqft: null,
        bedrooms: null,
        bathrooms: null,
      }),
    ).toBe("Found your home data — built in 1902");
  });
});
