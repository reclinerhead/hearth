/**
 * Server-side data loader for the public water system page (epic
 * #298, Phase 1). Runs only at static-generation / ISR-revalidate
 * time inside `app/(public)/water/[systemSlug]/page.tsx` — never in
 * the browser, never per-request (the route is fully static).
 *
 * Access posture, per the epic's corrected architecture notes: the
 * shared-cache tables are `to authenticated` SELECT-only and stay
 * that way. These reads go through the WQA module's existing
 * service-role cache wrappers, which is safe by construction here
 * because the PWSID comes from the hardcoded slug allowlist
 * (`lib/public-pages/slugs.ts`) — no user input ever reaches a query.
 * The wrappers also fetch-from-EPA-on-miss, which makes a page for an
 * unpopulated system self-seeding at ISR time (the mechanism Phase 3
 * scale-out depends on).
 *
 * Column discipline: `resolveLatestCcr` selects only the extraction
 * columns (no `uploaded_by`, no `content_hash`), and the contributors
 * table is never touched. The EPA inventory record does carry the
 * utility's admin contact — that stays server-side; the page renders
 * the derived `PublicWaterSummary`, which never includes it (enforced
 * by test in water-summary.test.ts).
 */

import {
  createSupabaseWaterSystemCacheStore,
  resolveWaterSystem,
} from "@/lib/habitat/modules/water-quality-awareness/caches/water-system-cache";
import {
  createSupabaseViolationsCacheStore,
  resolveViolations,
} from "@/lib/habitat/modules/water-quality-awareness/caches/violations-cache";
import {
  createSupabaseLcrCacheStore,
  resolveLcrSamples,
} from "@/lib/habitat/modules/water-quality-awareness/caches/lcr-cache";
import {
  createSupabaseCcrCacheStore,
  resolveCcrHistory,
} from "@/lib/habitat/modules/water-quality-awareness/caches/ccr-cache";
import { createServiceClient } from "@/lib/supabase/service";
import type { TimelineRow } from "@/lib/water-advisories/timeline";
import type { PublicWaterSummaryInput } from "./water-summary";

/**
 * The watcher's advisory rows for a PWSID (issue #347): the source row
 * (so the page can say what it watches and since when) plus the recent
 * advisories. Same service-role-at-generation-time posture as the other
 * reads — the PWSID comes from the slug allowlist. Soft-fails to null
 * (distinct from "watched, nothing recorded") so an outage never renders
 * as "no advisories".
 */
export async function resolveAdvisories(
  pwsid: string,
): Promise<PublicWaterSummaryInput["advisories"]> {
  const supabase = createServiceClient();
  const { data: source, error: sourceError } = await supabase
    .from("water_advisory_sources")
    .select("kind, config, created_at, enabled")
    .eq("pwsid", pwsid)
    .maybeSingle();
  if (sourceError) return null;
  if (!source || !source.enabled) return { watched: false };

  const { data: rows, error } = await supabase
    .from("water_advisories")
    .select("source_url, title, summary, status, scope, published_on, first_seen_at")
    .eq("pwsid", pwsid)
    .order("first_seen_at", { ascending: false })
    .limit(20);
  if (error) return null;

  return {
    watched: true,
    sourceKind: source.kind as string,
    sourceConfig: (source.config ?? {}) as Record<string, unknown>,
    watchingSince: source.created_at as string,
    rows: (rows ?? []) as TimelineRow[],
  };
}

/**
 * Load everything the public page needs for one PWSID. Returns null
 * when EPA has no inventory record for the PWSID at all (a page
 * shouldn't exist for a system EPA doesn't know) — the page renders
 * an honest "temporarily unavailable" state in that case rather than
 * a permanent 404, since a transient EPA outage at revalidate time
 * shouldn't take the page down.
 *
 * The SDWIS fetches soft-fail to null independently (same discipline
 * as the WQA module's check()): a failed violations fetch must read
 * as "couldn't check", never as "no violations".
 */
export async function loadPublicWaterSystem(
  pwsid: string,
): Promise<Omit<PublicWaterSummaryInput, "now"> | null> {
  const { record } = await resolveWaterSystem(
    pwsid,
    createSupabaseWaterSystemCacheStore(),
  );
  if (!record) return null;

  const [violationsResult, lcrResult, ccrResult, advisoriesResult] =
    await Promise.allSettled([
      resolveViolations(pwsid, createSupabaseViolationsCacheStore()),
      resolveLcrSamples(pwsid, createSupabaseLcrCacheStore()),
      // Every uploaded year, not just the latest — the public page renders
      // the same year-over-year trends the in-app finding shows (issue #303).
      resolveCcrHistory(pwsid, createSupabaseCcrCacheStore()),
      resolveAdvisories(pwsid),
    ]);

  const violations =
    violationsResult.status === "fulfilled"
      ? violationsResult.value.records
      : null;
  const lcrSamples =
    lcrResult.status === "fulfilled" ? lcrResult.value.records : null;
  const ccrRows =
    ccrResult.status === "fulfilled" ? ccrResult.value.rows : [];
  const advisories =
    advisoriesResult.status === "fulfilled" ? advisoriesResult.value : null;

  return {
    record,
    violations,
    lcrSamples,
    advisories,
    ccrYears: ccrRows.map((row) => ({
      reportYear: row.report_year,
      publishedDate: row.published_date,
      extractedAt: row.extracted_at,
      extractedData: row.extracted_data,
    })),
  };
}
