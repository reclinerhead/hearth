import { describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_DAYS,
  deriveCacheKey,
  resolveFloodZones,
  rowToHit,
  type CacheKeyStrategy,
  type FloodZonesCacheLookupResult,
  type FloodZonesCacheStore,
} from "./cache";
import type { NormalizedFloodZone } from "./fetch";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Single-shot retry policy + no-op sleep so the resolve-layer tests
 * don't accidentally probe the network three times when they're
 * really testing cache behavior.
 */
const SINGLE_SHOT_OPTS = {
  retryPolicy: { attempts: 1, baseDelayMs: 0, factor: 1, jitter: 0 },
  sleepImpl: async () => {},
} as const;

/** Build a NormalizedFloodZone with sane defaults for caching tests. */
function zone(overrides: Partial<NormalizedFloodZone> = {}): NormalizedFloodZone {
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
 * FEMA-shaped response containing a single Zone X polygon. Lets the
 * resolve-layer tests verify cache writes round-trip back through
 * the normalizer.
 */
function fakeNfhlResponse(features: ReadonlyArray<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { features: features.map((attributes) => ({ attributes })) };
    },
  } as unknown as Response;
}

function nfhlAttrs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
 * In-memory cache store for resolveFloodZones tests. Behaves like the
 * real Supabase-backed store from the consumer's perspective — lookup
 * returns hit/miss/stale results, upsert never throws.
 */
class InMemoryStore implements FloodZonesCacheStore {
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
  lookupCalls = 0;
  lookupAnyCalls = 0;
  upsertCalls = 0;
  failNextLookup = false;
  failNextLookupAny = false;

  async lookup(cacheKey: string): Promise<FloodZonesCacheLookupResult> {
    this.lookupCalls++;
    if (this.failNextLookup) {
      this.failNextLookup = false;
      return { kind: "miss", reason: "lookup-error" };
    }
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
    this.lookupAnyCalls++;
    if (this.failNextLookupAny) {
      this.failNextLookupAny = false;
      return { kind: "miss", reason: "lookup-error" };
    }
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

describe("deriveCacheKey", () => {
  it("uses parcel:<id> when a parcel ID is present", () => {
    const result = deriveCacheKey({
      parcelId: "06-22-355-001",
      latitude: 42.262,
      longitude: -85.589,
    });
    expect(result.cacheKey).toBe("parcel:06-22-355-001");
    expect(result.strategy).toBe("parcel");
  });

  it("falls back to coord:<lat,lon> 5dp when parcel is null", () => {
    const result = deriveCacheKey({
      parcelId: null,
      latitude: 42.262123,
      longitude: -85.589456,
    });
    expect(result.cacheKey).toBe("coord:42.26212,-85.58946");
    expect(result.strategy).toBe("coordinate");
  });

  it("falls back to coords when parcel is empty / whitespace", () => {
    const result = deriveCacheKey({
      parcelId: "   ",
      latitude: 42.262,
      longitude: -85.589,
    });
    expect(result.cacheKey).toBe("coord:42.26200,-85.58900");
    expect(result.strategy).toBe("coordinate");
  });

  it("produces the same key for points within ~1m", () => {
    // 5dp ≈ 1.1m at the equator; both points round to the same key.
    const a = deriveCacheKey({
      parcelId: null,
      latitude: 42.2620049,
      longitude: -85.5890049,
    });
    const b = deriveCacheKey({
      parcelId: null,
      latitude: 42.2619951,
      longitude: -85.5889951,
    });
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});

describe("rowToHit", () => {
  it("returns a fresh hit when refreshed_at is within the TTL", () => {
    const now = Date.now();
    const row = {
      cache_key: "parcel:abc",
      key_strategy: "parcel",
      zones: [zone()],
      raw_payload: { features: [] },
      source_url: "https://example.test",
      fetched_at: new Date(now - 30 * MS_PER_DAY).toISOString(),
      refreshed_at: new Date(now - 30 * MS_PER_DAY).toISOString(),
    };
    const result = rowToHit(row, { allowStale: false });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.keyStrategy).toBe("parcel");
      expect(result.zones).toHaveLength(1);
      expect(result.ageDays).toBeGreaterThanOrEqual(29);
    }
  });

  it("returns a miss('expired') when past the TTL and stale isn't allowed", () => {
    const now = Date.now();
    const row = {
      cache_key: "parcel:abc",
      key_strategy: "parcel",
      zones: [zone()],
      raw_payload: {},
      source_url: "https://example.test",
      fetched_at: new Date(now - 400 * MS_PER_DAY).toISOString(),
      refreshed_at: new Date(now - 400 * MS_PER_DAY).toISOString(),
    };
    const result = rowToHit(row, { allowStale: false });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("expired");
    }
  });

  it("returns a 'stale' row when past the TTL and stale is allowed", () => {
    const now = Date.now();
    const row = {
      cache_key: "parcel:abc",
      key_strategy: "coordinate",
      zones: [],
      raw_payload: {},
      source_url: "https://example.test",
      fetched_at: new Date(now - 400 * MS_PER_DAY).toISOString(),
      refreshed_at: new Date(now - 400 * MS_PER_DAY).toISOString(),
    };
    const result = rowToHit(row, { allowStale: true });
    expect(result.kind).toBe("stale");
    if (result.kind === "stale") {
      expect(result.ageDays).toBeGreaterThanOrEqual(399);
      expect(result.zones).toEqual([]);
    }
  });
});

describe("resolveFloodZones — cache hit", () => {
  it("returns source:'cache' and never calls fetch", async () => {
    const store = new InMemoryStore();
    const key = deriveCacheKey({
      parcelId: null,
      latitude: 42.262,
      longitude: -85.589,
    });
    store.rows.set(key.cacheKey, {
      keyStrategy: "coordinate",
      queriedLatitude: 42.262,
      queriedLongitude: -85.589,
      zones: [zone()],
      rawPayload: {},
      sourceUrl: "cached",
      refreshedAt: new Date(),
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not be called on cache hit");
    }) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { ...SINGLE_SHOT_OPTS, fetchImpl },
    );

    expect(result.source).toBe("cache");
    if (result.source === "cache") {
      expect(result.keyStrategy).toBe("coordinate");
      expect(result.zones).toHaveLength(1);
    }
    expect(store.upsertCalls).toBe(0);
  });
});

