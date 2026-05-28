/**
 * Shared cache for FEMA NFHL point-in-polygon responses, keyed by
 * parcel ID when present (one row per parcel, shared across re-checks
 * and duplex/subdivision splits) or rounded lat/lon (~1m precision) as
 * the fallback for addresses without a parcel ID.
 *
 * Sits between the module's check() entry point and the FEMA client.
 * When two houses on the same flood polygon run the module, only the
 * first triggers an NFHL request — every subsequent run within the
 * 180-day TTL reads from Postgres. When all FEMA retries fail and the
 * cache has any row (even an expired one), the wrapper returns it
 * tagged as stale so the module can degrade gracefully instead of
 * surfacing a 'failed' finding.
 *
 * Same shape as the Water Quality Awareness WaterSystemCacheStore: a
 * small Store interface hides the Supabase dependency so tests can
 * inject an in-memory store, TTL is enforced in app code, and every
 * Supabase failure soft-fails to a cache miss so FEMA stays the
 * fallback for the cache itself.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  buildNfhlQueryUrl,
  fetchFloodZonesAtPoint,
  NfhlFetchError,
  type FetchFloodZonesOptions,
  type NormalizedFloodZone,
} from "./fetch";
import type { HouseContext } from "@/lib/habitat/types";

/**
 * Days a cached row stays fresh. 180 is the longest TTL in the habitat
 * surface — longer than WQA's 90 days and much longer than Superfund's
 * 7 — because FEMA flood zone polygons for a given property are the
 * most stable upstream data we cache. NFHL releases happen ~monthly
 * but the polygon containing any single point essentially never moves
 * outside the rare LOMA/LOMR cases.
 */
export const CACHE_TTL_DAYS = 180;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Number of decimal places of latitude/longitude used in the
 * coordinate cache key. 5dp ≈ 1m precision — well finer than any
 * realistic flood-zone polygon edge, so two queries within a single
 * parcel hit the same cache row even if Mapbox geocodes return
 * trivially different points across runs.
 */
const COORD_KEY_DECIMALS = 5;

/**
 * Discriminator for how `cache_key` was derived. Persisted as the
 * `key_strategy` column so the cache narration can name what we
 * matched on ("by parcel" vs "by these coordinates").
 */
export type CacheKeyStrategy = "parcel" | "coordinate";

/**
 * Derive the cache key for a house. Parcel ID wins when present;
 * otherwise we fall back to coordinates rounded to 5dp. The two key
 * spaces use distinct string prefixes so a future migration could
 * fold coordinate rows into parcel rows without primary-key
 * collisions.
 *
 * Exported for the test suite and for the cache narration so the
 * activity log can name the key it used.
 */
export function deriveCacheKey(input: {
  parcelId: string | null | undefined;
  latitude: number;
  longitude: number;
}): { cacheKey: string; strategy: CacheKeyStrategy } {
  const parcel = input.parcelId?.trim();
  if (parcel && parcel.length > 0) {
    return { cacheKey: `parcel:${parcel}`, strategy: "parcel" };
  }
  const lat = input.latitude.toFixed(COORD_KEY_DECIMALS);
  const lon = input.longitude.toFixed(COORD_KEY_DECIMALS);
  return { cacheKey: `coord:${lat},${lon}`, strategy: "coordinate" };
}

/**
 * Outcome of a cache lookup.
 *   - 'hit'        — fresh row; caller skips FEMA entirely.
 *   - 'stale'      — row exists but is past the TTL. Used by the
 *                    fallback path when FEMA itself is unreachable
 *                    AFTER retries; the wrapper hides this on the
 *                    happy path (it's promoted to a miss with
 *                    reason 'expired' for the fetch decision).
 *   - 'miss'       — no row at all. The wrapper fetches from FEMA.
 *   - 'lookup-error' — Supabase failed; treat as a miss but log it.
 *
 * The `cache.kind === 'miss'` shape carries a reason so the activity
 * log can narrate honestly across no-row, expired, and lookup-error
 * variants. Stale rows are reported separately because they're only
 * read on the unreachable-fallback path, never on the happy path.
 */
