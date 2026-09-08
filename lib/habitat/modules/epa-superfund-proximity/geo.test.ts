import { describe, expect, it } from "vitest";
import { compassBearing, haversineMiles } from "./geo";

describe("haversineMiles", () => {
  it("returns 0 for identical points", () => {
    const p = { latitude: 42.265, longitude: -85.589 };
    expect(haversineMiles(p, p)).toBeCloseTo(0, 6);
  });

  it("computes a known distance (NYC → LA) within ~0.5%", () => {
    // Known great-circle distance: ~2451 statute miles.
    const nyc = { latitude: 40.7128, longitude: -74.006 };
    const la = { latitude: 34.0522, longitude: -118.2437 };
    const d = haversineMiles(nyc, la);
    expect(d).toBeGreaterThan(2440);
    expect(d).toBeLessThan(2460);
  });

  it("computes a known short distance within ~5% (Kalamazoo → Allied Paper)", () => {
    // Kalamazoo fixture point → Allied Paper / Portage Creek (rough EPA point).
    // Expected: ~1.0 mile (per issue #37's test address acceptance case).
    const home = { latitude: 42.265, longitude: -85.589 };
    const site = { latitude: 42.2795, longitude: -85.589 };
    const d = haversineMiles(home, site);
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });

  it("is symmetric", () => {
    const a = { latitude: 42.0, longitude: -85.0 };
    const b = { latitude: 43.0, longitude: -86.0 };
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 9);
  });
});

describe("compassBearing", () => {
  const origin = { latitude: 42.0, longitude: -85.0 };

  it("reports N when the target is due north", () => {
    expect(compassBearing(origin, { latitude: 43.0, longitude: -85.0 })).toBe(
      "N",
    );
  });

  it("reports S when the target is due south", () => {
    expect(compassBearing(origin, { latitude: 41.0, longitude: -85.0 })).toBe(
      "S",
    );
  });

  it("reports E when the target is due east", () => {
    expect(compassBearing(origin, { latitude: 42.0, longitude: -84.0 })).toBe(
      "E",
    );
  });

  it("reports W when the target is due west", () => {
    expect(compassBearing(origin, { latitude: 42.0, longitude: -86.0 })).toBe(
      "W",
    );
  });

  it("reports NE when the target is roughly NE", () => {
    expect(compassBearing(origin, { latitude: 42.5, longitude: -84.5 })).toBe(
      "NE",
    );
  });

  it("reports SW when the target is roughly SW", () => {
    expect(compassBearing(origin, { latitude: 41.5, longitude: -85.5 })).toBe(
      "SW",
    );
  });
});
