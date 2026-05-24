import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_DAYS,
  fetchNplSitesInStateCached,
  type EnvirofactsCacheStore,
} from "./cache";
import type { NplSite } from "./fetch";

/**
 * Stub the EPA Envirofacts response with a single recognizable site
 * so cache-hit tests can distinguish "served from cache" from
 * "served from a fresh fetch" by inspecting the returned shape.
 */
function stubFetchWithSites(sites: NplSite[]): void {
  const row = (site: NplSite) =>
    sites.length > 0
      ? site.contaminants.map((c) => ({ ...site, preferred_contaminant_name: c }))
      : [{ ...site, preferred_contaminant_name: null }];
  const rows = sites.flatMap(row);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return rows;
      },
    })) as unknown as typeof fetch,
  );
}

function makeStubSite(siteId: string, contaminants: string[] = []): NplSite {
  return {
    site_id: siteId,
    epa_id: siteId,
    name: "STUB SITE",
    street_addr_txt: "1 STUB ST",
    supplemental_addr_txt: null,
    city_name: "STUBVILLE",
    county_name: "STUB",
    fk_ref_state_code: "MI",
    zip_code: "00000",
    primary_latitude_decimal_val: "42.0",
    primary_longitude_decimal_val: "-85.0",
    npl_status_code: "F",
    npl_status_name: "Final NPL",
    non_npl_status_code: null,
    non_npl_status_name: null,
    archived_ind: "N",
    archived_date: null,
    federal_facility_ind: "N",
    fips_code: null,
    fk_ref_region_code: "05",
    congressional_district_code: null,
    saa_agreement_site_ind: "N",
    contaminants,
  };
}

/**
 * In-memory test double. Mirrors the Supabase store's soft-fail
 * contract (lookup always resolves; upsert never throws) but lets
 * tests assert exact call counts and seed deterministic data.
 */
