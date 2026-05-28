import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HabitatFinding, HouseContext } from "@/lib/habitat/types";
import FemaFloodZonesModule, {
  __setFloodZonesCacheStoreForTests,
  __setFloodZonesResolveOptionsForTests,
  buildActions,
  buildBfeSentence,
  buildCopy,
  buildMscAddressQuery,
  buildOnboardingMessage,
  buildUnreachableActions,
  type FemaFloodZoneFindings,
} from "./index";
import { classifyFloodZone } from "./classify";
import {
  CACHE_TTL_DAYS,
  deriveCacheKey,
  type CacheKeyStrategy,
  type FloodZonesCacheLookupResult,
  type FloodZonesCacheStore,
} from "./cache";
import type { NormalizedFloodZone } from "./fetch";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * In-memory cache store mirrored from cache.test.ts. Re-implemented
 * here rather than imported because the test-suite-only shape can
 * diverge from production code freely without risking a circular
 * import path.
 */
class InMemoryCacheStore implements FloodZonesCacheStore {
  rows = new Map<
    string,
    {
      keyStrategy: CacheKeyStrategy;
      queriedLatitude: number;
      queriedLongitude: number;
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      refreshedAt: Date;
    }
  >();
  upsertCalls = 0;

  async lookup(cacheKey: string): Promise<FloodZonesCacheLookupResult> {
    const row = this.rows.get(cacheKey);
    if (!row) return { kind: "miss", reason: "no-row" };
    const ageMs = Date.now() - row.refreshedAt.getTime();
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    if (ageMs > CACHE_TTL_DAYS * MS_PER_DAY) {
      return { kind: "miss", reason: "expired" };
    }
    return {
      kind: "hit",
      zones: row.zones,
      rawPayload: row.rawPayload,
      sourceUrl: row.sourceUrl,
      keyStrategy: row.keyStrategy,
      fetchedAt: row.refreshedAt,
      refreshedAt: row.refreshedAt,
      ageDays,
    };
  }

  async lookupAny(cacheKey: string): Promise<FloodZonesCacheLookupResult> {
    const row = this.rows.get(cacheKey);
    if (!row) return { kind: "miss", reason: "no-row" };
    const ageMs = Date.now() - row.refreshedAt.getTime();
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    if (ageMs > CACHE_TTL_DAYS * MS_PER_DAY) {
      return {
        kind: "stale",
        zones: row.zones,
        rawPayload: row.rawPayload,
        sourceUrl: row.sourceUrl,
        keyStrategy: row.keyStrategy,
        fetchedAt: row.refreshedAt,
        refreshedAt: row.refreshedAt,
        ageDays,
      };
    }
    return {
      kind: "hit",
      zones: row.zones,
      rawPayload: row.rawPayload,
      sourceUrl: row.sourceUrl,
      keyStrategy: row.keyStrategy,
      fetchedAt: row.refreshedAt,
      refreshedAt: row.refreshedAt,
      ageDays,
    };
  }

  async upsert(input: {
    cacheKey: string;
    keyStrategy: CacheKeyStrategy;
    queriedLatitude: number;
    queriedLongitude: number;
    zones: NormalizedFloodZone[];
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<void> {
    this.upsertCalls++;
    this.rows.set(input.cacheKey, {
      keyStrategy: input.keyStrategy,
      queriedLatitude: input.queriedLatitude,
      queriedLongitude: input.queriedLongitude,
      zones: input.zones,
      rawPayload: input.rawPayload,
      sourceUrl: input.sourceUrl,
      refreshedAt: new Date(),
    });
  }
}

/**
 * Minimal HouseContext for tests — 604 Norton Dr, Kalamazoo MI per the
 * issue's verification address.
 */
function makeHouse(overrides: Partial<HouseContext> = {}): HouseContext {
  return {
    houseId: "test-house",
    addressLine1: "604 Norton Dr",
    city: "Kalamazoo",
    state: "MI",
    county: "Kalamazoo",
    postalCode: "49006",
    latitude: 42.262,
    longitude: -85.589,
    parcelId: null,
    waterSource: null,
    basementPresent: null,
    waterSystemUserPwsid: null,
    waterSystemPwsidConfidence: null,
    ...overrides,
  };
}

/**
 * Build an NFHL attributes record. Defaults mirror sample 1 from the
 * issue (Zone X minimal hazard, Kalamazoo); overrides let each test
 * fix the relevant fields.
 */
function makeAttrs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    OBJECTID: 20000682,
    DFIRM_ID: "26077C",
    FLD_AR_ID: "26077C_3766",
    STUDY_TYP: "NP",
    FLD_ZONE: "X",
    ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
    SFHA_TF: "F",
    STATIC_BFE: -9999.0,
    V_DATUM: null,
    DEPTH: -9999.0,
    LEN_UNIT: null,
    VELOCITY: -9999.0,
    VEL_UNIT: null,
    BFE_REVERT: -9999.0,
    DEP_REVERT: -9999.0,
    DUAL_ZONE: null,
    SOURCE_CIT: "26077C_STUDY2",
    ...overrides,
  };
}

