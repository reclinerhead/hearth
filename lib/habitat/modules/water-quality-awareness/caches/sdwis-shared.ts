/**
 * Shared bits used by both SDWIS caches (violations + LCR samples).
 *
 * Both caches are PWSID-keyed collections — they hold many rows per
 * PWSID rather than one — so the "is this fresh?" question can't be
 * answered by looking at the collection's own row timestamps. Instead
 * we maintain a single bookkeeping row per (PWSID, dataset) in
 * hearth.water_system_data_fetches, written atomically alongside the
 * collection upserts.
 *
 * The cache wrappers (caches/violations-cache.ts and
 * caches/lcr-cache.ts) share the dataset-name type, the TTL constant,
 * and the supabase-env helper. Everything else is dataset-specific.
 */

import { createServiceClient } from "@/lib/supabase/service";

/**
 * The dataset values the data_fetches table's CHECK constraint
 * accepts. Adding a new dataset (e.g. 'ccr_extraction' in WQA-3)
 * requires both adding to this union and altering the SQL constraint.
 */
export type SdwisDataset = "violations" | "lcr_samples";

/**
 * Days a per-(PWSID, dataset) fetch row stays valid before the cache
 * refetches from EPA. Quarterly is the natural EPA refresh cadence
 * for compliance and LCR data; 30 days captures the most recent
 * quarter's submission without re-pulling weekly.
 */
export const SDWIS_CACHE_TTL_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Outcome of looking up a freshness row in water_system_data_fetches.
 * Identical shape to the WATER_SYSTEM cache's lookup result so the
 * activity-log narration helpers can re-use a single voice for the
 * cache-hit / cache-miss / lookup-error cases.
 */
export type SdwisCacheLookupResult<TRecord> =
  | {
      kind: "hit";
      records: TRecord[];
      fetchedAt: Date;
      ageDays: number;
      rowCount: number;
      sourceUrl: string;
    }
  | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error" };

/**
 * Storage contract for both SDWIS caches. Soft-fail by convention:
 * lookup returns a miss-with-reason rather than throwing; upsert logs
 * and returns rather than throwing. The cache wrapper relies on
 * those guarantees.
 *
 * The TRecord generic carries the dataset's record shape so consumers
 * can re-hydrate without an `unknown` cast at the call site.
 */
export interface SdwisCacheStore<TRecord> {
  lookup(pwsid: string): Promise<SdwisCacheLookupResult<TRecord>>;
  upsert(input: {
    pwsid: string;
    records: TRecord[];
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<void>;
}

/**
 * Whether the env vars `createServiceClient()` needs are present. Used
 * as an early-return signal so the cache helpers can skip silently in
 * environments that haven't wired up Supabase. Mirrors the equivalent
 * helper in the WATER_SYSTEM cache.
 */
export function supabaseEnvAvailable(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
    typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
  );
}

/**
 * Read the (pwsid, dataset) row from hearth.water_system_data_fetches
 * and return whether the cached collection is fresh, expired, or
 * absent. Pure I/O — does not read the collection table. The caller
 * does the second SELECT on the collection only when this returns
 * "fresh".
 *
 * Exported for the wrapper modules. Soft-fail: any error becomes a
 * miss with a "lookup-error" reason so the caller falls back to EPA.
 */
export async function lookupFreshness(
  pwsid: string,
  dataset: SdwisDataset,
): Promise<
  | {
      kind: "fresh";
      fetchedAt: Date;
      ageDays: number;
      rowCount: number;
      sourceUrl: string;
    }
  | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error" }
> {
  if (!supabaseEnvAvailable()) {
    return { kind: "miss", reason: "lookup-error" };
  }
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("water_system_data_fetches")
      .select("fetched_at, row_count, source_url")
      .eq("pwsid", pwsid)
      .eq("dataset", dataset)
      .maybeSingle();
    if (error) {
      console.warn(
        `[${dataset}-cache] freshness lookup error, treating as miss:`,
        error.message,
      );
      return { kind: "miss", reason: "lookup-error" };
    }
    if (!data) return { kind: "miss", reason: "no-row" };
    const fetchedAt = new Date(data.fetched_at as string);
    const ageMs = Date.now() - fetchedAt.getTime();
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    if (ageMs > SDWIS_CACHE_TTL_DAYS * MS_PER_DAY) {
      return { kind: "miss", reason: "expired" };
    }
    return {
      kind: "fresh",
      fetchedAt,
      ageDays,
      rowCount: typeof data.row_count === "number" ? data.row_count : 0,
      sourceUrl: typeof data.source_url === "string" ? data.source_url : "",
    };
  } catch (err) {
    console.warn(
      `[${dataset}-cache] freshness lookup threw, treating as miss:`,
      err instanceof Error ? err.message : err,
    );
    return { kind: "miss", reason: "lookup-error" };
  }
}

/**
 * Dedupe an array by a string key extracted from each item, preserving
 * the last occurrence of each key. EPA's SDWIS endpoints occasionally
 * return multiple rows for the same `(pwsid, violation_id)` or
 * `(pwsid, sample_id)` — amended records, multi-period entries, etc.
 * A batched Postgres UPSERT that contains a duplicate conflict key
 * fails with "ON CONFLICT DO UPDATE command cannot affect row a
 * second time", so we dedupe in app code before sending.
 *
 * Last-write-wins is fine: the duplicate rows share their conflict
 * key, so the data they'd upsert to is largely the same anyway.
 *
 * Exported for the test suite.
 */
export function dedupeByKey<T>(
  items: T[],
  keyOf: (item: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(keyOf(item), item);
  }
  return Array.from(map.values());
}

/**
 * Upsert a fetch-bookkeeping row in water_system_data_fetches. Always
 * runs alongside a collection-table upsert (or alongside the
 * "EPA returned zero rows" no-op) so the cache layer can distinguish
 * "fetched and got nothing" from "never fetched".
 *
 * Soft-fail: every error path logs and returns rather than throwing.
 * Exported for the wrapper modules.
 */
export async function upsertFreshness(input: {
  pwsid: string;
  dataset: SdwisDataset;
  rowCount: number;
  sourceUrl: string;
}): Promise<void> {
  if (!supabaseEnvAvailable()) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("water_system_data_fetches")
      .upsert(
        {
          pwsid: input.pwsid,
          dataset: input.dataset,
          row_count: input.rowCount,
          source_url: input.sourceUrl,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "pwsid,dataset" },
      );
    if (error) {
      console.warn(
        `[${input.dataset}-cache] freshness upsert error:`,
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      `[${input.dataset}-cache] freshness upsert threw:`,
      err instanceof Error ? err.message : err,
    );
  }
}
