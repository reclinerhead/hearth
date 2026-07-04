import { describe, expect, it } from "vitest";
import {
  PUBLIC_COUNTIES,
  PUBLIC_WATER_SYSTEMS,
  allWaterSystemSlugs,
  resolveCountySlug,
  resolveWaterSystemSlug,
} from "./slugs";

describe("resolveWaterSystemSlug", () => {
  it("resolves the Kalamazoo entry", () => {
    const entry = resolveWaterSystemSlug("kalamazoo-mi");
    expect(entry).not.toBeNull();
    expect(entry!.pwsid).toBe("MI0003520");
    expect(entry!.shortPlace).toBe("Kalamazoo");
  });

  it("normalizes case and whitespace before matching", () => {
    expect(resolveWaterSystemSlug("  KALAMAZOO-MI ")).not.toBeNull();
  });

  it("returns null for anything outside the allowlist", () => {
    expect(resolveWaterSystemSlug("detroit-mi")).toBeNull();
    expect(resolveWaterSystemSlug("")).toBeNull();
    expect(resolveWaterSystemSlug("kalamazoo")).toBeNull();
    // A PWSID is not a slug — machine identifiers never resolve.
    expect(resolveWaterSystemSlug("MI0003520")).toBeNull();
  });
});

describe("resolveCountySlug", () => {
  it("resolves the Phase 2 Kalamazoo county seed entry", () => {
    const entry = resolveCountySlug("kalamazoo-county-mi");
    expect(entry).not.toBeNull();
    expect(entry!.countyName).toBe("Kalamazoo");
  });

  it("returns null for unknown counties", () => {
    expect(resolveCountySlug("wayne-county-mi")).toBeNull();
  });
});

describe("registry integrity", () => {
  it("every slug is canonical lowercase kebab with a state suffix", () => {
    for (const e of [...PUBLIC_WATER_SYSTEMS, ...PUBLIC_COUNTIES]) {
      expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*-mi$/);
    }
  });

  it("slugs and PWSIDs are unique", () => {
    const slugs = allWaterSystemSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    const pwsids = PUBLIC_WATER_SYSTEMS.map((e) => e.pwsid);
    expect(new Set(pwsids).size).toBe(pwsids.length);
  });

  it("round-trips: every listed slug resolves to its own entry", () => {
    for (const e of PUBLIC_WATER_SYSTEMS) {
      expect(resolveWaterSystemSlug(e.slug)?.pwsid).toBe(e.pwsid);
    }
  });
});
