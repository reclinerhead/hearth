/**
 * Shared cache for EPA Envirofacts WATER_SYSTEM records, keyed by PWSID
 * in hearth.water_systems.
 *
 * Sits between the module's check() entry point and the Envirofacts
 * client. When two houses on the same utility run the module, only the
 * first triggers an EPA fetch — every subsequent run within the
 * 90-day TTL window reads the row from Postgres.
 *
 * Same shape as the Superfund module's per-state cache
 * (lib/habitat/modules/epa-superfund-proximity/cache.ts): a small
 * Store interface hides the Supabase dependency so tests can inject
 * an in-memory or no-op store, TTL is enforced in app code rather
 * than in SQL, and every Supabase failure soft-fails to a cache miss
 * so EPA stays the fallback.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchWaterSystem,
  type EnvirofactsWaterSystemRecord,
  type FetchWaterSystemOptions,
} from "./sources/envirofacts";

/**
 * Days a cached water_systems row stays valid before the module
 * re-fetches from EPA. The WATER_SYSTEM inventory changes slowly —
 * admin contact swaps and ownership changes are the most volatile
 * fields, and even those rarely move inside a quarter. The issue
 * notes the 90-day window is a starting point we can tune later
 * once we observe real refresh cadence.
 */
export const CACHE_TTL_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Outcome of a cache lookup. Hit means the row is fresh enough to use
 * verbatim and the caller skips the Envirofacts fetch entirely. Miss
 * carries a reason so the activity log can narrate honestly — "no row
 * yet" reads differently from "we had one but it expired", and a
 * lookup error reads differently from either.
 */
export type WaterSystemCacheLookupResult =
  | {
      kind: "hit";
      record: EnvirofactsWaterSystemRecord;
      rawPayload: unknown;
      sourceUrl: string;
      fetchedAt: Date;
      refreshedAt: Date;
      ageDays: number;
    }
  | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error" };

/**
 * Storage contract. Both methods soft-fail by convention: lookup
 * returns a miss with a "lookup-error" reason rather than throwing,
 * and upsert logs and returns rather than throwing. The wrapper in
 * resolveWaterSystem() relies on those guarantees.
 */