/**
 * Build a NormalizedFloodZone for copy/onboarding helpers (skip the
 * full-pipeline trip through fetch when only the post-fetch surface
 * is under test).
 */
function makeNormalized(
  overrides: Partial<NormalizedFloodZone> = {},
): NormalizedFloodZone {
  return {
    objectId: 1,
    dfirmId: "26077C",
    fldArId: "26077C_3766",
    studyType: "NP",
    fldZone: "X",
    zoneSubty: "AREA OF MINIMAL FLOOD HAZARD",
    isSfha: false,
    staticBfe: null,
    vDatum: null,
    depth: null,
    lenUnit: null,
    velocity: null,
    velUnit: null,
    floodway: false,
    sourceCitation: "26077C_STUDY2",
    ...overrides,
  };
}

/**
 * Stub global fetch with a function that returns a FEMA-shaped
 * response containing the given attributes array as features.
 */
function stubFetchWithFeatures(
  features: ReadonlyArray<Record<string, unknown>>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { features: features.map((attrs) => ({ attributes: attrs })) };
      },
    })) as unknown as typeof fetch,
  );
}

let testStore: InMemoryCacheStore;

beforeEach(() => {
  testStore = new InMemoryCacheStore();
  __setFloodZonesCacheStoreForTests(testStore);
  // Keep retries off and skip the real setTimeout so tests stay fast.
  __setFloodZonesResolveOptionsForTests({
    retryPolicy: { attempts: 1, baseDelayMs: 0, factor: 1, jitter: 0 },
    sleepImpl: async () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setFloodZonesCacheStoreForTests(null);
  __setFloodZonesResolveOptionsForTests({});
});

describe("FemaFloodZonesModule metadata", () => {
  it("declares its key as 'fema_flood_zones'", () => {
    expect(FemaFloodZonesModule.key).toBe("fema_flood_zones");
  });

  it("declares cadence as 'once'", () => {
    expect(FemaFloodZonesModule.cadence).toBe("once");
  });

  it("declares category as 'environmental'", () => {
    expect(FemaFloodZonesModule.category).toBe("environmental");
  });

  it("has a non-empty description", () => {
    expect(FemaFloodZonesModule.description.length).toBeGreaterThan(0);
  });

  it("declares the iconImage path", () => {
    expect(FemaFloodZonesModule.iconImage).toBe(
      "/habitat_module_images/fema_flood_zones.jpg",
    );
  });
});

describe("FemaFloodZonesModule.isApplicable", () => {
  it("returns true for a fully-populated house", () => {
    expect(FemaFloodZonesModule.isApplicable(makeHouse())).toBe(true);
  });

  it("returns false when latitude is null", () => {
    expect(
      FemaFloodZonesModule.isApplicable(makeHouse({ latitude: null })),
    ).toBe(false);
  });

  it("returns false when longitude is null", () => {
    expect(
      FemaFloodZonesModule.isApplicable(makeHouse({ longitude: null })),
    ).toBe(false);
  });
});

describe("FemaFloodZonesModule.check — Zone X minimal (favorable)", () => {
  beforeEach(() => {
    stubFetchWithFeatures([makeAttrs()]);
  });

  it("returns a favorable finding with the documented headline", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
    expect(finding.headline).toBe(
      "Good news — your home isn't in a FEMA flood zone",
    );
  });

  it("normalizes -9999 sentinels to null in the persisted findings", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    const f = finding.findings as FemaFloodZoneFindings;
    expect(f.zone?.static_bfe).toBeNull();
    expect(f.zone?.depth).toBeNull();
    expect(f.zone?.velocity).toBeNull();
  });

  it("emits a 5-step activity log on the happy path", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.activityLog?.steps).toHaveLength(5);
    expect(finding.activityLog?.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "rule",
      "decide",
      "finding",
    ]);
  });

  it("includes both action chips on a covered finding", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.actions).toHaveLength(2);
    expect(finding.actions?.[0].label).toBe(
      "See your area on FEMA's flood map",
    );
    expect(finding.actions?.[0].url).toContain(
      "https://msc.fema.gov/portal/search?AddressQuery=",
    );
    expect(finding.actions?.[1].label).toBe("Learn about flood zones");
  });
});

