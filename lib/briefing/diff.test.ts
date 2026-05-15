import { describe, expect, it } from "vitest";
import { diffHouseFacts } from "./diff";
import type { MergeableHouseFacts } from "./merge";

function snapshot(
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

describe("diffHouseFacts", () => {
  it("returns an empty array when nothing changed", () => {
    const before = snapshot({ year_built: 1934, bedrooms: 3 });
    const after = snapshot({ year_built: 1934, bedrooms: 3 });
    expect(diffHouseFacts(before, after)).toEqual([]);
  });

  it("reports a previously-null field that now has a value", () => {
    const before = snapshot();
    const after = snapshot({ heating_summary: "Forced air, Gas" });
    expect(diffHouseFacts(before, after)).toEqual(["Heating"]);
  });

  it("reports a field whose existing value changed", () => {
    const before = snapshot({ heating_summary: "Forced air, Gas" });
    const after = snapshot({ heating_summary: "Heat pump" });
    expect(diffHouseFacts(before, after)).toEqual(["Heating"]);
  });

  it("does not report a field that went from non-null to null", () => {
    // Mirrors the merge rule: the persist step never overwrites a non-null
    // value with a null, so a real "after" snapshot wouldn't show this
    // transition. Defensive check so the helper stays honest if it ever does.
    const before = snapshot({ cooling_summary: "Central" });
    const after = snapshot({ cooling_summary: null });
    expect(diffHouseFacts(before, after)).toEqual([]);
  });

  it("collapses lot_size_sqft and lot_size_acres into a single 'Lot size' label", () => {
    const before = snapshot();
    const after = snapshot({ lot_size_sqft: 7840, lot_size_acres: 0.18 });
    expect(diffHouseFacts(before, after)).toEqual(["Lot size"]);
  });

  it("returns labels in field order", () => {
    const before = snapshot();
    const after = snapshot({
      bedrooms: 3,
      year_built: 1934,
      parcel_id: "0627437339",
    });
    expect(diffHouseFacts(before, after)).toEqual([
      "Year built",
      "Bedrooms",
      "Parcel ID",
    ]);
  });

  it("ignores description_source — provenance is not user-visible", () => {
    const before = snapshot({ description_source: null });
    const after = snapshot({ description_source: "First-run Zillow copy." });
    expect(diffHouseFacts(before, after)).toEqual([]);
  });

  it("reports description separately from description_source", () => {
    const before = snapshot({
      description: "Old copy.",
      description_source: "Old copy.",
    });
    const after = snapshot({
      description: "New copy.",
      description_source: "Old copy.",
    });
    expect(diffHouseFacts(before, after)).toEqual(["Description"]);
  });
});
