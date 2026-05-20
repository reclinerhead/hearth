import { describe, expect, it } from "vitest";
import {
  formatManufactureDate,
  pickFirstDateTile,
} from "./first-date-tile";

describe("pickFirstDateTile", () => {
  it("returns 'unknown' when both installed_on and manufacture date are null", () => {
    expect(
      pickFirstDateTile({
        installedOn: null,
        manufactureDate: null,
        manufactureDatePrecision: null,
        manufactureDateConfidence: null,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("prefers installed_on when it is present", () => {
    expect(
      pickFirstDateTile({
        installedOn: "2020-06-15",
        manufactureDate: null,
        manufactureDatePrecision: null,
        manufactureDateConfidence: null,
      }),
    ).toEqual({ kind: "installed", isoDate: "2020-06-15" });
  });

  it("falls back to manufactured when only a high-confidence manufacture date is present", () => {
    expect(
      pickFirstDateTile({
        installedOn: null,
        manufactureDate: "2014-10",
        manufactureDatePrecision: "month",
        manufactureDateConfidence: "high",
      }),
    ).toEqual({
      kind: "manufactured",
      manufactureDate: "2014-10",
      precision: "month",
    });
  });

  it("returns 'unknown' for a manufacture date with medium confidence", () => {
    expect(
      pickFirstDateTile({
        installedOn: null,
        manufactureDate: "2014",
        manufactureDatePrecision: "year",
        manufactureDateConfidence: "medium",
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns 'unknown' for a manufacture date with low confidence", () => {
    expect(
      pickFirstDateTile({
        installedOn: null,
        manufactureDate: "2014",
        manufactureDatePrecision: "year",
        manufactureDateConfidence: "low",
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("prefers installed_on even when a high-confidence manufacture date is also present", () => {
    expect(
      pickFirstDateTile({
        installedOn: "2020-06-15",
        manufactureDate: "2014-10",
        manufactureDatePrecision: "month",
        manufactureDateConfidence: "high",
      }),
    ).toEqual({ kind: "installed", isoDate: "2020-06-15" });
  });
});

describe("formatManufactureDate", () => {
  it("returns the bare year for year precision", () => {
    expect(formatManufactureDate("2014", "year")).toBe("2014");
  });

  it("formats YYYY-MM as 'MMM YYYY'", () => {
    expect(formatManufactureDate("2014-10", "month")).toBe("Oct 2014");
  });

  it("converts ISO week to the month containing that week's Thursday", () => {
    // ISO 8601 week 44 of 2014 starts Mon 2014-10-27. Thursday is
    // 2014-10-30, which falls in October.
    expect(formatManufactureDate("2014-W44", "week")).toBe("Oct 2014");
  });

  it("handles a week that straddles a month boundary into the correct month", () => {
    // ISO 8601 week 1 of 2015 starts Mon 2014-12-29 — Thursday is
    // 2015-01-01, so the week belongs to January 2015.
    expect(formatManufactureDate("2015-W01", "week")).toBe("Jan 2015");
  });

  it("falls back to the raw value when precision is null", () => {
    expect(formatManufactureDate("2014-10", null)).toBe("2014-10");
  });

  it("falls back to the raw value when month is out of range", () => {
    expect(formatManufactureDate("2014-13", "month")).toBe("2014-13");
  });

  it("falls back to the raw value when a week string is malformed", () => {
    expect(formatManufactureDate("not-a-date", "week")).toBe("not-a-date");
  });
});