describe("FemaFloodZonesModule.check — Zone X shaded (neutral)", () => {
  beforeEach(() => {
    stubFetchWithFeatures([
      makeAttrs({
        OBJECTID: 23752500,
        DFIRM_ID: "26081C",
        FLD_AR_ID: "26081C_1258",
        STUDY_TYP: "SFHA with BFE and floodway",
        FLD_ZONE: "X",
        ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
        SOURCE_CIT: "26081C_STUDY34",
      }),
    ]);
  });

  it("returns a neutral finding with the 500-year floodplain headline", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("neutral");
    expect(finding.headline).toBe("Your home is in a low-risk flood area");
  });
});

describe("FemaFloodZonesModule.check — SFHA inland (concern)", () => {
  it("returns a concern finding for Zone AE", async () => {
    stubFetchWithFeatures([makeAttrs({ FLD_ZONE: "AE", ZONE_SUBTY: null })]);
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("concern");
    expect(finding.headline).toBe(
      "FEMA has mapped your home in the 100-year floodplain",
    );
  });

  it("appends a BFE sentence when STATIC_BFE is present", async () => {
    stubFetchWithFeatures([
      makeAttrs({
        FLD_ZONE: "AE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        STATIC_BFE: 645.5,
        V_DATUM: "NAVD88",
      }),
    ]);
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.summary).toContain(
      "FEMA's base flood elevation here is 645.5 feet (NAVD88).",
    );
  });

  it("omits the BFE sentence when STATIC_BFE is the -9999 sentinel", async () => {
    stubFetchWithFeatures([makeAttrs({ FLD_ZONE: "AE", ZONE_SUBTY: null })]);
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.summary).not.toContain("base flood elevation");
  });
});

describe("FemaFloodZonesModule.check — floodway (critical)", () => {
  beforeEach(() => {
    stubFetchWithFeatures([
      makeAttrs({
        FLD_ZONE: "AE",
        ZONE_SUBTY: "FLOODWAY",
        SFHA_TF: "T",
      }),
    ]);
  });

  it("returns a critical finding with the floodway headline", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("critical");
    expect(finding.headline).toBe(
      "Your home is in a regulatory floodway — this needs attention",
    );
    expect((finding.findings as FemaFloodZoneFindings).zone?.floodway).toBe(true);
  });
});

describe("FemaFloodZonesModule.check — coastal high hazard (critical)", () => {
  beforeEach(() => {
    stubFetchWithFeatures([
      makeAttrs({
        FLD_ZONE: "VE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        VELOCITY: 12.5,
        VEL_UNIT: "Feet/Second",
      }),
    ]);
  });

  it("returns a critical finding for Zone VE", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("critical");
    expect(finding.headline).toBe(
      "Your home is in a coastal high-hazard zone — worth understanding",
    );
    expect(finding.summary).toContain("Zone VE");
  });
});