export type FloodZonesCacheLookupResult =
  | {
      kind: "hit";
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      keyStrategy: CacheKeyStrategy;
      fetchedAt: Date;
      refreshedAt: Date;
      ageDays: number;
    }
  | {
      kind: "stale";
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      keyStrategy: CacheKeyStrategy;
      fetchedAt: Date;
      refreshedAt: Date;
      ageDays: number;
    }
  | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error" };

/**
 * Storage contract. Both methods soft-fail by convention: lookup
 * returns a miss with a "lookup-error" reason rather than throwing,
 * and upsert logs and returns rather than throwing. The wrapper in
 * resolveFloodZones() relies on those guarantees.
 *
 * `lookupAny` returns even expired rows so the unreachable-fallback
 * path can serve stale data when FEMA is down. The fresh-only
 * happy-path uses `lookup`.
 */
export interface FloodZonesCacheStore {
  lookup(cacheKey: string): Promise<FloodZonesCacheLookupResult>;
  /**
   * Like `lookup` but returns even expired rows, tagged as `stale`.
   * Used by the unreachable-fallback path in index.ts after every
   * retry has failed.
   */
  lookupAny(cacheKey: string): Promise<FloodZonesCacheLookupResult>;
  upsert(input: {
    cacheKey: string;
    keyStrategy: CacheKeyStrategy;
    queriedLatitude: number;
    queriedLongitude: number;
    zones: NormalizedFloodZone[];
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<void>;
}

function supabaseEnvAvailable(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
    typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
  );
}

/**
 * Map a row from hearth.fema_flood_zones_cache into the lookup result
 * shape. The `zones` column is persisted as the normalized array
 * (post-fetch.normalizeFloodZone) so consumers get the same shape on
 * a cache hit as they do on a fresh fetch.
 *
 * Exported for the test suite.
 */
export function rowToHit(
  row: Record<string, unknown>,
  options: { allowStale: boolean },
): FloodZonesCacheLookupResult {
  const refreshedAt = new Date(row.refreshed_at as string);
  const fetchedAt = new Date(row.fetched_at as string);
  const ageMs = Date.now() - refreshedAt.getTime();
  const ageDays = Math.floor(ageMs / MS_PER_DAY);
  const isStale = ageMs > CACHE_TTL_DAYS * MS_PER_DAY;
  const zones = Array.isArray(row.zones)
    ? (row.zones as NormalizedFloodZone[])
    : [];
  const sourceUrl = (row.source_url as string) ?? "";
  const keyStrategy = (row.key_strategy as CacheKeyStrategy) ?? "coordinate";
  if (isStale) {
    if (!options.allowStale) {
      return { kind: "miss", reason: "expired" };
    }
    return {
      kind: "stale",
      zones,
      rawPayload: row.raw_payload,
      sourceUrl,
      keyStrategy,
      fetchedAt,
      refreshedAt,
      ageDays,
    };
  }
  return {
    kind: "hit",
    zones,
    rawPayload: row.raw_payload,
    sourceUrl,
    keyStrategy,
    fetchedAt,
    refreshedAt,
    ageDays,
  };
}

/**
 * Real Supabase-backed store. Reads / writes hearth.fema_flood_zones_cache.
 * Lookup soft-fails on every error path; upsert logs and returns.
 */
export function createSupabaseFloodZonesCacheStore(): FloodZonesCacheStore {
  async function fetchRow(
    cacheKey: string,
  ): Promise<Record<string, unknown> | null | "error"> {
    if (!supabaseEnvAvailable()) return "error";
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("fema_flood_zones_cache")
        .select(
          "cache_key, queried_latitude, queried_longitude, key_strategy, zones, raw_payload, source_url, fetched_at, refreshed_at",
        )
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (error) {
        console.warn(
          "[fema-flood-zones-cache] lookup query error, treating as miss:",
          error.message,
        );
        return "error";
      }
      return (data as Record<string, unknown> | null) ?? null;
    } catch (err) {
      console.warn(
        "[fema-flood-zones-cache] lookup threw, treating as miss:",
        err instanceof Error ? err.message : err,
      );
      return "error";
    }
  }