describe("resolveFloodZones — cache miss + successful fetch + upsert", () => {
  it("fetches FEMA, returns source:'fetch', and writes the cache", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn(
      async () => fakeNfhlResponse([nfhlAttrs()]),
    ) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: "06-22-355-001", latitude: 42.262, longitude: -85.589 },
      store,
      { ...SINGLE_SHOT_OPTS, fetchImpl },
    );

    expect(result.source).toBe("fetch");
    if (result.source === "fetch") {
      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].fldZone).toBe("X");
      expect(result.retryCount).toBe(0);
      expect(result.cacheMissReason).toBe("no-row");
    }
    expect(store.upsertCalls).toBe(1);
    expect(store.rows.has("parcel:06-22-355-001")).toBe(true);
  });
});

describe("resolveFloodZones — cache miss + retry recovery", () => {
  it("reports retryCount on a fetch that succeeded after retry", async () => {
    const store = new InMemoryStore();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: false, status: 503, async json() { return {}; } } as unknown as Response;
      return fakeNfhlResponse([nfhlAttrs()]);
    }) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { fetchImpl, sleepImpl: async () => {} },
    );

    expect(result.source).toBe("fetch");
    if (result.source === "fetch") {
      expect(result.retryCount).toBe(1);
    }
    expect(call).toBe(2);
    expect(store.upsertCalls).toBe(1);
  });
});

describe("resolveFloodZones — cache miss + total fetch failure + stale fallback", () => {
  it("serves a stale cached row when FEMA is unreachable", async () => {
    const store = new InMemoryStore();
    const key = deriveCacheKey({
      parcelId: null,
      latitude: 42.262,
      longitude: -85.589,
    });
    // Backdate the cached row past the 180-day TTL.
    store.rows.set(key.cacheKey, {
      keyStrategy: "coordinate",
      queriedLatitude: 42.262,
      queriedLongitude: -85.589,
      zones: [zone({ fldZone: "AE" })],
      rawPayload: {},
      sourceUrl: "https://example.test/old",
      refreshedAt: new Date(Date.now() - 200 * MS_PER_DAY),
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { fetchImpl, sleepImpl: async () => {} },
    );

    expect(result.source).toBe("stale");
    if (result.source === "stale") {
      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].fldZone).toBe("AE");
      expect(result.ageDays).toBeGreaterThanOrEqual(199);
      expect(result.attempts).toBe(3); // exhausted default policy
    }
    expect(store.upsertCalls).toBe(0); // do not overwrite stale data with a failure
  });
});

describe("resolveFloodZones — total fetch failure + no cache row", () => {
  it("returns source:'unreachable' when both cache and FEMA are empty", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { fetchImpl, sleepImpl: async () => {} },
    );

    expect(result.source).toBe("unreachable");
    if (result.source === "unreachable") {
      expect(result.attempts).toBe(3);
      expect(result.fetchError.message).toContain("ECONNRESET");
    }
    expect(store.upsertCalls).toBe(0);
  });
});

describe("resolveFloodZones — parcel vs coordinate keying", () => {
  it("uses parcel key when parcelId is present", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn(
      async () => fakeNfhlResponse([]),
    ) as unknown as typeof fetch;

    await resolveFloodZones(
      { parcelId: "06-22-355-001", latitude: 42.262, longitude: -85.589 },
      store,
      { ...SINGLE_SHOT_OPTS, fetchImpl },
    );
    expect(store.rows.has("parcel:06-22-355-001")).toBe(true);
  });

  it("uses coordinate key when parcelId is null", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn(
      async () => fakeNfhlResponse([]),
    ) as unknown as typeof fetch;

    await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { ...SINGLE_SHOT_OPTS, fetchImpl },
    );
    expect(store.rows.has("coord:42.26200,-85.58900")).toBe(true);
  });
});

describe("resolveFloodZones — soft-fail on Supabase lookup outage", () => {
  it("falls back to FEMA when lookup errors, and still upserts", async () => {
    const store = new InMemoryStore();
    store.failNextLookup = true;
    const fetchImpl = vi.fn(
      async () => fakeNfhlResponse([nfhlAttrs()]),
    ) as unknown as typeof fetch;

    const result = await resolveFloodZones(
      { parcelId: null, latitude: 42.262, longitude: -85.589 },
      store,
      { ...SINGLE_SHOT_OPTS, fetchImpl },
    );

    expect(result.source).toBe("fetch");
    if (result.source === "fetch") {
      expect(result.cacheMissReason).toBe("lookup-error");
    }
    expect(store.upsertCalls).toBe(1);
  });
});

describe("resolveFloodZones — refuses to run without coordinates", () => {
  it("throws when latitude is null", async () => {
    const store = new InMemoryStore();
    await expect(
      resolveFloodZones(
        { parcelId: null, latitude: null, longitude: -85.589 },
        store,
        SINGLE_SHOT_OPTS,
      ),
    ).rejects.toThrow(/requires lat\/lng coordinates/);
  });
});