describe("FemaFloodZonesModule.check — Zone D (caution)", () => {
  it("returns a caution finding for undetermined Zone D", async () => {
    stubFetchWithFeatures([makeAttrs({ FLD_ZONE: "D", ZONE_SUBTY: null })]);
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("caution");
    expect(finding.headline).toBe(
      "FEMA hasn't fully mapped flood risk for your area yet",
    );
  });
});

describe("FemaFloodZonesModule.check — no coverage", () => {
  beforeEach(() => {
    stubFetchWithFeatures([]);
  });

  it("returns a neutral finding with the no-coverage headline", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("neutral");
    expect(finding.headline).toBe("FEMA hasn't mapped flood zones in your area");
  });

  it("persists coverage:false and no zone block", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    const f = finding.findings as FemaFloodZoneFindings;
    expect(f.coverage).toBe(false);
    expect(f.zone).toBeUndefined();
    expect(f.source.queried_coordinates).toEqual({
      lat: 42.262,
      lon: -85.589,
    });
  });

  it("emits a 4-step activity log (rule omitted)", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.activityLog?.steps).toHaveLength(4);
    expect(finding.activityLog?.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "decide",
      "finding",
    ]);
  });

  it("drops the MSC link and keeps only the learn-more action", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.actions).toHaveLength(1);
    expect(finding.actions?.[0].label).toBe("Learn about flood zones");
  });
});

describe("FemaFloodZonesModule.check — multiple overlapping polygons", () => {
  beforeEach(() => {
    // FEMA returned an X polygon and an AE polygon at the boundary.
    // The module should pick AE (more severe) and log the selection.
    stubFetchWithFeatures([
      makeAttrs(),
      makeAttrs({
        OBJECTID: 99999,
        FLD_ZONE: "AE",
        ZONE_SUBTY: null,
        SFHA_TF: "T",
        STATIC_BFE: 645.5,
        V_DATUM: "NAVD88",
      }),
    ]);
  });

  it("picks the more severe AE polygon over the X polygon", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("concern");
    expect((finding.findings as FemaFloodZoneFindings).zone?.code).toBe("AE");
  });

  it("logs the multi-feature selection in the compute step", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    const compute = finding.activityLog?.steps.find((s) => s.kind === "compute");
    expect(compute?.narration).toContain("2 overlapping polygons");
    expect(compute?.narration).toContain("Zone AE");
  });
});

describe("FemaFloodZonesModule.check — unknown FLD_ZONE", () => {
  beforeEach(() => {
    stubFetchWithFeatures([makeAttrs({ FLD_ZONE: "Q", ZONE_SUBTY: null })]);
  });

  it("falls through to caution with the unknown-zone headline", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("caution");
    expect(finding.headline).toContain("Zone Q");
  });

  it("logs the unknown zone in the compute step", async () => {
    const finding = await FemaFloodZonesModule.check(makeHouse());
    const compute = finding.activityLog?.steps.find((s) => s.kind === "compute");
    expect(compute?.narration).toContain('"Q"');
    expect(compute?.detail).toContain("Unknown FLD_ZONE");
  });
});

describe("FemaFloodZonesModule.check — FEMA unreachable, no cache", () => {
  it("returns a neutral unreachable finding instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        async json() {
          return {};
        },
      })) as unknown as typeof fetch,
    );
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("neutral");
    expect(finding.headline).toBe(
      "We couldn't reach FEMA's flood maps right now",
    );
    const f = finding.findings as FemaFloodZoneFindings;
    expect(f.coverage).toBe(false);
    expect(f.zone).toBeUndefined();
  });

  it("emits a 4-step log (fetch / compute / decide / finding) on unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    );
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.activityLog?.steps).toHaveLength(4);
    expect(finding.activityLog?.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "decide",
      "finding",
    ]);
    const compute = finding.activityLog?.steps.find((s) => s.kind === "compute");
    expect(compute?.narration).toContain("couldn't reach FEMA");
  });

  it("keeps the FEMA Map Service Center deep-link in the unreachable action shelf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    );
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.actions).toHaveLength(2);
    expect(finding.actions?.[0].label).toBe(
      "Check FEMA's flood map directly",
    );
    expect(finding.actions?.[0].url).toContain(
      "https://msc.fema.gov/portal/search?AddressQuery=",
    );
  });
});