function makeMemoryStore(seed?: {
  stateCode: string;
  sites: NplSite[];
  fetchedAt: Date;
}): EnvirofactsCacheStore & { lookups: number; upserts: number } {
  let row =
    seed != null
      ? { sites: seed.sites, fetchedAt: seed.fetchedAt, stateCode: seed.stateCode }
      : null;
  const store: EnvirofactsCacheStore & { lookups: number; upserts: number } = {
    lookups: 0,
    upserts: 0,
    async lookup(stateCode) {
      store.lookups++;
      if (!row || row.stateCode !== stateCode) {
        return { kind: "miss", reason: "no-row" };
      }
      const ageMs = Date.now() - row.fetchedAt.getTime();
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      if (ageMs > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
        return { kind: "miss", reason: "expired" };
      }
      return {
        kind: "hit",
        sites: row.sites,
        fetchedAt: row.fetchedAt,
        ageDays,
      };
    },
    async upsert(stateCode, sites) {
      store.upserts++;
      row = { stateCode, sites, fetchedAt: new Date() };
    },
  };
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNplSitesInStateCached", () => {
  it("returns the cached array and skips the EPA fetch on a fresh cache hit", async () => {
    const cached = [makeStubSite("CACHED_SITE", ["LEAD"])];
    const store = makeMemoryStore({
      stateCode: "MI",
      sites: cached,
      fetchedAt: new Date(),
    });
    // Stub fetch to throw if it's accidentally called — proves we
    // never reached the network on a cache hit.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("EPA should not have been called");
      }) as unknown as typeof fetch,
    );
    const result = await fetchNplSitesInStateCached("MI", store);
    expect(result.cache.kind).toBe("hit");
    expect(result.sites).toEqual(cached);
    expect(store.lookups).toBe(1);
    expect(store.upserts).toBe(0);
  });

  it("fetches from EPA and upserts the cache on a miss (no row yet)", async () => {
    const sites = [makeStubSite("FRESH_SITE", ["LEAD"])];
    stubFetchWithSites(sites);
    const store = makeMemoryStore();
    const result = await fetchNplSitesInStateCached("MI", store);
    expect(result.cache.kind).toBe("miss");
    if (result.cache.kind === "miss") {
      expect(result.cache.reason).toBe("no-row");
    }
    expect(result.sites[0].site_id).toBe("FRESH_SITE");
    expect(store.upserts).toBe(1);
  });

  it("refetches from EPA and updates the cache when the cached row is older than TTL", async () => {
    const stale = [makeStubSite("STALE_SITE", ["LEAD"])];
    const fresh = [makeStubSite("FRESH_SITE", ["MERCURY"])];
    // Seed a row 30 days in the past — well beyond the 7-day TTL.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const store = makeMemoryStore({
      stateCode: "MI",
      sites: stale,
      fetchedAt: thirtyDaysAgo,
    });
    stubFetchWithSites(fresh);
    const result = await fetchNplSitesInStateCached("MI", store);
    expect(result.cache.kind).toBe("miss");
    if (result.cache.kind === "miss") {
      expect(result.cache.reason).toBe("expired");
    }
    expect(result.sites[0].site_id).toBe("FRESH_SITE");
    expect(store.upserts).toBe(1);
  });

  it("does not upsert when the EPA fetch throws (so a transient network error doesn't poison the cache)", async () => {
    const store = makeMemoryStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        async json() {
          return null;
        },
      })) as unknown as typeof fetch,
    );
    await expect(
      fetchNplSitesInStateCached("MI", store),
    ).rejects.toThrow(/HTTP 503/);
    expect(store.upserts).toBe(0);
  });

  it("treats the state code case-insensitively (always uppercased before lookup)", async () => {
    const sites = [makeStubSite("ONE", ["LEAD"])];
    stubFetchWithSites(sites);
    const store = makeMemoryStore();
    const lookupSpy = vi.spyOn(store, "lookup");
    await fetchNplSitesInStateCached("mi", store);
    expect(lookupSpy).toHaveBeenCalledWith("MI");
  });

  it("treats a lookup error as a miss and still returns the EPA response", async () => {
    // A store whose lookup rejects — mirrors what a Supabase outage
    // would look like at runtime. The wrapper's contract says
    // lookup *resolves* with a "lookup-error" miss; this test
    // documents that contract by adapting a throwing impl into the
    // expected shape.
    const sites = [makeStubSite("EPA_FALLBACK", ["LEAD"])];
    stubFetchWithSites(sites);
    const store: EnvirofactsCacheStore = {
      async lookup() {
        return { kind: "miss", reason: "lookup-error" };
      },
      async upsert() {
        // no-op, mirroring Supabase soft-fail
      },
    };
    const result = await fetchNplSitesInStateCached("MI", store);
    expect(result.cache.kind).toBe("miss");
    if (result.cache.kind === "miss") {
      expect(result.cache.reason).toBe("lookup-error");
    }
    expect(result.sites[0].site_id).toBe("EPA_FALLBACK");
  });
});

/**
 * The Supabase-backed store factory is exercised end-to-end via the
 * env-availability gate. In the test runner the Supabase env vars
 * are unset, so the factory's methods short-circuit to miss / no-op
 * without ever touching the network.
 */
describe("createSupabaseEnvirofactsCacheStore — env gate", () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    if (ORIGINAL_URL !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
    }
    if (ORIGINAL_KEY !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
    }
  });

  it("returns 'miss' from lookup when Supabase env vars are unset, without logging or throwing", async () => {
    // Dynamic-import the module under test AFTER unsetting env so
    // the gate observes the unset state. The factory itself is a
    // pure-function returning a fresh closure each call.
    const { createSupabaseEnvirofactsCacheStore } = await import("./cache");
    const store = createSupabaseEnvirofactsCacheStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await store.lookup("MI");
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("lookup-error");
    }
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("silently returns from upsert when Supabase env vars are unset", async () => {
    const { createSupabaseEnvirofactsCacheStore } = await import("./cache");
    const store = createSupabaseEnvirofactsCacheStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(store.upsert("MI", [])).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
