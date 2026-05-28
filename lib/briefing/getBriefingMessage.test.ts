import { describe, expect, it } from "vitest";
import {
  getBriefingMessage,
  getBriefingMessageParts,
} from "./getBriefingMessage";

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

describe("getBriefingMessageParts", () => {
  it("returns 'Home data found' + comma-separated secondary when fields populate", () => {
    expect(
      getBriefingMessageParts({
        year_built: 1934,
        living_area_sqft: 2210,
        bedrooms: 3,
        bathrooms: 3,
      }),
    ).toEqual({
      lead: "Home data found",
      secondary: "built in 1934, 2,210 sq ft, 3 bed / 3 bath",
    });
  });

  it("falls back to 'Public records checked' with a null secondary when every field is null", () => {
    expect(
      getBriefingMessageParts({
        year_built: null,
        living_area_sqft: null,
        bedrooms: null,
        bathrooms: null,
      }),
    ).toEqual({ lead: "Public records checked", secondary: null });
  });

  it("renders partial data without trailing punctuation in the secondary line", () => {
    expect(
      getBriefingMessageParts({
        year_built: 1902,
        living_area_sqft: null,
        bedrooms: null,
        bathrooms: null,
      }),
    ).toEqual({ lead: "Home data found", secondary: "built in 1902" });
  });

  it("stays in sync with getBriefingMessage (composition invariant)", () => {
    const cases: Array<Parameters<typeof getBriefingMessage>[0]> = [
      { year_built: 1934, living_area_sqft: 2210, bedrooms: 3, bathrooms: 3 },
      { year_built: 1934, living_area_sqft: null, bedrooms: 3, bathrooms: 3 },
      { year_built: null, living_area_sqft: null, bedrooms: 3, bathrooms: null },
      { year_built: null, living_area_sqft: null, bedrooms: null, bathrooms: null },
    ];
    for (const c of cases) {
      const single = getBriefingMessage(c);
      const { secondary } = getBriefingMessageParts(c);
      const composed =
        secondary === null
          ? "Looked up your home's public records"
          : `Found your home data — ${secondary}`;
      expect(composed, JSON.stringify(c)).toBe(single);
    }
  });
});
