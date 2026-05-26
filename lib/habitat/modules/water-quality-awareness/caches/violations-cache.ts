/**
 * Shared cache for EPA SDWIS VIOLATION rows, keyed by (PWSID,
 * violation_id) in hearth.water_system_violations with per-PWSID
 * freshness tracked in hearth.water_system_data_fetches.
 *
 * Same wrapper shape as the WATER_SYSTEM cache — a small Store
 * interface, app-code-enforced 30-day TTL, soft-fail at every step so
 * Supabase outages degrade to a cache miss and the EPA endpoint stays
 * the fallback.
 *
 * The cache holds a collection (many rows per PWSID), so freshness
 * can't be inferred from row timestamps the way water_systems can —
 * a system with zero violations is a legitimate cache hit and the
 * collection table has nothing to read. The accompanying
 * water_system_data_fetches table is the authoritative freshness
 * signal; the collection is just the data.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchViolations,
  type FetchViolationsOptions,
  type SdwisViolationRecord,
} from "../sources/sdwis-violations";
import {
  dedupeByKey,
  lookupFreshness,
  supabaseEnvAvailable,
  upsertFreshness,
  type SdwisCacheLookupResult,
  type SdwisCacheStore,
} from "./sdwis-shared";

export type ViolationsCacheLookupResult =
  SdwisCacheLookupResult<SdwisViolationRecord>;

export type ViolationsCacheStore = SdwisCacheStore<SdwisViolationRecord>;

/**
 * Map a row from hearth.water_system_violations back to the
 * SdwisViolationRecord shape consumers read. Exported for the test
 * suite. The persisted columns are a subset of the EPA response and
 * raw_payload preserves the rest; consumers that touch raw_payload
 * read it through this row directly, not through the rehydrated
 * record.
 */
export function rowToViolation(
  row: Record<string, unknown>,
): SdwisViolationRecord {
  const pwsid = row.pwsid;
  const violation_id = row.violation_id;
  if (typeof pwsid !== "string" || typeof violation_id !== "string") {
    throw new Error(
      "water_system_violations row is missing pwsid or violation_id",
    );
  }
  const out: SdwisViolationRecord = { pwsid, violation_id };
  const stringKeys: Array<keyof SdwisViolationRecord> = [
    "violation_code",
    "violation_category_code",
    "is_health_based_ind",
    "contaminant_code",
    "compl_per_begin_date",
    "compl_per_end_date",
    "viol_first_reported_date",
    "rtc_date",
    "is_major_viol_ind",
    "unit_of_measure",
    "federal_mcl",
  ];
  for (const key of stringKeys) {
    const value = row[key as string];
    if (typeof value === "string") {
      (out as Record<string, unknown>)[key] = value;
    } else if (value === null) {
      (out as Record<string, unknown>)[key] = null;
    }
  }
  if (typeof row.viol_measure === "number") {
    out.viol_measure = row.viol_measure;
  } else if (row.viol_measure === null) {
    out.viol_measure = null;
  } else if (typeof row.viol_measure === "string") {
    const parsed = Number(row.viol_measure);
    out.viol_measure = Number.isFinite(parsed) ? parsed : null;
  }
  return out;
}

/**
 * Build a row for hearth.water_system_violations. Exported for tests.
 */
export function buildViolationsRow(input: {
  record: SdwisViolationRecord;
  rawRow: unknown;
  sourceUrl: string;
}): Record<string, unknown> {
  const { record, rawRow, sourceUrl } = input;
  const now = new Date().toISOString();
  return {
    pwsid: record.pwsid,
    violation_id: record.violation_id,
    violation_code: record.violation_code ?? null,
    violation_category_code: record.violation_category_code ?? null,
    is_health_based_ind: record.is_health_based_ind ?? null,
    contaminant_code: record.contaminant_code ?? null,
    compl_per_begin_date: record.compl_per_begin_date ?? null,
    compl_per_end_date: record.compl_per_end_date ?? null,
    viol_first_reported_date: record.viol_first_reported_date ?? null,
    rtc_date: record.rtc_date ?? null,
    is_major_viol_ind: record.is_major_viol_ind ?? null,
    viol_measure: record.viol_measure ?? null,
    unit_of_measure: record.unit_of_measure ?? null,
    federal_mcl: record.federal_mcl ?? null,
    refreshed_at: now,
    source_url: sourceUrl,
    raw_payload: rawRow,
  };
}

/**
 * Supabase-backed store for the violations cache. Reads / writes both
 * hearth.water_system_violations (the collection) and
 * hearth.water_system_data_fetches (freshness bookkeeping) on
 * upserts. Lookups check freshness first; the collection is only
 * SELECTed on a fresh hit.
 *
 * Soft-fail discipline matches the WATER_SYSTEM cache exactly — any
 * Supabase error becomes a cache miss with a "lookup-error" reason,
 * and the EPA fetch + upsert path runs.
 */
