import { describe, expect, it } from "vitest";
import {
  resolveCcrHistory,
  resolveLatestCcr,
  type CcrCacheLookupResult,
  type CcrCacheRow,
  type CcrCacheStore,
} from "./ccr-cache";
import type { CcrExtractionResult } from "@/lib/documents/ai/ccr-schema";

const SAMPLE_EXTRACTED_DATA: CcrExtractionResult = {
  header_metadata: {
    utility_name: "<placeholder utility>",
    pwsid: "MI0003520",
    report_year: 2024,
    publication_date: "2025-05-15",
  },
  detected_contaminants: [],
  lead_copper_distribution: null,
  ucmr_results: null,
  free_testing_offer: null,
  ai_confidence: 0.91,
};

function row(overrides: Partial<CcrCacheRow> = {}): CcrCacheRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    pwsid: "MI0003520",
    report_year: 2024,
    edition: "primary",
    extracted_data: SAMPLE_EXTRACTED_DATA,
    extraction_version: "v1",
    published_date: "2025-05-15",
    extracted_at: "2025-05-20T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * In-memory store used by the resolver tests. Keys by normalized
 * (uppercase) PWSID like the real store does.
 */
class InMemoryStore implements CcrCacheStore {
  rows = new Map<string, CcrCacheRow[]>();
  lookupErrorForPwsid: string | null = null;

  insert(r: CcrCacheRow) {
    const key = r.pwsid.toUpperCase();
    const existing = this.rows.get(key) ?? [];
    existing.push(r);
    this.rows.set(key, existing);
  }

  async lookupLatest(pwsid: string): Promise<CcrCacheLookupResult> {
    const normalized = pwsid.trim().toUpperCase();
    if (this.lookupErrorForPwsid === normalized) {
      return { kind: "miss", reason: "lookup-error" };
    }
    const all = this.rows.get(normalized) ?? [];
    const primaryOnly = all.filter((r) => r.edition === "primary");
    if (primaryOnly.length === 0) {
      return { kind: "miss", reason: "no-row" };
    }
    const latest = primaryOnly.reduce((acc, r) =>
      r.report_year > acc.report_year ? r : acc,
    );
    return { kind: "hit", row: latest };
  }

  async lookupHistory(pwsid: string): Promise<CcrCacheRow[]> {
    const normalized = pwsid.trim().toUpperCase();
    if (this.lookupErrorForPwsid === normalized) {
      // Soft-fail contract: errors resolve to an empty history.
      return [];
    }
    const all = this.rows.get(normalized) ?? [];
    return all
      .filter((r) => r.edition === "primary")
      .sort((a, b) => b.report_year - a.report_year);
  }
}

describe("resolveLatestCcr", () => {
  it("returns the row and a 'hit' cache result when the store has one", async () => {
    const store = new InMemoryStore();
    store.insert(row());

    const out = await resolveLatestCcr("MI0003520", store);

    expect(out.row).not.toBeNull();
    expect(out.row?.report_year).toBe(2024);
    expect(out.cache.kind).toBe("hit");
  });

  it("returns null + miss-no-row when no row exists for the PWSID", async () => {
    const store = new InMemoryStore();

    const out = await resolveLatestCcr("MI0003520", store);

    expect(out.row).toBeNull();
    expect(out.cache).toEqual({ kind: "miss", reason: "no-row" });
  });

  it("returns null + miss-lookup-error when the store errors", async () => {
    const store = new InMemoryStore();
    store.lookupErrorForPwsid = "MI0003520";

    const out = await resolveLatestCcr("MI0003520", store);

    expect(out.row).toBeNull();
    expect(out.cache).toEqual({ kind: "miss", reason: "lookup-error" });
  });

  it("picks the highest report_year when multiple primary editions exist", async () => {
    const store = new InMemoryStore();
    store.insert(row({ id: "older", report_year: 2022 }));
    store.insert(row({ id: "newer", report_year: 2024 }));
    store.insert(row({ id: "oldest", report_year: 2020 }));

    const out = await resolveLatestCcr("MI0003520", store);

    expect(out.row?.id).toBe("newer");
    expect(out.row?.report_year).toBe(2024);
  });

  it("normalizes the PWSID input to uppercase before lookup", async () => {
    const store = new InMemoryStore();
    store.insert(row());

    const out = await resolveLatestCcr("mi0003520", store);

    expect(out.row).not.toBeNull();
    expect(out.row?.pwsid).toBe("MI0003520");
  });

  it("does not surface supplement / correction editions as the 'latest'", async () => {
    // The orchestrator's findings view only surfaces primary editions.
    // Supplements and corrections live in the table but aren't read
    // through lookupLatest — the InMemoryStore models this filter.
    const store = new InMemoryStore();
    store.insert(row({ report_year: 2024, edition: "supplement" }));

    const out = await resolveLatestCcr("MI0003520", store);

    expect(out.row).toBeNull();
    expect(out.cache.kind).toBe("miss");
  });
});

describe("resolveCcrHistory", () => {
  it("returns every primary edition newest-first", async () => {
    const store = new InMemoryStore();
    store.insert(row({ id: "y2022", report_year: 2022 }));
    store.insert(row({ id: "y2025", report_year: 2025 }));
    store.insert(row({ id: "y2024", report_year: 2024 }));

    const { rows } = await resolveCcrHistory("MI0003520", store);
    expect(rows.map((r) => r.report_year)).toEqual([2025, 2024, 2022]);
  });

  it("excludes supplement / correction editions from the history", async () => {
    const store = new InMemoryStore();
    store.insert(row({ id: "y2024", report_year: 2024, edition: "primary" }));
    store.insert(row({ id: "y2024s", report_year: 2024, edition: "supplement" }));

    const { rows } = await resolveCcrHistory("MI0003520", store);
    expect(rows).toHaveLength(1);
    expect(rows[0].edition).toBe("primary");
  });

  it("soft-fails to an empty history on a lookup error", async () => {
    const store = new InMemoryStore();
    store.lookupErrorForPwsid = "MI0003520";
    const { rows } = await resolveCcrHistory("MI0003520", store);
    expect(rows).toEqual([]);
  });

  it("returns an empty history when no rows exist", async () => {
    const store = new InMemoryStore();
    const { rows } = await resolveCcrHistory("MI0003520", store);
    expect(rows).toEqual([]);
  });
});
