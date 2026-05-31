/**
 * Generated-report persistence + cache (issue #207). Shared layer: a report
 * is a pure function of its persisted inputs, so the first generation
 * uploads the PDF to the private `hearth-reports` bucket and records a
 * pointer in `hearth.report_exports`; later downloads serve the stored file
 * until an input changes the signature.
 *
 * Generic by design — keyed by (house_id, report_type) so every future
 * report type reuses this module unchanged.
 *
 * Degradation discipline: every function here is non-fatal. If the cache
 * table or bucket isn't reachable (e.g. the migration hasn't been pushed
 * yet), reads return null (a miss) and writes log-and-continue — the route
 * still renders and serves a fresh PDF. The cache is an optimization, never
 * a gate on the download.
 */

import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * The RLS-bound server client (schema-typed to `hearth`). Typed off the
 * project's own `createClient` so the cache helpers accept exactly what the
 * route hands them, rather than the library's `public`-schema default.
 */
type ReportSupabaseClient = Awaited<ReturnType<typeof createClient>>;

// computeReportSignature lives in ./signature (no `server-only`) so report
// templates can hash without dragging this Node-only module into their test
// graph. Re-exported here for callers that already import it from cache.
export { computeReportSignature } from "./signature";

const REPORTS_BUCKET = "hearth-reports";

/** Object path within the bucket. Leading {house_id} is what storage RLS keys on. */
function storagePathFor(houseId: string, reportType: string, signature: string): string {
  return `${houseId}/${reportType}/${signature}.pdf`;
}

/**
 * Look up a current cached PDF and return its bytes. The bytes are served
 * back through the RLS-bound route (never a public URL), which is strictly
 * owner-scoped — the SELECT and the storage download both run under the
 * user's session, so another user can't read this house's report.
 *
 * Returns the PDF buffer on a cache hit (a row whose signature matches AND
 * the object downloads); null on a miss, a stale signature, or any error
 * (all treated as a miss so the caller renders fresh).
 */
export async function getCachedReportPdf(args: {
  supabase: ReportSupabaseClient;
  houseId: string;
  reportType: string;
  signature: string;
}): Promise<Buffer | null> {
  const { supabase, houseId, reportType, signature } = args;
  try {
    const { data, error } = await supabase
      .from("report_exports")
      .select("storage_path, signature")
      .eq("house_id", houseId)
      .eq("report_type", reportType)
      .maybeSingle();

    if (error || !data) return null;
    if (data.signature !== signature) return null; // stale — caller regenerates

    const { data: blob, error: downloadError } = await supabase.storage
      .from(REPORTS_BUCKET)
      .download(data.storage_path);

    if (downloadError || !blob) return null;
    return Buffer.from(await blob.arrayBuffer());
  } catch (e) {
    console.error("[reports/cache] getCachedReportPdf failed (serving fresh):", e);
    return null;
  }
}

/**
 * Upload a freshly rendered PDF and upsert the cache pointer. Best-effort:
 * on any failure it logs and returns false, and the caller still serves the
 * bytes it just rendered. Returns true when the cache was updated.
 *
 * Stale-signature objects under previous paths are left in place — distinct
 * paths, cheap to leave; a future periodic sweep can reclaim them (issue
 * #207 explicitly accepts this rather than coupling a delete into the hot
 * path).
 */
export async function persistReport(args: {
  supabase: ReportSupabaseClient;
  houseId: string;
  reportType: string;
  signature: string;
  pdf: Buffer;
  generatedAtIso: string;
}): Promise<boolean> {
  const { supabase, houseId, reportType, signature, pdf, generatedAtIso } = args;
  const path = storagePathFor(houseId, reportType, signature);
  try {
    const { error: uploadError } = await supabase.storage
      .from(REPORTS_BUCKET)
      .upload(path, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      console.error("[reports/cache] PDF upload failed (served fresh, not cached):", uploadError);
      return false;
    }

    const { error: upsertError } = await supabase.from("report_exports").upsert(
      {
        house_id: houseId,
        report_type: reportType,
        storage_path: path,
        signature,
        generated_at: generatedAtIso,
      },
      { onConflict: "house_id,report_type" },
    );
    if (upsertError) {
      console.error("[reports/cache] report_exports upsert failed:", upsertError);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[reports/cache] persistReport failed (served fresh):", e);
    return false;
  }
}