describe("FemaFloodZonesModule.check — cache hit", () => {
  it("returns the cached zone without calling fetch", async () => {
    const house = makeHouse();
    const key = deriveCacheKey({
      parcelId: house.parcelId,
      latitude: house.latitude!,
      longitude: house.longitude!,
    });
    testStore.rows.set(key.cacheKey, {
      keyStrategy: key.strategy,
      queriedLatitude: house.latitude!,
      queriedLongitude: house.longitude!,
      zones: [
        {
          objectId: 1,
          dfirmId: "26077C",
          fldArId: "26077C_3766",
          studyType: "NP",
          fldZone: "X",
          zoneSubty: "AREA OF MINIMAL FLOOD HAZARD",
          isSfha: false,
          staticBfe: null,
          vDatum: null,
          depth: null,
          lenUnit: null,
          velocity: null,
          velUnit: null,
          floodway: false,
          sourceCitation: "26077C_STUDY2",
        },
      ],
      rawPayload: {},
      sourceUrl: "cached",
      refreshedAt: new Date(),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    const finding = await FemaFloodZonesModule.check(house);
    expect(finding.severity).toBe("favorable");
    expect(fetchSpy).not.toHaveBeenCalled();
    const fetchStep = finding.activityLog?.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.narration).toContain("shared cache");
    expect(fetchStep?.result_summary).toBe("Cache hit");
  });
});

describe("FemaFloodZonesModule.check — retry recovery", () => {
  it("narrates a retried fetch when the second attempt succeeds", async () => {
    // Allow retries for this test; keep sleep a no-op.
    __setFloodZonesResolveOptionsForTests({
      retryPolicy: { attempts: 3, baseDelayMs: 0, factor: 1, jitter: 0 },
      sleepImpl: async () => {},
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            ok: false,
            status: 503,
            async json() {
              return {};
            },
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              features: [{ attributes: makeAttrs() }],
            };
          },
        } as unknown as Response;
      }) as unknown as typeof fetch,
    );
    const finding = await FemaFloodZonesModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
    const fetchStep = finding.activityLog?.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.narration).toContain("tried again");
    expect(call).toBe(2);
  });
});

describe("FemaFloodZonesModule.check — stale-cache fallback", () => {
  it("serves the stale row when FEMA is unreachable and a cached row exists", async () => {
    const house = makeHouse();
    const key = deriveCacheKey({
      parcelId: house.parcelId,
      latitude: house.latitude!,
      longitude: house.longitude!,
    });
    testStore.rows.set(key.cacheKey, {
      keyStrategy: key.strategy,
      queriedLatitude: house.latitude!,
      queriedLongitude: house.longitude!,
      zones: [
        {
          objectId: 1,
          dfirmId: "26077C",
          fldArId: "26077C_3766",
          studyType: "NP",
          fldZone: "AE",
          zoneSubty: null,
          isSfha: true,
          staticBfe: 645.5,
          vDatum: "NAVD88",
          depth: null,
          lenUnit: "Feet",
          velocity: null,
          velUnit: null,
          floodway: false,
          sourceCitation: "26077C_STUDY99",
        },
      ],
      rawPayload: {},
      sourceUrl: "https://example/old",
      refreshedAt: new Date(Date.now() - 200 * MS_PER_DAY),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    );

    const finding = await FemaFloodZonesModule.check(house);
    // Stale cache served a real AE zone, so severity reflects the AE
    // classification rather than the unreachable-neutral fallback.
    expect(finding.severity).toBe("concern");
    const fetchStep = finding.activityLog?.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.narration).toContain("unreachable");
    expect(fetchStep?.narration).toContain("most recent designation");
  });
});

