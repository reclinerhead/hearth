/**
 * `opencities_list` adapter (issue #331) — reads a Granicus OpenCities
 * content-list page (the City of Kalamazoo's Boil Water Advisories page)
 * plus the site-wide emergency banner on the same page, and returns the
 * advisories it finds as `ParsedAdvisory[]`.
 *
 * This is the only I/O in the parsing path. The HTML → entries work is
 * in ../parse.ts (pure, fixture-tested); this file is the fetch shell:
 * headers, timeout, the bot-wall check, the zero-entries rule, and the
 * best-effort detail fetch that reads "Published on" for URLs the
 * watcher hasn't seen before.
 *
 * Adapter contract (shared with future kinds — see the spoke):
 *   fetchAdvisories(config, { knownUrls, fetchImpl? }) → ParsedAdvisory[]
 * Throws on anything that should count as a watcher failure: non-2xx,
 * a bot-wall page, or a page that parsed to zero entries (the list has
 * never been empty; zero means the markup changed or we got a challenge
 * page). A detail-page failure is NOT a run failure — published_on is
 * simply null for that entry.
 */

import { z } from "zod";
import {
  normalizeUrl,
  parseDetailTitle,
  parseEmergencyBanner,
  parseOpenCitiesList,
  parsePublishedOn,
} from "../parse";
import type { ParsedAdvisory } from "../types";
import { fetchText } from "./fetch";

export const openCitiesListConfigSchema = z.object({
  list_url: z.url(),
  system_wide_phrases: z.array(z.string()).optional(),
  /** Route fetches through WATER_ADVISORY_FETCH_PROXY_URL (see adapters/fetch.ts). */
  use_fetch_proxy: z.boolean().optional(),
});
export type OpenCitiesListConfig = z.infer<typeof openCitiesListConfigSchema>;

export type AdapterContext = {
  /** Normalized URLs already stored for this source — detail pages are fetched only for the rest. */
  knownUrls: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
};

// Bound the per-run detail fetches so a first seed of a long list can't
// blow the route's maxDuration. published_on is read on first sight only,
// so an entry past the cap keeps a null date; in practice the cap is only
// reachable on the silent seed run (the list carries a handful of items).
const MAX_DETAIL_FETCHES = 12;

export async function fetchOpenCitiesAdvisories(
  config: OpenCitiesListConfig,
  ctx: AdapterContext,
): Promise<ParsedAdvisory[]> {
  const fetchOpts = { fetchImpl: ctx.fetchImpl, useProxy: config.use_fetch_proxy ?? false };
  const html = await fetchText(config.list_url, fetchOpts);

  const entries = parseOpenCitiesList(html);
  if (entries.length === 0) {
    throw new Error(
      `parsed zero list entries from ${config.list_url} — markup changed or challenge page`,
    );
  }

  // Banner announcements whose link lives under the advisory list are
  // advisories too — the district-wide LIFTED notice on 2026-09-21 was
  // banner-only for a while (its URL was not in the list).
  const listPrefix = normalizeUrl(config.list_url).toLowerCase();
  const banner = parseEmergencyBanner(html).filter(
    (b) => b.href && normalizeUrl(b.href).toLowerCase().startsWith(`${listPrefix}/`),
  );
  const bannerUrls = new Set(banner.map((b) => normalizeUrl(b.href!)));

  const parsed: ParsedAdvisory[] = entries.map((e) => ({
    source_url: normalizeUrl(e.href),
    title: e.title,
    summary: e.summary,
    published_on: null,
    on_emergency_banner: bannerUrls.has(normalizeUrl(e.href)),
    raw: { list_title: e.title, list_summary: e.summary },
  }));

  const listUrls = new Set(parsed.map((p) => p.source_url));
  for (const b of banner) {
    const url = normalizeUrl(b.href!);
    if (listUrls.has(url)) continue;
    parsed.push({
      source_url: url,
      title: b.title,
      summary: b.summary,
      published_on: null,
      on_emergency_banner: true,
      raw: { banner_title: b.title, banner_summary: b.summary, banner_severity: b.severity },
    });
  }

  // Detail pages: only for URLs the store hasn't seen, best-effort, capped.
  let detailFetches = 0;
  for (const p of parsed) {
    if (ctx.knownUrls.has(p.source_url)) continue;
    if (detailFetches >= MAX_DETAIL_FETCHES) break;
    detailFetches++;
    try {
      const detail = await fetchText(p.source_url, fetchOpts);
      p.published_on = parsePublishedOn(detail);
      const detailTitle = parseDetailTitle(detail);
      if (detailTitle) p.raw.detail_title = detailTitle;
    } catch (err) {
      p.raw.detail_error = err instanceof Error ? err.message : String(err);
    }
  }

  return parsed;
}
