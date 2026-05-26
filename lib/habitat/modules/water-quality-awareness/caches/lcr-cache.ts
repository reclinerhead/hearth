/**
 * Shared cache for EPA SDWIS LCR_SAMPLE_RESULT rows, keyed by
 * (PWSID, sample_id) in hearth.water_system_lcr_samples with per-
 * PWSID freshness tracked in hearth.water_system_data_fetches.
 *
 * Same shape as caches/violations-cache.ts — they're parallel caches,
 * not derived. The choice to keep them separate (rather than abstract
 * over both via a generic "SDWIS table cache") is deliberate: the
 * persisted column lists are entirely different, the upsert conflict
 * keys differ, and the consumer surfaces (compliance.ts vs lcr.ts)
 * want different shapes back. Two parallel files read cleaner than
 * one parametric abstraction.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchLcrSamples,
  type FetchLcrSamplesOptions,
  type SdwisLcrSampleRecord,
} from "../sources/sdwis-lcr-samples";
import {
  lookupFreshness,
  supabaseEnvAvailable,
  upsertFreshness,
  type SdwisCacheLookupResult,
  type SdwisCacheStore,
} from "./sdwis-shared";

export type LcrCacheLookupResult = SdwisCacheLookupResult<SdwisLcrSampleRecord>;

export type LcrCacheStore = SdwisCacheStore<SdwisLcrSampleRecord>;

export function rowToLcrSample(
  row: Record<string, unknown>,
): SdwisLcrSampleRecord {
  const pwsid = row.pwsid;
  const sample_id = row.sample_id;
  if (typeof pwsid !== "string" || typeof sample_id !== "string") {
    throw new Error(
      "water_system_lcr_samples row is missing pwsid or sample_id",
    );
  }
  const out: SdwisLcrSampleRecord = { pwsid, sample_id };
  const stringKeys: Array<keyof SdwisLcrSampleRecord> = [
    "contaminant_code",
    "sampling_start_date",
    "sampling_end_date",
    "unit_of_measure",
    "result_sign_code",
  ];
  for (const key of stringKeys) {
    const value = row[key as string];
    if (typeof value === "string") {
      (out as Record<string, unknown>)[key] = value;
    } else if (value === null) {
      (out as Record<string, unknown>)[key] = null;
    }
  }
  if (typeof row.sample_measure === "number") {
    out.sample_measure = row.sample_measure;
  } else if (row.sample_measure === null) {
    out.sample_measure = null;
  } else if (typeof row.sample_measure === "string") {
    const parsed = Number(row.sample_measure);
    out.sample_measure = Number.isFinite(parsed) ? parsed : null;
  }
  return out;
}

export function buildLcrSampleRow(input: {
  record: SdwisLcrSampleRecord;
  rawRow: unknown;
  sourceUrl: string;
}): Record<string, unknown> {
  const { record, rawRow, sourceUrl } = input;
  const now = new Date().toISOString();
  return {
    pwsid: record.pwsid,
    sample_id: record.sample_id,
    contaminant_code: record.contaminant_code ?? null,
    sampling_start_date: record.sampling_start_date ?? null,
    sampling_end_date: record.sampling_end_date ?? null,
    sample_measure: record.sample_measure ?? null,
    unit_of_measure: record.unit_of_measure ?? null,
    result_sign_code: record.result_sign_code ?? null,
    refreshed_at: now,
    source_url: sourceUrl,
    raw_payload: rawRow,
  };
}

export function createSupabaseLcrCacheStore(): LcrCacheStore {
  return {
    async lookup(pwsid: string): Promise<LcrCacheLookupResult> {
      const normalized = pwsid.trim().toUpperCase();
      const freshness = await lookupFreshness(normalized, "lcr_samples");
      if (freshness.kind !== "fresh") return freshness;
      if (!supabaseEnvAvailable()) {
        return { kind: "miss", reason: "lookup-error" };
      }
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("water_system_lcr_samples")
          .select("*")
          .eq("pwsid", normalized);
        if (error) {
          console.warn(
            "[lcr-cache] collection select error, treating as miss:",
            error.message,
          );
          return { kind: "miss", reason: "lookup-error" };
        }
        const records = (data ?? []).map((row) =>
          rowToLcrSample(row as Record<string, unknown>),
        );
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
          "[lcr-cache] collection select threw, treating as miss:",
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
        await upsertFreshness({
          pwsid,
          dataset: "lcr_samples",
          rowCount: input.records.length,
          sourceUrl: input.sourceUrl,
        });
        if (input.records.length === 0) return;
        const rawRows = Array.isArray(input.rawPayload) ? input.rawPayload : [];
        const rows = input.records.map((record, i) =>
          buildLcrSampleRow({
            record,
            rawRow: rawRows[i] ?? record,
            sourceUrl: input.sourceUrl,
          }),
        );
        const { error } = await supabase
          .from("water_system_lcr_samples")
          .upsert(rows, { onConflict: "pwsid,sample_id" });
        if (error) {
          console.warn(
            "[lcr-cache] collection upsert error:",
            error.message,
          );
        }
      } catch (err) {
        console.warn(
          "[lcr-cache] upsert threw:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

export async function resolveLcrSamples(
  pwsid: string,
  store: LcrCacheStore,
  options: FetchLcrSamplesOptions = {},
): Promise<{
  records: SdwisLcrSampleRecord[];
  rawPayload: unknown;
  sourceUrl: string;
  cache: LcrCacheLookupResult;
}> {
  const normalized = pwsid.trim().toUpperCase();
  const cache = await store.lookup(normalized);
  if (cache.kind === "hit") {
    return {
      records: cache.records,
      rawPayload: cache.records,
      sourceUrl: cache.sourceUrl,
      cache,
    };
  }
  const { records, rawPayload, sourceUrl } = await fetchLcrSamples(
    normalized,
    options,
  );
  await store.upsert({ pwsid: normalized, records, rawPayload, sourceUrl });
  return { records, rawPayload, sourceUrl, cache };
}
