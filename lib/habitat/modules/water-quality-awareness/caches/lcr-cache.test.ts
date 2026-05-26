import { describe, expect, it } from "vitest";
import {
  buildLcrSampleRow,
  resolveLcrSamples,
  rowToLcrSample,
  type LcrCacheLookupResult,
  type LcrCacheStore,
} from "./lcr-cache";
import type { SdwisLcrSampleRecord } from "../sources/sdwis-lcr-samples";

function lcrSample(
  overrides: Partial<SdwisLcrSampleRecord> = {},
): SdwisLcrSampleRecord {
  return {
    pwsid: "MI0003520",
    sample_id: "S1",
    contaminant_code: "5000",
    sampling_start_date: "2024-01-01T00:00:00Z",
    sampling_end_date: "2024-06-30T00:00:00Z",
    sample_measure: 0.005,
    unit_of_measure: "MG/L",
    result_sign_code: "=",
    ...overrides,
  };
}

describe("rowToLcrSample", () => {
  it("re-hydrates from a Postgres row", () => {
    const out = rowToLcrSample({
      pwsid: "MI0003520",
      sample_id: "S1",
      contaminant_code: "5000",
      sample_measure: 0.005,
      unit_of_measure: "MG/L",
      result_sign_code: "<",
    });
    expect(out.sample_id).toBe("S1");
    expect(out.sample_measure).toBe(0.005);
    expect(out.result_sign_code).toBe("<");
  });

  it("throws when sample_id is missing", () => {
    expect(() => rowToLcrSample({ pwsid: "MI0003520" })).toThrow(
      /missing pwsid or sample_id/,
    );
  });
});

describe("buildLcrSampleRow", () => {
  it("maps a record onto the column shape with refreshed_at set", () => {
    const row = buildLcrSampleRow({
      record: lcrSample(),
      rawRow: { x: 1 },
      sourceUrl: "https://example/api",
    });
    expect(row.pwsid).toBe("MI0003520");
    expect(row.sample_id).toBe("S1");
    expect(row.sample_measure).toBe(0.005);
    expect(row.raw_payload).toEqual({ x: 1 });
    expect(typeof row.refreshed_at).toBe("string");
  });
});

class InMemoryStore implements LcrCacheStore {
  rows = new Map<
    string,
    {
      records: SdwisLcrSampleRecord[];
      sourceUrl: string;
      refreshedAt: Date;
    }
  >();
  upsertCalls = 0;

  async lookup(pwsid: string): Promise<LcrCacheLookupResult> {
    const row = this.rows.get(pwsid);
    if (!row) return { kind: "miss", reason: "no-row" };
    const ageMs = Date.now() - row.refreshedAt.getTime();
    return {
      kind: "hit",
      records: row.records,
      fetchedAt: row.refreshedAt,
      ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      rowCount: row.records.length,
      sourceUrl: row.sourceUrl,
    };
  }

  async upsert(input: {
    pwsid: string;
    records: SdwisLcrSampleRecord[];
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<void> {
    this.upsertCalls++;
    this.rows.set(input.pwsid, {
      records: input.records,
      sourceUrl: input.sourceUrl,
      refreshedAt: new Date(),
    });
  }
}

describe("resolveLcrSamples", () => {
  it("returns cached records on a hit", async () => {
    const store = new InMemoryStore();
    store.rows.set("MI0003520", {
      records: [lcrSample()],
      sourceUrl: "cached",
      refreshedAt: new Date(),
    });
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const r = await resolveLcrSamples("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("hit");
    expect(r.records).toHaveLength(1);
    expect(store.upsertCalls).toBe(0);
  });

  it("fetches from EPA and upserts on a miss, even when records are empty", async () => {
    const store = new InMemoryStore();
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const r = await resolveLcrSamples("MI0003520", store, { fetchImpl });
    expect(r.records).toEqual([]);
    expect(store.upsertCalls).toBe(1);
  });
});
