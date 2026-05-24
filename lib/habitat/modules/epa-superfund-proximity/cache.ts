/**
 * Per-state cache wrapper around fetchNplSitesInState (issue #160).
 *
 * EPA's Envirofacts SEMS endpoint is consistently slow (~20s for a
 * typical state response) and returns the same payload for every
 * user in a given state. Without caching, every neighbor pays the
 * latency cost independently — once two users from MI hit the
 * system, we're spending 40 seconds total to fetch the exact same
 * data twice.
 *
 * This module sits between index.ts (which orchestrates the check)
 * and fetch.ts (which does the raw HTTP). It hides the cache lookup
 * behind a small `EnvirofactsCacheStore` interface so:
 *   - the production path uses Supabase (`hearth.epa_envirofacts_state_cache`)
 *   - tests inject an in-memory or no-op store without monkey-patching
 *     the Supabase client
 *
 * TTL is enforced here, not in the database — the 7-day window is a
 * single constant that's easy to tune. fetch.ts stays pure HTTP and
 * has no Supabase dependency.
 *
 * Soft-fail discipline at every step: a cache lookup error is
 * treated as a miss (we always have the EPA endpoint as a fallback),
 * and an upsert error is logged but never thrown (the current
 * request still gets its data; the next request just won't have a
 * warm cache yet). The cache exists to make Hearth faster, not to
 * become a single point of failure.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchNplSitesInState,
  type FetchNplSitesOptions,
  type NplSite,
} from "./fetch";

/**
 * Days a cached per-state response stays valid before we re-fetch
 * from EPA. The NPL list and per-site statuses change slowly enough
 * that a week-old cached value is functionally identical to a fresh
 * one, and 7 days comfortably covers a weekend of beta testing
 * across multiple neighbors in the same state.
 *
 * Exported so tests and the activity-log narration can read the
 * same constant without copy-paste drift.
 */
export const CACHE_TTL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Outcome of a cache lookup. Hit means we have a fresh-enough
 * cached response and the caller can skip the HTTP fetch entirely.
 * Miss carries a reason so the activity log can narrate honestly
 * — "no row yet" reads differently from "we had one but it
 * expired".
 */
export type CacheLookupResult =
  | {
      kind: "hit";
      sites: NplSite[];
      fetchedAt: Date;
      ageDays: number;
    }
  | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error" };

/**
 * Storage contract for the per-state cache. Two methods, both
 * soft-fail by convention (lookup never throws — it returns a miss
 * with a "lookup-error" reason; upsert never throws — it logs and
 * returns). The wrapper logic in `fetchNplSitesInStateCached`
 * relies on those guarantees.
 */
export interface EnvirofactsCacheStore {
  lookup(stateCode: string): Promise<CacheLookupResult>;
  upsert(stateCode: string, sites: NplSite[]): Promise<void>;
}

/**
 * Returns true when the env vars `createServiceClient()` needs are
 * present. Used as an early-return signal so the cache helpers can
 * skip silently in environments that haven't wired up Supabase
 * (most notably the unit-test runner) — without a noisy console.warn
 * for every call. Real production errors (network, RLS, schema
 * drift) still get logged below.
 */
function supabaseEnvAvailable(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
    typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
  );
}

/**
 * Real Supabase-backed store used at runtime. Reads / writes
 * `hearth.epa_envirofacts_state_cache` (migration
 * 20260524210736_epa_envirofacts_state_cache.sql). All errors are
 * caught and logged — a Supabase outage or a missing env var
 * degrades gracefully to "cache always misses" so EPA still gets
 * hit and the user still sees their finding.
 */
export function createSupabaseEnvirofactsCacheStore(): EnvirofactsCacheStore {
  return {
    async lookup(stateCode: string): Promise<CacheLookupResult> {
      if (!supabaseEnvAvailable()) {
        return { kind: "miss", reason: "lookup-error" };
      }
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("epa_envirofacts_state_cache")
          .select("response_json, fetched_at")
          .eq("state_code", stateCode)
          .maybeSingle();
        if (error) {
          console.warn(
            "[envirofacts-cache] lookup query error, treating as miss:",
            error.message,
          );
          return { kind: "miss", reason: "lookup-error" };
        }
        if (!data) {
          return { kind: "miss", reason: "no-row" };
        }
        const fetchedAt = new Date(data.fetched_at as string);
        const ageMs = Date.now() - fetchedAt.getTime();
        const ageDays = Math.floor(ageMs / MS_PER_DAY);
        if (ageMs > CACHE_TTL_DAYS * MS_PER_DAY) {
          return { kind: "miss", reason: "expired" };
        }
        const sites = data.response_json as NplSite[];
        return { kind: "hit", sites, fetchedAt, ageDays };
      } catch (err) {
        // Most likely cause: env vars unset in a test that didn't
        // wire up Supabase, or a network blip. Treat as a miss so
        // the call proceeds to EPA.
        console.warn(
          "[envirofacts-cache] lookup threw, treating as miss:",
          err instanceof Error ? err.message : err,
        );
        return { kind: "miss", reason: "lookup-error" };
      }
    },

    async upsert(stateCode: string, sites: NplSite[]): Promise<void> {
      if (!supabaseEnvAvailable()) return;
      try {
        const supabase = createServiceClient();
        const { error } = await supabase
          .from("epa_envirofacts_state_cache")
          .upsert(
            {
              state_code: stateCode,
              response_json: sites,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "state_code" },
          );
        if (error) {
          console.warn(
            "[envirofacts-cache] upsert error, not cached:",
            error.message,
          );
        }
      } catch (err) {
        console.warn(
          "[envirofacts-cache] upsert threw, not cached:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

/**
 * Cache-aware fetch wrapper. Returns the fetched (or cached) sites
 * alongside the lookup result so the caller can narrate the
 * outcome in its activity log.
 *
 * On a cache hit: returns immediately without touching EPA.
 * On a cache miss: fetches from EPA via `fetchNplSitesInState`,
 * upserts the response into the cache (fire-and-await — the upsert
 * soft-fails on its own and never throws), returns the fresh sites.
 *
 * The activity log step ordering in index.ts depends on this:
 * step #1 is always the "fetch" beat. On a cache hit the step
 * narration says "I had a cached response..." and we save 20
 * seconds; on a miss the narration is the same as before #160
 * landed.
 */
export async function fetchNplSitesInStateCached(
  state: string,
  store: EnvirofactsCacheStore,
  options: FetchNplSitesOptions = {},
): Promise<{ sites: NplSite[]; cache: CacheLookupResult }> {
  const stateCode = state.trim().toUpperCase();
  const cache = await store.lookup(stateCode);
  if (cache.kind === "hit") {
    return { sites: cache.sites, cache };
  }
  const sites = await fetchNplSitesInState(state, options);
  await store.upsert(stateCode, sites);
  return { sites, cache };
}
