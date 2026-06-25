/**
 * Shared cache for extracted Consumer Confidence Reports, keyed by
 * `(pwsid, report_year, edition)` in `hearth.water_system_reports`.
 *
 * Unlike WQA-1's `water_systems` cache and WQA-2's SDWIS caches, the
 * source of truth for a CCR is a user upload, not an EPA API. There is
 * no TTL — once a row exists for `(PWSID, year, edition)`, it is
 * canonical until a newer prompt version forces re-extraction (WQA-9's
 * job, not this module's). The cache layer's only responsibility is
 * fast read access to the latest report for a given PWSID; the write
 * path lives in `app/actions/documents/finalize-ccr-upload.ts`.
 *
 * Same wrapper shape as the WATER_SYSTEM / SDWIS caches: a Store
 * interface lets tests inject an in-memory store, and every Supabase
 * failure soft-fails to a cache miss so the module continues to
 * render the `cws_no_ccr` branch when the cache is unreachable.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { supabaseEnvAvailable } from "./sdwis-shared";
import type { CcrExtractionResult } from "@/lib/documents/ai/ccr-schema";

/**
 * One persisted row from `hearth.water_system_reports`, in the shape
 * the orchestrator and summarizer consume. The full row carries more
 * columns (timestamps, raw uploader identity, source document id), but
 * the module only reads the report year + extracted payload.
 */
export type CcrCacheRow = {
  id: string;
  pwsid: string;
  report_year: number;
  edition: string;
  extracted_data: CcrExtractionResult;
  extraction_version: string;
  published_date: string | null;
  extracted_at: string;
};

/**
 * Outcome of a CCR cache lookup. Hit carries the row; miss carries a
 * reason so the activity-log narration can distinguish "no CCR has
 * ever been uploaded for this utility" from "we tried but Supabase
 * was unreachable."
 *
 *   no-row       — `water_system_reports` has no row for this PWSID.
 *                  Expected on the cws_no_ccr happy path.
 *   lookup-error — Supabase errored or env vars missing. Soft-fail.
 */
export type CcrCacheLookupResult =
  | { kind: "hit"; row: CcrCacheRow }
  | { kind: "miss"; reason: "no-row" | "lookup-error" };

/**
 * Storage contract for the CCR cache. Soft-fail by convention — every
 * error path becomes a miss with a "lookup-error" reason rather than
 * throwing. The module's check() relies on this guarantee so a
 * Supabase outage doesn't fail the whole run.
 *
 * Only `lookup` exists on the read-side store interface. Writes go
 * through the action layer (`finalize-ccr-upload.ts`), which has the
 * additional context the cache layer doesn't — uploader identity,
 * source document id, contributor recording — and where the dedup
 * orchestration naturally lives.
 */
export interface CcrCacheStore {
  /**
   * Look up the most recent CCR for the given PWSID. "Most recent" is
   * the highest `report_year` with `edition = 'primary'`; supplements
   * and corrections to other years are not surfaced here (the
   * findings view will render multi-year context in a later phase).
   */
  lookupLatest(pwsid: string): Promise<CcrCacheLookupResult>;
  /**
   * Look up the full multi-year history of `edition = 'primary'` CCRs
   * for the given PWSID, newest first. Powers the year-over-year
   * contaminant trends surfaced in the finding modal and the PDF
   * report (issue #289). Supplements and corrections are excluded —
   * the trend is built from the canonical annual report for each year.
   *
   * Soft-fail by convention: any Supabase error resolves to an empty
   * array rather than throwing, so a cache outage degrades the trend
   * to "no history" instead of failing the whole module run.
   */
  lookupHistory(pwsid: string): Promise<CcrCacheRow[]>;
}

/**
 * Supabase-backed CCR cache store. Reads `hearth.water_system_reports`
 * ordered by `report_year desc` and returns the top row.
 */