export interface WaterSystemCacheStore {
  lookup(pwsid: string): Promise<WaterSystemCacheLookupResult>;
  upsert(input: {
    record: EnvirofactsWaterSystemRecord;
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
 * Map a row from hearth.water_systems back to the
 * EnvirofactsWaterSystemRecord shape the rest of the module consumes.
 * Exported for the test suite.
 *
 * The persisted columns are a subset of the Envirofacts response (the
 * raw_payload column carries the full original). Re-hydrating from
 * the parsed columns rather than the raw_payload means a cache hit
 * gets exactly what the module wrote, even if EPA reorganizes their
 * payload between fetches.
 */
export function rowToRecord(
  row: Record<string, unknown>,
): EnvirofactsWaterSystemRecord {
  const pwsid = row.pwsid;
  const pws_name = row.pws_name;
  const pws_activity_code = row.pws_activity_code;
  const pws_type_code = row.pws_type_code;
  if (
    typeof pwsid !== "string" ||
    typeof pws_name !== "string" ||
    typeof pws_activity_code !== "string" ||
    typeof pws_type_code !== "string"
  ) {
    throw new Error(
      "water_systems row is missing one of the required fields (pwsid, pws_name, pws_activity_code, pws_type_code)",
    );
  }
  const out: EnvirofactsWaterSystemRecord = {
    pwsid,
    pws_name,
    pws_activity_code,
    pws_type_code,
  };
  // Pass-through optional fields — TypeScript doesn't help here, but
  // the persisted columns mirror the type one-for-one.
  const optionalStringKeys: Array<keyof EnvirofactsWaterSystemRecord> = [
    "primacy_agency_code",
    "epa_region",
    "pws_deactivation_date",
    "gw_sw_code",
    "primary_source_code",
    "owner_type_code",
    "is_school_or_daycare_ind",
    "submission_status_code",
    "org_name",
    "admin_name",
    "email_addr",
    "phone_number",
    "address_line1",
    "address_line2",
    "city_name",
    "zip_code",
    "state_code",
    "source_water_protection_code",
    "source_protection_begin_date",
  ];
  for (const key of optionalStringKeys) {
    const value = row[key as string];
    if (typeof value === "string") {
      (out as Record<string, unknown>)[key] = value;
    } else if (value === null) {
      (out as Record<string, unknown>)[key] = null;
    }
  }
  if (typeof row.population_served_count === "number") {
    out.population_served_count = row.population_served_count;
  } else if (row.population_served_count === null) {
    out.population_served_count = null;
  }
  if (typeof row.service_connections_count === "number") {
    out.service_connections_count = row.service_connections_count;
  } else if (row.service_connections_count === null) {
    out.service_connections_count = null;
  }
  return out;
}

/**
 * Real Supabase-backed store. Reads / writes hearth.water_systems.
 * Lookup soft-fails on every error path; upsert logs and returns.
 */
export function createSupabaseWaterSystemCacheStore(): WaterSystemCacheStore {
  return {
    async lookup(pwsid: string): Promise<WaterSystemCacheLookupResult> {
      if (!supabaseEnvAvailable()) {
        return { kind: "miss", reason: "lookup-error" };
      }
      const normalized = pwsid.trim().toUpperCase();
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("water_systems")
          .select("*, raw_payload, source_url, fetched_at, refreshed_at")
          .eq("pwsid", normalized)
          .maybeSingle();
        if (error) {
          console.warn(
            "[water-systems-cache] lookup query error, treating as miss:",
            error.message,
          );
          return { kind: "miss", reason: "lookup-error" };
        }
        if (!data) {
          return { kind: "miss", reason: "no-row" };
        }
        const refreshedAt = new Date(data.refreshed_at as string);
        const fetchedAt = new Date(data.fetched_at as string);
        const ageMs = Date.now() - refreshedAt.getTime();
        const ageDays = Math.floor(ageMs / MS_PER_DAY);
        if (ageMs > CACHE_TTL_DAYS * MS_PER_DAY) {
          return { kind: "miss", reason: "expired" };
        }
        return {
          kind: "hit",
          record: rowToRecord(data as Record<string, unknown>),
          rawPayload: data.raw_payload,
          sourceUrl: (data.source_url as string) ?? "",
          fetchedAt,
          refreshedAt,
          ageDays,
        };
      } catch (err) {
        console.warn(
          "[water-systems-cache] lookup threw, treating as miss:",
          err instanceof Error ? err.message : err,
        );
        return { kind: "miss", reason: "lookup-error" };
      }
    },

    async upsert(input): Promise<void> {
      if (!supabaseEnvAvailable()) return;
      try {
        const supabase = createServiceClient();
        const row = buildWaterSystemsRow(input);
        const { error } = await supabase
          .from("water_systems")
          .upsert(row, { onConflict: "pwsid" });
        if (error) {
          console.warn(
            "[water-systems-cache] upsert error, not cached:",
            error.message,
          );
        }
      } catch (err) {
        console.warn(
          "[water-systems-cache] upsert threw, not cached:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

/**
 * Project an Envirofacts record onto the column shape hearth.water_systems
 * expects. refreshed_at is always set to now() — every upsert is a fresh
 * cache write — and fetched_at is left to the column default on insert
 * (it preserves itself on update via excluded.* exclusion below).
 *
 * Exported for the test suite.
 */
export function buildWaterSystemsRow(input: {
  record: EnvirofactsWaterSystemRecord;
  rawPayload: unknown;
  sourceUrl: string;
}): Record<string, unknown> {
  const { record, rawPayload, sourceUrl } = input;
  const now = new Date().toISOString();
  return {
    pwsid: record.pwsid,
    pws_name: record.pws_name,
    primacy_agency_code: record.primacy_agency_code ?? null,
    epa_region: record.epa_region ?? null,
    pws_activity_code: record.pws_activity_code,
    pws_deactivation_date: record.pws_deactivation_date ?? null,
    pws_type_code: record.pws_type_code,
    gw_sw_code: record.gw_sw_code ?? null,
    primary_source_code: record.primary_source_code ?? null,
    owner_type_code: record.owner_type_code ?? null,
    population_served_count: record.population_served_count ?? null,
    service_connections_count: record.service_connections_count ?? null,
    is_school_or_daycare_ind: record.is_school_or_daycare_ind ?? null,
    submission_status_code: record.submission_status_code ?? null,
    org_name: record.org_name ?? null,
    admin_name: record.admin_name ?? null,
    email_addr: record.email_addr ?? null,
    phone_number: record.phone_number ?? null,
    address_line1: record.address_line1 ?? null,
    address_line2: record.address_line2 ?? null,
    city_name: record.city_name ?? null,
    zip_code: record.zip_code ?? null,
    state_code: record.state_code ?? null,
    source_water_protection_code: record.source_water_protection_code ?? null,
    source_protection_begin_date: record.source_protection_begin_date ?? null,
    refreshed_at: now,
    source_url: sourceUrl,
    raw_payload: rawPayload,
  };
}

/**
 * Cache-aware resolve: lookup → fetch + upsert on miss.
 *
 * Returns the record plus the cache result so the activity log can
 * narrate honestly (cache hit vs miss-because-expired vs first-fetch
 * vs lookup-error-then-fetch). The fetch-fallback path always upserts
 * — including on the "lookup-error" miss case — so a transient
 * Supabase outage doesn't break long-term cache density.
 *
 * Returns `record: null` when Envirofacts itself has no row for the
 * PWSID. The caller maps that to the 'stale' branch.
 */
export async function resolveWaterSystem(
  pwsid: string,
  store: WaterSystemCacheStore,
  options: FetchWaterSystemOptions = {},
): Promise<{
  record: EnvirofactsWaterSystemRecord | null;
  rawPayload: unknown;
  sourceUrl: string;
  cache: WaterSystemCacheLookupResult;
}> {
  const normalized = pwsid.trim().toUpperCase();
  const cache = await store.lookup(normalized);
  if (cache.kind === "hit") {
    return {
      record: cache.record,
      rawPayload: cache.rawPayload,
      sourceUrl: cache.sourceUrl,
      cache,
    };
  }
  const { record, rawPayload, sourceUrl } = await fetchWaterSystem(
    normalized,
    options,
  );
  if (record !== null) {
    await store.upsert({ record, rawPayload, sourceUrl });
  }
  return { record, rawPayload, sourceUrl, cache };
}
