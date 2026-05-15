import { describe, expect, it } from "vitest";
import type { HouseContext } from "@/lib/habitat/types";
import EpaRadonZoneModule, {
  normalizeForLookup,
  zoneToSeverity,
} from "./index";

/**
 * Builds a minimal HouseContext for tests. Coordinates default to
 * Kalamazoo's so we can pass the value through without thinking,
 * even though this module doesn't use them.
 */
function makeHouse(overrides: Partial<HouseContext> = {}): HouseContext {
  return {
    houseId: "test-house",
    addressLine1: "604 Norton Dr",
    city: "Kalamazoo",
    state: "Michigan",
    county: "Kalamazoo",
    postalCode: "49006",
    latitude: 42.2917,
    longitude: -85.5872,
    parcelId: null,
    ...overrides,
  };
}

describe("normalizeForLookup", () => {
  it("lowercases a bare county name", () => {
    expect(normalizeForLookup("Kalamazoo")).toBe("kalamazoo");
  });

  it("strips a 'County' suffix and lowercases", () => {
    expect(normalizeForLookup("Kalamazoo County")).toBe("kalamazoo");
  });

  it("strips a 'Borough' suffix (Alaska)", () => {
    expect(normalizeForLookup("Aleutians East Borough")).toBe("aleutians east");
  });

  it("strips a 'Parish' suffix (Louisiana)", () => {
    expect(normalizeForLookup("Orleans Parish")).toBe("orleans");
  });

  it("strips a 'Census Area' suffix (Alaska)", () => {
    expect(normalizeForLookup("Yukon-Koyukuk Census Area")).toBe(
      "yukon-koyukuk",
    );
  });

  it("strips a 'Municipality' suffix", () => {
    expect(normalizeForLookup("Anchorage Municipality")).toBe("anchorage");
  });

  it("matches the suffix case-insensitively", () => {
    expect(normalizeForLookup("Kent county")).toBe("kent");
  });

  it("preserves internal punctuation", () => {
    expect(normalizeForLookup("St. Clair")).toBe("st. clair");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeForLookup("  Kalamazoo  ")).toBe("kalamazoo");
  });
});

describe("zoneToSeverity", () => {
  it("maps Zone 1 to high severity", () => {
    expect(zoneToSeverity(1)).toBe("high");
  });

  it("maps Zone 2 to moderate severity", () => {
    expect(zoneToSeverity(2)).toBe("moderate");
  });

  it("maps Zone 3 to good severity", () => {
    expect(zoneToSeverity(3)).toBe("good");
  });
});

describe("EpaRadonZoneModule.isApplicable", () => {
  it("always returns true, including for houses with null state/county", () => {
    // Radon zone data covers all US counties — applicability is
    // unconditional. The check() step surfaces missing state/county as a
    // 'failed' finding rather than silently skipping the module.
    expect(EpaRadonZoneModule.isApplicable(makeHouse())).toBe(true);
    expect(EpaRadonZoneModule.isApplicable(makeHouse({ county: null }))).toBe(
      true,
    );
    expect(EpaRadonZoneModule.isApplicable(makeHouse({ state: "" }))).toBe(
      true,
    );
  });
});

describe("EpaRadonZoneModule.check", () => {
  it("returns Zone 1 / high severity for Kalamazoo, MI", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    expect(finding.severity).toBe("high");
    expect(finding.headline).toBe("EPA Radon Zone 1 — highest potential");
    expect(finding.findings.zone).toBe(1);
    expect(finding.findings.county).toBe("Kalamazoo");
    expect(finding.findings.state).toBe("Michigan");
    expect(finding.findings.action_threshold_pci_l).toBe(4.0);
    expect(finding.sourceUrl).toContain("epa.gov");
  });

  it("handles a county arriving with a 'County' suffix", async () => {
    // Mapbox strips "County" at extraction, but the module should
    // tolerate it arriving with the suffix anyway — defensive against
    // future code paths that don't go through extractCounty.
    const finding = await EpaRadonZoneModule.check(
      makeHouse({ county: "Kalamazoo County" }),
    );
    expect(finding.findings.zone).toBe(1);
  });

  it("includes provenance metadata in findings", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    expect(finding.findings.source_dataset).toMatch(/EPA Map of Radon Zones/);
    expect(finding.findings.source_dataset_note).toMatch(/individual home/i);
  });

  it("throws when state is not in the dataset", async () => {
    await expect(
      EpaRadonZoneModule.check(
        makeHouse({ state: "Atlantis", county: "Kalamazoo" }),
      ),
    ).rejects.toThrow(/Atlantis/);
  });

  it("throws when county is not in the state's data", async () => {
    await expect(
      EpaRadonZoneModule.check(
        makeHouse({ state: "Michigan", county: "Fictional" }),
      ),
    ).rejects.toThrow(/Fictional/);
  });

  it("throws when isApplicable would have returned false", async () => {
    await expect(
      EpaRadonZoneModule.check(makeHouse({ county: null })),
    ).rejects.toThrow(/state and county/);
  });
});

describe("EpaRadonZoneModule metadata", () => {
  it("declares its key as 'epa_radon_zone'", () => {
    expect(EpaRadonZoneModule.key).toBe("epa_radon_zone");
  });

  it("declares cadence as 'once'", () => {
    expect(EpaRadonZoneModule.cadence).toBe("once");
  });

  it("has a non-empty description", () => {
    expect(EpaRadonZoneModule.description.length).toBeGreaterThan(0);
  });
});