export function createSupabaseCcrCacheStore(): CcrCacheStore {
  return {
    async lookupLatest(pwsid: string): Promise<CcrCacheLookupResult> {
      if (!supabaseEnvAvailable()) {
        return { kind: "miss", reason: "lookup-error" };
      }
      const normalized = pwsid.trim().toUpperCase();
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("water_system_reports")
          .select(
            "id, pwsid, report_year, edition, extracted_data, extraction_version, published_date, extracted_at",
          )
          .eq("pwsid", normalized)
          .eq("edition", "primary")
          .order("report_year", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.warn(
            "[ccr-cache] lookup query error, treating as miss:",
            error.message,
          );
          return { kind: "miss", reason: "lookup-error" };
        }
        if (!data) {
          return { kind: "miss", reason: "no-row" };
        }
        return {
          kind: "hit",
          row: {
            id: data.id as string,
            pwsid: data.pwsid as string,
            report_year: data.report_year as number,
            edition: data.edition as string,
            // extracted_data is JSONB; the action layer validated it
            // through ccrExtractionSchema before persisting, so the
            // cast is safe at this boundary. If a future migration
            // introduces a version-skew scenario, re-validate here.
            extracted_data: data.extracted_data as CcrExtractionResult,
            extraction_version: data.extraction_version as string,
            published_date: (data.published_date as string | null) ?? null,
            extracted_at: data.extracted_at as string,
          },
        };
      } catch (err) {
        console.warn(
          "[ccr-cache] lookup threw, treating as miss:",
          err instanceof Error ? err.message : err,
        );
        return { kind: "miss", reason: "lookup-error" };
      }
    },

    async lookupHistory(pwsid: string): Promise<CcrCacheRow[]> {
      if (!supabaseEnvAvailable()) {
        return [];
      }
      const normalized = pwsid.trim().toUpperCase();
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("water_system_reports")
          .select(
            "id, pwsid, report_year, edition, extracted_data, extraction_version, published_date, extracted_at",
          )
          .eq("pwsid", normalized)
          .eq("edition", "primary")
          .order("report_year", { ascending: false });
        if (error) {
          console.warn(
            "[ccr-cache] history query error, treating as empty:",
            error.message,
          );
          return [];
        }
        if (!data) return [];
        return data.map((row) => ({
          id: row.id as string,
          pwsid: row.pwsid as string,
          report_year: row.report_year as number,
          edition: row.edition as string,
          extracted_data: row.extracted_data as CcrExtractionResult,
          extraction_version: row.extraction_version as string,
          published_date: (row.published_date as string | null) ?? null,
          extracted_at: row.extracted_at as string,
        }));
      } catch (err) {
        console.warn(
          "[ccr-cache] history threw, treating as empty:",
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    },
  };
}

/**
 * Look up the latest CCR for the resolved PWSID, returning the row
 * and the cache outcome. Mirrors `resolveWaterSystem` / `resolveViolations`
 * in shape so the orchestrator can narrate consistently.
 *
 * There is no fetch fallback because the source of truth is a user
 * upload, not an EPA endpoint. A cache miss simply means "no one has
 * uploaded a CCR for this PWSID yet," which is the `cws_no_ccr` branch.
 */
export async function resolveLatestCcr(
  pwsid: string,
  store: CcrCacheStore,
): Promise<{
  row: CcrCacheRow | null;
  cache: CcrCacheLookupResult;
}> {
  const cache = await store.lookupLatest(pwsid);
  return {
    row: cache.kind === "hit" ? cache.row : null,
    cache,
  };
}

/**
 * Resolve the full multi-year CCR history for a PWSID (newest first),
 * for the contaminant-trend computation (issue #289). Thin wrapper over
 * `store.lookupHistory` so the orchestrator can narrate the span in the
 * activity log. Soft-fails to an empty array via the store contract.
 */
export async function resolveCcrHistory(
  pwsid: string,
  store: CcrCacheStore,
): Promise<{ rows: CcrCacheRow[] }> {
  const rows = await store.lookupHistory(pwsid);
  return { rows };
}