describe("buildBfeSentence", () => {
  it("returns an empty string when staticBfe is null", () => {
    expect(buildBfeSentence(makeNormalized({ staticBfe: null }))).toBe("");
  });

  it("includes the datum clause when vDatum is present", () => {
    const sentence = buildBfeSentence(
      makeNormalized({ staticBfe: 645.5, vDatum: "NAVD88" }),
    );
    expect(sentence).toBe(
      "FEMA's base flood elevation here is 645.5 feet (NAVD88). ",
    );
  });

  it("omits the datum clause when vDatum is null", () => {
    const sentence = buildBfeSentence(
      makeNormalized({ staticBfe: 12, vDatum: null }),
    );
    expect(sentence).toBe("FEMA's base flood elevation here is 12 feet. ");
  });
});

describe("buildMscAddressQuery", () => {
  it("formats the address as line1, city, state postal", () => {
    expect(buildMscAddressQuery(makeHouse())).toBe(
      "604 Norton Dr, Kalamazoo, MI 49006",
    );
  });
});

describe("buildActions", () => {
  it("URL-encodes the address in the MSC link", () => {
    const actions = buildActions(makeHouse(), true);
    const msc = actions[0];
    expect(msc.url).toContain("AddressQuery=");
    expect(msc.url).toContain("604%20Norton%20Dr");
  });
});

describe("buildCopy — all branches", () => {
  it("names the zone code in the SFHA inland summary", () => {
    const zone = makeNormalized({ fldZone: "AO", zoneSubty: null });
    const { summary } = buildCopy(zone, classifyFloodZone(zone));
    expect(summary).toContain("Zone AO");
  });

  it("names the zone code in the coastal summary", () => {
    const zone = makeNormalized({ fldZone: "VE", zoneSubty: null });
    const { summary } = buildCopy(zone, classifyFloodZone(zone));
    expect(summary).toContain("Zone VE");
  });
});

describe("buildOnboardingMessage — all branches", () => {
  function makeFinding(findings: FemaFloodZoneFindings): HabitatFinding {
    return {
      severity: "favorable",
      headline: "h",
      summary: "s",
      findings: findings as unknown as Record<string, unknown>,
    };
  }

  it("returns the no-coverage line when coverage is false", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: false,
        source: {
          dfirm_id: null,
          fld_ar_id: null,
          study_type: null,
          source_citation: null,
          queried_coordinates: { lat: 42.262, lon: -85.589 },
        },
      }),
    );
    expect(msg).toBe(
      "FEMA hasn't mapped flood zones in your area, so I couldn't pull a designation.",
    );
  });

  it("returns the favorable line for Zone X minimal", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "X",
          subtype: "AREA OF MINIMAL FLOOD HAZARD",
          is_sfha: false,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: false,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe("Good news — your home is in a low-risk flood area.");
  });

  it("returns the 500-year line for shaded X", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "X",
          subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
          is_sfha: false,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: false,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe(
      "Your home sits in a low-risk flood area — the 500-year floodplain.",
    );
  });

  it("returns the Zone D line", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "D",
          subtype: null,
          is_sfha: false,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: false,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe("FEMA hasn't fully mapped flood risk for your area yet.");
  });

  it("names the SFHA zone in the concern line", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "AE",
          subtype: null,
          is_sfha: true,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: false,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe(
      "FEMA has mapped your home in the 100-year floodplain — Zone AE.",
    );
  });

  it("returns the floodway line for AE + floodway=true", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "AE",
          subtype: "FLOODWAY",
          is_sfha: true,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: true,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe(
      "FEMA has mapped your home in a regulatory floodway — worth a closer look.",
    );
  });

  it("returns the coastal line for Zone VE", () => {
    const msg = buildOnboardingMessage(
      makeFinding({
        coverage: true,
        zone: {
          code: "VE",
          subtype: null,
          is_sfha: true,
          static_bfe: null,
          v_datum: null,
          depth: null,
          velocity: null,
          floodway: false,
        },
        source: {
          dfirm_id: "x",
          fld_ar_id: "x",
          study_type: "x",
          source_citation: "x",
          queried_coordinates: { lat: 0, lon: 0 },
        },
      }),
    );
    expect(msg).toBe("FEMA has mapped your home in a coastal high-hazard zone.");
  });
});
