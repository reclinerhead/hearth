import { describe, expect, it } from "vitest";
import {
  buildViolationsRow,
  resolveViolations,
  rowToViolation,
  type ViolationsCacheLookupResult,
  type ViolationsCacheStore,
} from "./violations-cache";
import type { SdwisViolationRecord } from "../sources/sdwis-violations";

function violation(
  overrides: Partial<SdwisViolationRecord> = {},
): SdwisViolationRecord {
  return {
    pwsid: "MI0003520",
    violation_id: "V1",
    violation_code: "20",
    is_health_based_ind: "N",
    contaminant_code: "5000",
    viol_first_reported_date: "2024-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("rowToViolation", () => {
  it("re-hydrates required + parsed fields from a Postgres row", () => {
    const out = rowToViolation({
      pwsid: "MI0003520",
      violation_id: "V1",
      violation_code: "20",
      is_health_based_ind: "Y",
      contaminant_code: "5000",
      viol_measure: 0.018,
      viol_first_reported_date: "2024-01-15T00:00:00Z",
      rtc_date: null,
    });
    expect(out.violation_id).toBe("V1");
    expect(out.is_health_based_ind).toBe("Y");
    expect(out.viol_measure).toBe(0.018);
    expect(out.rtc_date).toBeNull();
  });

  it("coerces a numeric viol_measure string", () => {
    const out = rowToViolation({
      pwsid: "MI0003520",
      violation_id: "V1",
      viol_measure: "0.012",
    });
    expect(out.viol_measure).toBe(0.012);
  });

  it("throws when pwsid is missing", () => {
    expect(() => rowToViolation({ violation_id: "V1" })).toThrow(
      /missing pwsid or violation_id/,
    );
  });
});

describe("buildViolationsRow", () => {
  it("projects a record onto the column shape with refreshed_at set", () => {
    const row = buildViolationsRow({
      record: violation(),
      rawRow: { foo: "bar" },
      sourceUrl: "https://example/api",
    });
    expect(row.pwsid).toBe("MI0003520");
    expect(row.violation_id).toBe("V1");
    expect(row.contaminant_code).toBe("5000");
    expect(row.source_url).toBe("https://example/api");
    expect(row.raw_payload).toEqual({ foo: "bar" });
    expect(typeof row.refreshed_at).toBe("string");
  });
});

class InMemoryStore implements ViolationsCacheStore {
  rows = new Map<
    string,
    {
      records: SdwisViolationRecord[];
      sourceUrl: string;
      refreshedAt: Date;
    }
  >();
  lookupCalls = 0;
  upsertCalls = 0;
  failNextLookup = false;

  async lookup(pwsid: string): Promise<ViolationsCacheLookupResult> {
    this.lookupCalls++;
    if (this.failNextLookup) {
      this.failNextLookup = false;
      return { kind: "miss", reason: "lookup-error" };
    }
    const row = this.rows.get(pwsid);
    if (!row) return { kind: "miss", reason: "no-row" };
    const ageMs = Date.now() - row.refreshedAt.getTime();
    if (ageMs > 30 * 24 * 60 * 60 * 1000) {
      return { kind: "miss", reason: "expired" };
    }
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
    records: SdwisViolationRecord[];
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

describe("resolveViolations", () => {
  it("returns cached records on a hit without calling EPA", async () => {
    const store = new InMemoryStore();
    store.rows.set("MI0003520", {
      records: [violation()],
      sourceUrl: "cached",
      refreshedAt: new Date(),
    });
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const r = await resolveViolations("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("hit");
    expect(r.records).toHaveLength(1);
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
              violation_id: "V1",
              is_health_based_ind: "Y",
            },
          ];
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const r = await resolveViolations("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("miss");
    expect(r.records).toHaveLength(1);
    expect(store.upsertCalls).toBe(1);
  });

  it("falls back to EPA and still upserts when lookup errors", async () => {
    const store = new InMemoryStore();
    store.failNextLookup = true;
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const r = await resolveViolations("MI0003520", store, { fetchImpl });
    expect(r.cache.kind).toBe("miss");
    if (r.cache.kind === "miss") expect(r.cache.reason).toBe("lookup-error");
    expect(store.upsertCalls).toBe(1);
  });

  it("upserts a zero-row freshness record when EPA returns empty (records as cache-hit signal)", async () => {
    const store = new InMemoryStore();
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const r = await resolveViolations("MI0003520", store, { fetchImpl });
    expect(r.records).toEqual([]);
    expect(store.upsertCalls).toBe(1);
    expect(store.rows.get("MI0003520")?.records).toEqual([]);
  });
});
