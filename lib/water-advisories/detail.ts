/**
 * Detail-page bookkeeping between the adapter and the classifier (issue
 * #355). Pure; the route calls both.
 *
 * Why this exists: an OpenCities advisory lives on its own page, and
 * Kalamazoo lifts (or updates) one by editing that page in place while the
 * list entry keeps its first-day title and blurb. So the watcher re-reads
 * the detail page of every advisory that is still open, and status and
 * the content hash read the page's heading and lead.
 *
 * Two rules keep that from flapping:
 *   - selectRefreshUrls: only OPEN rows are re-read — status active /
 *     scheduled / unknown, dated within the timeline's open window. A
 *     lifted row is final and a stale one is history; neither costs a
 *     fetch.
 *   - carryForwardDetail: an entry the adapter did not read this run
 *     (known and not open, past the per-run cap, or a failed fetch) takes
 *     the stored capture's detail fields. Detail therefore changes only on
 *     a successful fresh read; a relay 504 on one run cannot change the
 *     hash or the status.
 */

import { DEFAULT_OPEN_WINDOW_DAYS, daysBetween, rowDate } from "./timeline";
import type { AdvisoryDetail, ParsedAdvisory, StoredAdvisory } from "./types";

const OPEN_STATUSES: ReadonlySet<StoredAdvisory["status"]> = new Set([
  "active",
  "scheduled",
  "unknown",
]);

/** Stored rows whose detail page should be re-read this run. */
export function selectRefreshUrls(
  stored: readonly StoredAdvisory[],
  nowIso: string,
  openWindowDays: number = DEFAULT_OPEN_WINDOW_DAYS,
): Set<string> {
  const out = new Set<string>();
  for (const row of stored) {
    if (!OPEN_STATUSES.has(row.status)) continue;
    if (daysBetween(rowDate(row), nowIso) > openWindowDays) continue;
    out.add(row.source_url);
  }
  return out;
}

/** The detail fields a stored capture holds, or null when it has none. */
export function detailFromRaw(raw: Record<string, unknown>): AdvisoryDetail | null {
  const title = typeof raw.detail_title === "string" ? raw.detail_title : null;
  const lead = typeof raw.detail_lead === "string" ? raw.detail_lead : null;
  if (title === null && lead === null) return null;
  return { title, lead };
}

/**
 * Fill `detail` from the stored capture on every parsed entry the adapter
 * did not read this run. Entries the adapter did read keep theirs; entries
 * with no stored detail stay without one (their hash is the list-only
 * formula, unchanged from before #355).
 */
export function carryForwardDetail(
  parsed: readonly ParsedAdvisory[],
  stored: readonly StoredAdvisory[],
): ParsedAdvisory[] {
  const storedByUrl = new Map(stored.map((s) => [s.source_url, s]));
  return parsed.map((p) => {
    if (p.detail) return p;
    const prev = storedByUrl.get(p.source_url);
    if (!prev) return p;
    const detail = detailFromRaw(prev.raw);
    return detail ? { ...p, detail } : p;
  });
}
