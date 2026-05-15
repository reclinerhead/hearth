import { describe, expect, it } from "vitest";
import {
  buildBriefingSuccessUpdate,
  type MergeableHouseFacts,
} from "./merge";
import type { ZillowLookupResult } from "./zillow";

const NOW = "2026-05-15T12:00:00.000Z";

function emptyRow(
  overrides: Partial<MergeableHouseFacts> = {},
): MergeableHouseFacts {
  return {
    year_built: null,
    living_area_sqft: null,
    lot_size_sqft: null,
    lot_size_acres: null,
    bedrooms: null,
    bathrooms: null,
    heating_summary: null,
    cooling_summary: null,
    parcel_id: null,
    description: null,
    description_source: null,
    ...overrides,
  };
}

function emptyResult(
  overrides: Partial<ZillowLookupResult> = {},
): ZillowLookupResult {
  return {
    dataFound: true,
    yearBuilt: null,
    livingAreaSqft: null,
    lotSizeSqft: null,
    lotSizeAcres: null,
    bedrooms: null,
    bathrooms: null,
    heating: null,
    cooling: null,
    parcelNumber: null,
    description: null,
    sourceUrl: null,
    ...overrides,
  };
}

describe("buildBriefingSuccessUpdate", () => {
  it("writes a new non-null value when the row's field is null", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow(),
      result: emptyResult({ yearBuilt: 1934 }),
      now: NOW,
    });

    expect(payload.year_built).toBe(1934);
  });

  it("replaces an existing non-null value when the new value differs", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ heating_summary: "Forced air, Gas" }),
      result: emptyResult({ heating: "Heat pump" }),
      now: NOW,
    });

    expect(payload.heating_summary).toBe("Heat pump");
  });

  it("does not overwrite an existing non-null value when the new value is null", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ cooling_summary: "Central" }),
      result: emptyResult({ cooling: null }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty("cooling_summary");
  });

  it("omits a field when current and new values are equal (no-op)", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ bedrooms: 3 }),
      result: emptyResult({ bedrooms: 3 }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty("bedrooms");
  });

  it("never overwrites description_source once it is set, even with a different non-null value", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({
        description_source: "Original Zillow copy.",
      }),
      result: emptyResult({ description: "A revised description." }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty("description_source");
    // description itself follows the normal merge rule, so it should still
    // update — the provenance lock is on description_source alone.
    expect(payload.description).toBe("A revised description.");
  });

  it("writes description_source on the first run, when the row has no provenance yet", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow(),
      result: emptyResult({ description: "Charming craftsman." }),
      now: NOW,
    });

    expect(payload.description_source).toBe("Charming craftsman.");
    expect(payload.description).toBe("Charming craftsman.");
  });

  it("does not overwrite description_source even when the new description is null", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ description_source: "Original Zillow copy." }),
      result: emptyResult({ description: null }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty("description_source");
  });

  it("always sets briefing_status, briefing_generated_at, and briefing_error regardless of data fields", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ bedrooms: 3, bathrooms: 2 }),
      result: emptyResult({ bedrooms: 3, bathrooms: 2 }),
      now: NOW,
    });

    expect(payload.briefing_status).toBe("completed");
    expect(payload.briefing_generated_at).toBe(NOW);
    expect(payload.briefing_error).toBeNull();
  });

  it("accumulates fresh fields without disturbing previously-populated ones", () => {
    // Mirrors the real-world case from PR #12: first run got year_built;
    // second run gets parcel + lot + heating; neither run got everything.
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({
        year_built: 1934,
        bedrooms: 3,
        bathrooms: 1.5,
      }),
      result: emptyResult({
        yearBuilt: null,
        bedrooms: null,
        bathrooms: null,
        parcelNumber: "0627437339",
        lotSizeSqft: 7840,
        lotSizeAcres: 0.18,
        heating: "Forced air, Gas",
      }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty("year_built");
    expect(payload).not.toHaveProperty("bedrooms");
    expect(payload).not.toHaveProperty("bathrooms");
    expect(payload.parcel_id).toBe("0627437339");
    expect(payload.lot_size_sqft).toBe(7840);
    expect(payload.lot_size_acres).toBe(0.18);
    expect(payload.heating_summary).toBe("Forced air, Gas");
  });

  it("returns only lifecycle fields when the new result has no usable data", () => {
    const payload = buildBriefingSuccessUpdate({
      current: emptyRow({ year_built: 1934, bedrooms: 3 }),
      result: emptyResult({ dataFound: false }),
      now: NOW,
    });

    expect(payload).toEqual({
      briefing_status: "completed",
      briefing_generated_at: NOW,
      briefing_error: null,
    });
  });
});
