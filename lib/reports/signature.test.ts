import { describe, it, expect } from "vitest";
import { computeReportSignature } from "./signature";

describe("computeReportSignature", () => {
  it("is stable for identical inputs", () => {
    const a = computeReportSignature(["2026-05-31", "ref-2026-05", "v1"]);
    const b = computeReportSignature(["2026-05-31", "ref-2026-05", "v1"]);
    expect(a).toBe(b);
  });

  it("changes when any part changes", () => {
    const base = computeReportSignature(["2026-05-31", "ref-2026-05", "v1"]);
    expect(computeReportSignature(["2026-06-01", "ref-2026-05", "v1"])).not.toBe(base); // finding moved
    expect(computeReportSignature(["2026-05-31", "ref-2026-06", "v1"])).not.toBe(base); // reference bump
    expect(computeReportSignature(["2026-05-31", "ref-2026-05", "v2"])).not.toBe(base); // template bump
  });

  it("is order-sensitive", () => {
    expect(computeReportSignature(["a", "b"])).not.toBe(computeReportSignature(["b", "a"]));
  });

  it("treats null, undefined, and empty string as the same empty part", () => {
    const withNull = computeReportSignature([null, "x"]);
    const withUndefined = computeReportSignature([undefined, "x"]);
    const withEmpty = computeReportSignature(["", "x"]);
    expect(withNull).toBe(withUndefined);
    expect(withNull).toBe(withEmpty);
  });

  it("coerces numbers consistently", () => {
    expect(computeReportSignature([2024])).toBe(computeReportSignature(["2024"]));
  });

  it("returns a 32-char hex digest", () => {
    expect(computeReportSignature(["anything"])).toMatch(/^[0-9a-f]{32}$/);
  });
});