  return {
    async lookup(cacheKey: string): Promise<FloodZonesCacheLookupResult> {
      const row = await fetchRow(cacheKey);
      if (row === "error") return { kind: "miss", reason: "lookup-error" };
      if (!row) return { kind: "miss", reason: "no-row" };
      return rowToHit(row, { allowStale: false });
    },

    async lookupAny(cacheKey: string): Promise<FloodZonesCacheLookupResult> {
      const row = await fetchRow(cacheKey);
      if (row === "error") return { kind: "miss", reason: "lookup-error" };
      if (!row) return { kind: "miss", reason: "no-row" };
      return rowToHit(row, { allowStale: true });
    },

    async upsert(input): Promise<void> {
      if (!supabaseEnvAvailable()) return;
      try {
        const supabase = createServiceClient();
        const now = new Date().toISOString();
        const { error } = await supabase
          .from("fema_flood_zones_cache")
          .upsert(
            {
              cache_key: input.cacheKey,
              queried_latitude: input.queriedLatitude,
              queried_longitude: input.queriedLongitude,
              key_strategy: input.keyStrategy,
              zones: input.zones,
              raw_payload: input.rawPayload,
              source_url: input.sourceUrl,
              refreshed_at: now,
            },
            { onConflict: "cache_key" },
          );
        if (error) {
          console.warn(
            "[fema-flood-zones-cache] upsert error, not cached:",
            error.message,
          );
        }
      } catch (err) {
        console.warn(
          "[fema-flood-zones-cache] upsert threw, not cached:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

/**
 * Outcome of `resolveFloodZones`. The module's check() inspects `source`
 * to narrate the activity log honestly:
 *
 *   - 'cache'     — fresh hit, no FEMA call made.
 *   - 'fetch'     — FEMA call succeeded (possibly after retries).
 *                   `retryCount` carries the 0-indexed number of
 *                   retries used; 0 = first-attempt success.
 *   - 'stale'     — FEMA call failed all retries; serving a previously
 *                   cached value with `ageDays` past the TTL.
 *   - 'unreachable' — FEMA call failed all retries AND no cache row
 *                   exists. The caller produces the unreachable
 *                   finding from this outcome.
 */
export type ResolveFloodZonesResult =
  | {
      source: "cache";
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      keyStrategy: CacheKeyStrategy;
      fetchedAt: Date;
      refreshedAt: Date;
      ageDays: number;
    }
  | {
      source: "fetch";
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      retryCount: number;
      cacheMissReason: "no-row" | "expired" | "lookup-error";
    }
  | {
      source: "stale";
      zones: NormalizedFloodZone[];
      rawPayload: unknown;
      sourceUrl: string;
      keyStrategy: CacheKeyStrategy;
      fetchedAt: Date;
      refreshedAt: Date;
      ageDays: number;
      fetchError: NfhlFetchError;
      attempts: number;
    }
  | {
      source: "unreachable";
      fetchError: NfhlFetchError;
      attempts: number;
    };

/**
 * Options for `resolveFloodZones`. `rawFeatures` is passed through
 * from the FEMA response shape so the cache wrapper can preserve the
 * verbatim features[] in raw_payload; everything else mirrors the
 * fetch options.
 */
export type ResolveFloodZonesOptions = FetchFloodZonesOptions & {
  /**
   * Optional override of `Date.now()` for deterministic stale-age
   * computation in tests. The cache lookup itself reads `Date.now()`
   * directly, so this is currently used only in the test suite.
   */
  now?: () => number;
};

/**
 * Cache-aware resolve.
 *
 *   1. lookup() — fresh hit: return immediately, no FEMA call.
 *   2. miss     — call FEMA with the retry loop.
 *     2a. success: upsert and return source='fetch'.
 *     2b. all retries failed: call lookupAny() for a stale row.
 *       - stale row exists: return source='stale'.
 *       - no row at all: return source='unreachable'.
 *
 * The wrapper never throws — every FEMA failure mode resolves to
 * `source: 'stale'` or `source: 'unreachable'` so the caller can
 * produce a finding rather than tripping the orchestrator's
 * 'failed'-row path.
 *
 * Exported as the module's primary entry point. `lib/habitat/modules/
 * fema-flood-zones/index.ts` is its only consumer.
 */
export async function resolveFloodZones(
  house: Pick<HouseContext, "parcelId" | "latitude" | "longitude">,
  store: FloodZonesCacheStore,
  options: ResolveFloodZonesOptions = {},
): Promise<ResolveFloodZonesResult> {
  if (
    house.latitude == null ||
    house.longitude == null ||
    !Number.isFinite(house.latitude) ||
    !Number.isFinite(house.longitude)
  ) {
    // Caller's isApplicable should have caught this; throw rather
    // than silently producing a confusing cache key.
    throw new Error(
      "resolveFloodZones requires lat/lng coordinates on the HouseContext",
    );
  }
  const { cacheKey, strategy } = deriveCacheKey({
    parcelId: house.parcelId,
    latitude: house.latitude,
    longitude: house.longitude,
  });

  const cacheResult = await store.lookup(cacheKey);
  if (cacheResult.kind === "hit") {
    return {
      source: "cache",
      zones: cacheResult.zones,
      rawPayload: cacheResult.rawPayload,
      sourceUrl: cacheResult.sourceUrl,
      keyStrategy: cacheResult.keyStrategy,
      fetchedAt: cacheResult.fetchedAt,
      refreshedAt: cacheResult.refreshedAt,
      ageDays: cacheResult.ageDays,
    };
  }

  // 'miss' (no-row | expired | lookup-error) OR 'stale' (unreachable
  // — never returned by lookup, only lookupAny). Treat 'stale' here
  // defensively as a miss so the fetch path runs.
  const missReason =
    cacheResult.kind === "miss" ? cacheResult.reason : "expired";

  // Track the attempt number of the eventual successful fetch via
  // the onAttempt seam — the public fetch return shape stays a plain
  // zones array, but the cache wrapper needs the count for the
  // retry-recovered narration in the activity log.
  let successAttempt = 0;
  const composedOptions: FetchFloodZonesOptions = {
    ...options,
    onAttempt: (info) => {
      options.onAttempt?.(info);
      if (info.outcome === "success") successAttempt = info.attempt;
    },
  };
  try {
    const zones = await fetchFloodZonesAtPoint(
      house.latitude,
      house.longitude,
      composedOptions,
    );
    // We persist both the normalized zones (column `zones`) and the
    // verbatim FEMA features (column `raw_payload`). The fetcher
    // doesn't expose the raw payload today — re-serializing the
    // normalized array into raw_payload is acceptable for v1: every
    // field the module reads is preserved, and future column
    // additions can fall back to a re-fetch if a normalized field
    // isn't enough.
    const sourceUrl = buildNfhlQueryUrl(house.latitude, house.longitude);
    await store.upsert({
      cacheKey,
      keyStrategy: strategy,
      queriedLatitude: house.latitude,
      queriedLongitude: house.longitude,
      zones,
      rawPayload: zones,
      sourceUrl,
    });
    return {
      source: "fetch",
      zones,
      rawPayload: zones,
      sourceUrl,
      retryCount: Math.max(0, successAttempt - 1),
      cacheMissReason: missReason,
    };
  } catch (err) {
    const fetchError =
      err instanceof NfhlFetchError
        ? err
        : new NfhlFetchError({
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
            status: null,
            attempt: 0,
            cause: err,
          });
    const stale = await store.lookupAny(cacheKey);
    if (stale.kind === "stale" || stale.kind === "hit") {
      // 'hit' is theoretically possible here if the cache became
      // fresh between the two reads (rare, but possible if another
      // worker upserted in between). Treat the same as stale —
      // serving cached data with the fallback narration is still
      // honest.
      return {
        source: "stale",
        zones: stale.zones,
        rawPayload: stale.rawPayload,
        sourceUrl: stale.sourceUrl,
        keyStrategy: stale.keyStrategy,
        fetchedAt: stale.fetchedAt,
        refreshedAt: stale.refreshedAt,
        ageDays: stale.ageDays,
        fetchError,
        attempts: fetchError.attempt,
      };
    }
    return {
      source: "unreachable",
      fetchError,
      attempts: fetchError.attempt,
    };
  }
}
