import { describe, expect, it } from "vitest";
import { affiliateLink } from "@/lib/affiliate/link";
import type { HabitatFinding, HouseContext } from "@/lib/habitat/types";
import EpaRadonZoneModule, {
  buildActions,
  buildOnboardingMessage,
  normalizeForLookup,
  normalizeStateForLookup,
  zoneToSeverity,
} from "./index";

/**
 * Builds a minimal HouseContext for tests. State defaults to the
 * 2-letter USPS code because that's what hearth.houses actually
 * stores — Mapbox's address_level1 returns the abbreviation for US
 * addresses. Coordinates are Kalamazoo's so we can pass the value
 * through without thinking, even though this module doesn't use them.
 */
function makeHouse(overrides: Partial<HouseContext> = {}): HouseContext {
  return {
    houseId: "test-house",
    addressLine1: "604 Norton Dr",
    city: "Kalamazoo",
    state: "MI",
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

describe("normalizeStateForLookup", () => {
  it("uppercases a 2-letter code", () => {
    expect(normalizeStateForLookup("mi")).toBe("MI");
  });

  it("passes a 2-letter code through unchanged when already uppercase", () => {
    expect(normalizeStateForLookup("MI")).toBe("MI");
  });

  it("maps a full state name to its USPS code", () => {
    expect(normalizeStateForLookup("Michigan")).toBe("MI");
  });

  it("is case-insensitive for full state names", () => {
    expect(normalizeStateForLookup("michigan")).toBe("MI");
  });

  it("handles multi-word state names", () => {
    expect(normalizeStateForLookup("New Hampshire")).toBe("NH");
    expect(normalizeStateForLookup("district of columbia")).toBe("DC");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeStateForLookup("  MI  ")).toBe("MI");
    expect(normalizeStateForLookup("  Michigan  ")).toBe("MI");
  });

  it("falls back to upper-cased input for unknown states", () => {
    // The caller then throws because the dataset has no such key.
    expect(normalizeStateForLookup("Atlantis")).toBe("ATLANTIS");
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
    expect(finding.findings.state).toBe("MI");
    expect(finding.findings.action_threshold_pci_l).toBe(4.0);
    expect(finding.sourceUrl).toContain("epa.gov");
  });

  it("accepts the full state name as a fallback", async () => {
    // Belt-and-suspenders: if any future code path stores
    // address_level1 verbatim and Mapbox returned the full name, the
    // module still resolves correctly via normalizeStateForLookup.
    const finding = await EpaRadonZoneModule.check(
      makeHouse({ state: "Michigan" }),
    );
    expect(finding.findings.zone).toBe(1);
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

  it("returns Zone 1 actions including a 'service' (mitigator) entry", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    expect(finding.actions).toBeDefined();
    const kinds = (finding.actions ?? []).map((a) => a.kind);
    expect(kinds).toContain("service");
    expect(kinds).toContain("product");
    expect(kinds).toContain("link");
  });

  it("does not include the 'service' (mitigator) action for Zone 3", async () => {
    // Honolulu, HI sits in Zone 3 — used as the canonical low-potential
    // county for this assertion. If the dataset ever reclassifies, swap
    // for any other documented Zone 3 county.
    const finding = await EpaRadonZoneModule.check(
      makeHouse({ state: "HI", county: "Honolulu" }),
    );
    expect(finding.findings.zone).toBe(3);
    const kinds = (finding.actions ?? []).map((a) => a.kind);
    expect(kinds).not.toContain("service");
    expect(kinds).toContain("product");
    expect(kinds).toContain("link");
  });

  it("wraps every product URL through affiliateLink()", async () => {
    // affiliateLink is identity today, so this is a soft snapshot — but
    // it guarantees that whenever the helper starts mutating URLs, every
    // product URL the module emits flows through it.
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const products = (finding.actions ?? []).filter((a) => a.kind === "product");
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(product.url).toBe(affiliateLink(product.url));
    }
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

/**
 * Helper to construct a finding payload as it would arrive from check().
 * Only the fields buildOnboardingMessage reads are populated; everything
 * else is filler.
 */
function makeFinding(
  zone: 1 | 2 | 3,
  county: string | null = "Kalamazoo",
): HabitatFinding {
  return {
    severity: zone === 1 ? "high" : zone === 2 ? "moderate" : "good",
    headline: `EPA Radon Zone ${zone}`,
    summary: "",
    findings: {
      zone,
      county,
      state: "MI",
    },
  };
}

describe("buildOnboardingMessage", () => {
  it("leads with the Zone 1 finding and flags it for follow-up", () => {
    const message = buildOnboardingMessage(makeFinding(1));
    expect(message).toContain("Zone 1");
    expect(message).toContain("Kalamazoo County");
    expect(message).toMatch(/highest/i);
    expect(message).toMatch(/flag/i);
  });

  it("describes Zone 2 as moderate potential", () => {
    const message = buildOnboardingMessage(makeFinding(2));
    expect(message).toContain("Zone 2");
    expect(message).toContain("Kalamazoo County");
    expect(message).toMatch(/moderate/i);
  });

  it("opens Zone 3 with a positive framing", () => {
    const message = buildOnboardingMessage(makeFinding(3));
    expect(message).toContain("Zone 3");
    expect(message).toContain("Kalamazoo County");
    expect(message).toMatch(/good news|lowest/i);
  });

  it("falls back to 'your county' when no county is in the finding", () => {
    // Defensive: the module's check() always populates county, but a
    // future module variant or a manually-constructed finding might not.
    // The copy should still read like a sentence, not "in ".
    const finding = makeFinding(1);
    delete (finding.findings as Record<string, unknown>).county;
    const message = buildOnboardingMessage(finding);
    expect(message).toContain("your county");
    expect(message).not.toContain("undefined");
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

  it("declares a root-relative iconImage", () => {
    expect(EpaRadonZoneModule.iconImage).toBe(
      "/habitat_module_images/radon.jpg",
    );
  });
});

describe("buildActions", () => {
  it("returns three actions for Zone 1 in the order [product, service, link]", () => {
    const actions = buildActions(1);
    expect(actions.map((a) => a.kind)).toEqual(["product", "service", "link"]);
  });

  it("returns two actions for Zone 2 (no mitigator)", () => {
    const actions = buildActions(2);
    expect(actions.map((a) => a.kind)).toEqual(["product", "link"]);
  });

  it("returns two actions for Zone 3 (no mitigator)", () => {
    const actions = buildActions(3);
    expect(actions.map((a) => a.kind)).toEqual(["product", "link"]);
  });

  it("includes a priceHint on the product action", () => {
    const product = buildActions(1)[0];
    expect(product.kind).toBe("product");
    if (product.kind === "product") {
      expect(product.priceHint).toBeTruthy();
    }
  });
});
