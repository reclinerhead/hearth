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
    waterSource: null,
    basementPresent: null,
    waterSystemUserPwsid: null,
    waterSystemPwsidConfidence: null,
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
  it("maps Zone 1 to 'concern'", () => {
    expect(zoneToSeverity(1)).toBe("concern");
  });

  it("maps Zone 2 to 'caution'", () => {
    expect(zoneToSeverity(2)).toBe("caution");
  });

  it("maps Zone 3 to 'favorable'", () => {
    expect(zoneToSeverity(3)).toBe("favorable");
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
  it("returns Zone 1 / 'concern' severity for Kalamazoo, MI", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    expect(finding.severity).toBe("concern");
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
    severity: zone === 1 ? "concern" : zone === 2 ? "caution" : "favorable",
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

describe("EpaRadonZoneModule.check activity log", () => {
  it("emits a finalized activity log on a Zone 1 check", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());

    expect(finding.activityLog).toBeDefined();
    const log = finding.activityLog!;

    expect(log.steps.length).toBeGreaterThanOrEqual(5);
    const kinds = log.steps.map((s) => s.kind);
    expect(kinds).toEqual(["fetch", "compute", "rule", "decide", "finding"]);

    // Step numbers are sequential and 1-indexed.
    expect(log.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);

    // started_at/completed_at are ISO timestamps and duration is non-negative.
    expect(log.started_at).toMatch(/T\d{2}:\d{2}/);
    expect(log.completed_at).toMatch(/T\d{2}:\d{2}/);
    expect(log.total_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("cites the EPA radon zone map on the fetch step", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const fetchStep = finding.activityLog!.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.source?.url).toContain("epa.gov");
  });

  it("puts the data file path and dataset publication date in the fetch step's detail", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const fetchStep = finding.activityLog!.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.detail).toContain("lib/habitat/modules/epa-radon-zone/data.ts");
    expect(fetchStep?.detail).toContain("June 2024");
  });

  it("includes the rule transformation in the decide step's detail", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const decideStep = finding.activityLog!.steps.find(
      (s) => s.kind === "decide",
    );
    expect(decideStep?.detail).toBe("zone(1) → severity('concern')");
  });

  it("includes the normalized lookup key on the compute step", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const computeStep = finding.activityLog!.steps.find(
      (s) => s.kind === "compute",
    );
    expect(computeStep?.detail).toContain("MI");
    expect(computeStep?.detail).toContain("kalamazoo");
  });

  it("includes the zone in the rule step's result_summary on Zone 1", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const ruleStep = finding.activityLog!.steps.find((s) => s.kind === "rule");
    expect(ruleStep?.result_summary).toContain("Zone 1");
  });

  it("includes the Hearth severity in the decide step's result_summary", async () => {
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const decideStep = finding.activityLog!.steps.find(
      (s) => s.kind === "decide",
    );
    expect(decideStep?.result_summary).toBe("Severity: concern");
    expect(decideStep?.source?.url).toBe("/how-it-works#radon");
  });

  it("uses first-person, jargon-free voice in the narration", async () => {
    // Spot-check: the narration on the first step should read like a
    // person explaining what they did, not a system log line. We assert
    // by sampling — checking for "I " somewhere in narration text and
    // the absence of obvious technical artifacts (square brackets,
    // ALL_CAPS identifiers, etc.) in narration specifically.
    const finding = await EpaRadonZoneModule.check(makeHouse());
    const narrations = finding.activityLog!.steps.map((s) => s.narration);
    expect(narrations.some((n) => /\bI\b/.test(n))).toBe(true);
    for (const n of narrations) {
      expect(n).not.toMatch(/[A-Z_]{4,}/); // no ALL_CAPS identifiers in user-facing copy
      expect(n).not.toContain("[");
    }
  });

  it("emits a Zone 2 rule + decide pair for a Zone 2 county", async () => {
    // Pick a documented Zone 2 county. Genesee County, MI is Zone 2 in
    // the EPA dataset; if the dataset ever reclassifies, swap for any
    // other documented Zone 2 county.
    const finding = await EpaRadonZoneModule.check(
      makeHouse({ state: "MI", county: "Genesee" }),
    );
    expect(finding.findings.zone).toBe(2);
    const ruleStep = finding.activityLog!.steps.find((s) => s.kind === "rule");
    const decideStep = finding.activityLog!.steps.find(
      (s) => s.kind === "decide",
    );
    expect(ruleStep?.result_summary).toContain("Zone 2");
    expect(decideStep?.result_summary).toBe("Severity: caution");
  });

  it("emits a Zone 3 rule + decide pair for a Zone 3 county", async () => {
    const finding = await EpaRadonZoneModule.check(
      makeHouse({ state: "HI", county: "Honolulu" }),
    );
    expect(finding.findings.zone).toBe(3);
    const ruleStep = finding.activityLog!.steps.find((s) => s.kind === "rule");
    const decideStep = finding.activityLog!.steps.find(
      (s) => s.kind === "decide",
    );
    expect(ruleStep?.result_summary).toContain("Zone 3");
    expect(decideStep?.result_summary).toBe("Severity: favorable");
  });

  it("still throws on unknown state (existing failure path preserved)", async () => {
    // The activity log on the failure path is emitted but not returned —
    // by design, the orchestrator persists no log when check() throws.
    // We assert behavior here; the error step's emission is exercised by
    // the code path the throw runs through.
    await expect(
      EpaRadonZoneModule.check(
        makeHouse({ state: "Atlantis", county: "Kalamazoo" }),
      ),
    ).rejects.toThrow(/Atlantis/);
  });

  it("still throws when state is present but county is not", async () => {
    await expect(
      EpaRadonZoneModule.check(
        makeHouse({ state: "MI", county: "Fictional" }),
      ),
    ).rejects.toThrow(/Fictional/);
  });
});

describe("buildActions", () => {
  it("returns four actions for Zone 1 in the order [product, product, service, link]", () => {
    const actions = buildActions(1);
    expect(actions.map((a) => a.kind)).toEqual([
      "product",
      "product",
      "service",
      "link",
    ]);
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
