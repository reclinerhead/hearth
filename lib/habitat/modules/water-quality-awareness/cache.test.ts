import { describe, expect, it } from "vitest";
import {
  buildWaterSystemsRow,
  resolveWaterSystem,
  rowToRecord,
  type WaterSystemCacheLookupResult,
  type WaterSystemCacheStore,
} from "./cache";
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";

function kalamazoo(
  overrides: Partial<EnvirofactsWaterSystemRecord> = {},
): EnvirofactsWaterSystemRecord {
  return {
    pwsid: "MI0003520",
    pws_name: "KALAMAZOO",
    pws_activity_code: "A",
    pws_type_code: "CWS",
    gw_sw_code: "GW",
    population_served_count: 192992,
    service_connections_count: 41411,
    email_addr: "bakerj@kalamazoocity.org",
    admin_name: "BAKER, JAMES",
    ...overrides,
  };
}

describe("rowToRecord", () => {
  it("re-hydrates required + optional fields from a Postgres row", () => {
    const out = rowToRecord({
      pwsid: "MI0003520",
      pws_name: "KALAMAZOO",
      pws_activity_code: "A",
      pws_type_code: "CWS",
      gw_sw_code: "GW",
      population_served_count: 192992,
      email_addr: null,
    });
    expect(out.pwsid).toBe("MI0003520");
    expect(out.population_served_count).toBe(192992);
    expect(out.email_addr).toBeNull();
  });

  it("throws when a required column is missing", () => {
    expect(() =>
      rowToRecord({
        pwsid: "MI0003520",
        pws_name: "KALAMAZOO",
        pws_activity_code: "A",
        // pws_type_code missing
      }),
    ).toThrow(/missing one of the required fields/);
  });
});

describe("buildWaterSystemsRow", () => {
  it("maps the record + payload + source URL onto the column shape", () => {
    const row = buildWaterSystemsRow({
      record: kalamazoo(),
      rawPayload: [{ pwsid: "MI0003520" }],
      sourceUrl: "https://example/api",
    });
    expect(row.pwsid).toBe("MI0003520");
    expect(row.population_served_count).toBe(192992);
    expect(row.source_url).toBe("https://example/api");
    expect(row.raw_payload).toEqual([{ pwsid: "MI0003520" }]);
    expect(typeof row.refreshed_at).toBe("string");
  });

  it("nulls optional fields when the record doesn't carry them", () => {
    const row = buildWaterSystemsRow({
      record: {
        pwsid: "MI0003520",
        pws_name: "KALAMAZOO",
        pws_activity_code: "A",
        pws_type_code: "CWS",
      },
      rawPayload: {},
      sourceUrl: "https://example/api",
    });
    expect(row.population_served_count).toBeNull();
    expect(row.email_addr).toBeNull();
    expect(row.source_water_protection_code).toBeNull();
  });
});

/**
 * In-memory cache store for testing resolveWaterSystem. Behaves like
 * the real Supabase-backed store from the consumer's perspective —
 * lookup returns hit/miss results, upsert never throws.
 */
class InMemoryStore implements WaterSystemCacheStore {
  rows = new Map<
    string,
    {
      record: EnvirofactsWaterSystemRecord;
      rawPayload: unknown;
      sourceUrl: string;
      refreshedAt: Date;
    }
  >();
  lookupCalls = 0;
  upsertCalls = 0;
  /** Allow tests to force-fail lookup once to exercise the lookup-error path. */
  failNextLookup = false;

  async lookup(pwsid: string): Promise<WaterSystemCacheLookupResult> {
    this.lookupCalls++;
    if (this.failNextLookup) {
      this.failNextLookup = false;
      return { kind: "miss", reason: "lookup-error" };
    }
    const row = this.rows.get(pwsid);
    if (!row) return { kind: "miss", reason: "no-row" };
    const ageMs = Date.now() - row.refreshedAt.getTime();
    if (ageMs > 90 * 24 * 60 * 60 * 1000) {
      return { kind: "miss", reason: "expired" };
    }
    return {
      kind: "hit",
      record: row.record,
      rawPayload: row.rawPayload,
      sourceUrl: row.sourceUrl,
      fetchedAt: row.refreshedAt,
      refreshedAt: row.refreshedAt,
      ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    };
  }

  async upsert(input: {
    record: EnvirofactsWaterSystemRecord;
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<void> {
    this.upsertCalls++;
    this.rows.set(input.record.pwsid, { ...input, refreshedAt: new Date() });
  }
}

describe("resolveWaterSystem", () => {
  it("returns the cached record without a fetch on a fresh hit", async () => {
    const store = new InMemoryStore();
    store.rows.set("MI0003520", {
      record: kalamazoo(),
      rawPayload: [],
      sourceUrl: "cached",
      refreshedAt: new Date(),
    });

    const fetchImpl = (async () => {
      throw new Error("should not be called on hit");
    }) as unknown as typeof fetch;

    const r = await resolveWaterSystem("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("hit");
    expect(r.record?.pwsid).toBe("MI0003520");
    expect(store.upsertCalls).toBe(0);
  });

  it("fetches from EPA and upserts on a miss", async () => {
    const store = new InMemoryStore();

    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [
            {
              pwsid: "MI0003520",
              pws_name: "KALAMAZOO",
              pws_activity_code: "A",
              pws_type_code: "CWS",
            },
          ];
        },
      }) as unknown as Response) as unknown as typeof fetch;

    const r = await resolveWaterSystem("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("miss");
    expect(r.record?.pwsid).toBe("MI0003520");
    expect(store.upsertCalls).toBe(1);
    expect(store.rows.has("MI0003520")).toBe(true);
  });

  it("falls back to EPA when lookup itself errors, and still upserts", async () => {
    const store = new InMemoryStore();
    store.failNextLookup = true;

    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [
            {
              pwsid: "MI0003520",
              pws_name: "KALAMAZOO",
              pws_activity_code: "A",
              pws_type_code: "CWS",
            },
          ];
        },
      }) as unknown as Response) as unknown as typeof fetch;

    const r = await resolveWaterSystem("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("miss");
    if (r.cache.kind === "miss") {
      expect(r.cache.reason).toBe("lookup-error");
    }
    expect(store.upsertCalls).toBe(1);
  });

  it("does not upsert when Envirofacts returns no record", async () => {
    const store = new InMemoryStore();
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      }) as unknown as Response) as unknown as typeof fetch;

    const r = await resolveWaterSystem("MI9999999", store, { fetchImpl });
    expect(r.record).toBeNull();
    expect(store.upsertCalls).toBe(0);
  });
});