export function createSupabaseViolationsCacheStore(): ViolationsCacheStore {
  return {
    async lookup(pwsid: string): Promise<ViolationsCacheLookupResult> {
      const normalized = pwsid.trim().toUpperCase();
      const freshness = await lookupFreshness(normalized, "violations");
      if (freshness.kind !== "fresh") return freshness;
      if (!supabaseEnvAvailable()) {
        return { kind: "miss", reason: "lookup-error" };
      }
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("water_system_violations")
          .select("*")
          .eq("pwsid", normalized);
        if (error) {
          console.warn(
            "[violations-cache] collection select error, treating as miss:",
            error.message,
          );
          return { kind: "miss", reason: "lookup-error" };
        }
        const records = (data ?? []).map((row) =>
          rowToViolation(row as Record<string, unknown>),
        );
        // Defensive: the freshness row and the collection table can
        // desync — see the matching block in lcr-cache.ts for the
        // full rationale. When freshness says "we have rows" but the
        // collection is empty, treat as expired so the next fetch
        // refreshes both.
        if (freshness.rowCount > 0 && records.length === 0) {
          console.warn(
            "[violations-cache] desync detected: freshness row reports " +
              `${freshness.rowCount} rows but collection has 0 — treating as expired`,
          );
          return { kind: "miss", reason: "expired" };
        }
        return {
          kind: "hit",
          records,
          fetchedAt: freshness.fetchedAt,
          ageDays: freshness.ageDays,
          rowCount: freshness.rowCount,
          sourceUrl: freshness.sourceUrl,
        };
      } catch (err) {
        console.warn(
          "[violations-cache] collection select threw, treating as miss:",
          err instanceof Error ? err.message : err,
        );
        return { kind: "miss", reason: "lookup-error" };
      }
    },

    async upsert(input): Promise<void> {
      if (!supabaseEnvAvailable()) return;
      const pwsid = input.pwsid.trim().toUpperCase();
      try {
        const supabase = createServiceClient();
        // Always update the freshness row, even when the collection
        // is empty — that's how we distinguish "fetched and EPA
        // returned zero" from "never fetched".
        await upsertFreshness({
          pwsid,
          dataset: "violations",
          rowCount: input.records.length,
          sourceUrl: input.sourceUrl,
        });
        if (input.records.length === 0) return;
        // Each record carries its own raw row from the EPA response.
        // The raw_payload column on each row mirrors that single
        // record's worth of data, which is what consumers expect when
        // reading via rowToViolation.
        const rawRows = Array.isArray(input.rawPayload) ? input.rawPayload : [];
        // Dedupe by the upsert conflict key before sending to
        // Postgres. EPA's VIOLATION endpoint sometimes returns
        // multiple rows with the same (pwsid, violation_id) — an
        // amended violation, a multi-period record surfaced more than
        // once, etc. See `dedupeByKey` in sdwis-shared.ts for the
        // full rationale.
        const deduped = dedupeByKey(
          input.records.map((record, i) => ({
            record,
            rawRow: rawRows[i] ?? record,
          })),
          ({ record }) => `${record.pwsid}|${record.violation_id}`,
        );
        const rows = deduped.map(({ record, rawRow }) =>
          buildViolationsRow({ record, rawRow, sourceUrl: input.sourceUrl }),
        );
        const { error } = await supabase
          .from("water_system_violations")
          .upsert(rows, { onConflict: "pwsid,violation_id" });
        if (error) {
          console.warn(
            "[violations-cache] collection upsert error:",
            error.message,
          );
        }
      } catch (err) {
        console.warn(
          "[violations-cache] upsert threw:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

/**
 * Cache-aware resolve for SDWIS violations.
 *
 * Returns the records, the raw payload (for diagnostics), the source
 * URL, and the cache outcome so the activity log can narrate honestly
 * across hit / first-fetch / expired / lookup-error cases.
 *
 * Throws on EPA-side failures (network / 5xx / parse). The caller
 * wraps in try/catch to implement the soft-fail at the module level
 * — compliance_status_short stays "unknown" when violations are
 * unavailable rather than aborting the whole finding.
 */
export async function resolveViolations(
  pwsid: string,
  store: ViolationsCacheStore,
  options: FetchViolationsOptions = {},
): Promise<{
  records: SdwisViolationRecord[];
  rawPayload: unknown;
  sourceUrl: string;
  cache: ViolationsCacheLookupResult;
}> {
  const normalized = pwsid.trim().toUpperCase();
  const cache = await store.lookup(normalized);
  if (cache.kind === "hit") {
    return {
      records: cache.records,
      rawPayload: cache.records, // re-serialized; raw_payload is on the rows themselves
      sourceUrl: cache.sourceUrl,
      cache,
    };
  }
  const { records, rawPayload, sourceUrl } = await fetchViolations(
    normalized,
    options,
  );
  await store.upsert({ pwsid: normalized, records, rawPayload, sourceUrl });
  return { records, rawPayload, sourceUrl, cache };
}
