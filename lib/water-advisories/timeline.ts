/**
 * Advisory timeline derivation (issue #347) — turns the watcher's stored
 * `water_advisories` rows for one water system into the short "Recent
 * advisories" list the WQA finding and the public water page render.
 *
 * Pure and client-safe (no Supabase, no node:crypto): the in-app modal
 * runs it in the browser, the public page at static-generation time.
 *
 * The watcher stores "issued" and "lifted" as SEPARATE rows because the
 * city and the news feed publish them as separate pages. To show
 * "Issued Sep 19 · Lifted Sep 21" on one line, a lifted row is paired
 * with the most recent still-open issued row of the same scope class:
 *   - district-wide / unknown rows pair with each other;
 *   - localized rows pair only when their titles share a street or
 *     number token, so a Rose Arbour lift never closes a Baker St notice.
 * A lifted row with nothing to close stands alone (Portage's Sept 10
 * lift, whose issued notice predates the watcher).
 *
 * "Open" = an unpaired active/scheduled row issued within the last
 * `openWindowDays` (default 14). Older unpaired rows are rendered with
 * "no lift recorded" rather than as active — the source may simply never
 * have posted a lift, and a months-old "active" banner would be a lie.
 *
 * Output is oldest → newest (newest at the bottom, per the issue), capped
 * at `limit`; open items are never dropped by the cap.
 */

import type { AdvisoryScope, AdvisoryStatus } from "./types";

export type TimelineRow = {
  source_url: string;
  title: string;
  summary: string;
  status: AdvisoryStatus;
  scope: AdvisoryScope;
  /** ISO calendar date or null. */
  published_on: string | null;
  /** ISO timestamp. */
  first_seen_at: string;
};

export type AdvisoryTimelineItem = {
  /** Stable key for React lists — the issued row's URL, or the lift's when standalone. */
  key: string;
  title: string;
  summary: string;
  scope: AdvisoryScope;
  status: AdvisoryStatus;
  sourceUrl: string;
  /** ISO calendar date the advisory was issued; null for a standalone lift. */
  issuedOn: string | null;
  /** ISO calendar date the paired lift was posted; null when none. */
  liftedOn: string | null;
  liftedSourceUrl: string | null;
  open: boolean;
};

export type TimelineOptions = {
  limit?: number;
  openWindowDays?: number;
};

const DEFAULT_LIMIT = 4;
const DEFAULT_OPEN_WINDOW_DAYS = 14;

/** The calendar date a row represents: the source's published date, else when Hearth first saw it. */
export function rowDate(row: Pick<TimelineRow, "published_on" | "first_seen_at">): string {
  return row.published_on ?? row.first_seen_at.slice(0, 10);
}

function scopeClass(scope: AdvisoryScope): "wide" | "localized" {
  return scope === "localized" ? "localized" : "wide";
}

const GENERIC_TOKENS = new Set([
  "boil",
  "water",
  "advisory",
  "advisories",
  "lifted",
  "lift",
  "scheduled",
  "precautionary",
  "notice",
  "order",
  "issued",
  "effective",
  "for",
  "and",
  "the",
  "of",
  "st",
  "street",
  "ave",
  "avenue",
  "dr",
  "drive",
  "rd",
  "road",
  "ct",
  "court",
  "ln",
  "lane",
  "blvd",
  "boulevard",
  "way",
  "pl",
  "place",
  "cir",
  "circle",
  "ter",
  "terrace",
  "trl",
  "trail",
]);

/** Distinguishing tokens of a localized title: street names and house numbers. */
export function subjectTokens(title: string): Set<string> {
  const idx = title.indexOf(":");
  const subject = idx === -1 ? title : title.slice(idx + 1);
  const out = new Set<string>();
  for (const raw of subject.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (GENERIC_TOKENS.has(raw)) continue;
    // Month names and years are not street identity.
    if (/^(19|20)\d{2}$/.test(raw)) continue;
    if (/^(january|february|march|april|may|june|july|august|september|october|november|december)$/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

function tokensOverlap(a: string, b: string): boolean {
  const ta = subjectTokens(a);
  const tb = subjectTokens(b);
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

function daysBetween(fromIsoDate: string, toIso: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.POSITIVE_INFINITY;
  return (to - from) / 86_400_000;
}

export function buildAdvisoryTimeline(
  rows: readonly TimelineRow[],
  nowIso: string,
  options: TimelineOptions = {},
): AdvisoryTimelineItem[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const openWindowDays = options.openWindowDays ?? DEFAULT_OPEN_WINDOW_DAYS;

  const sorted = [...rows].sort((a, b) => {
    const d = rowDate(a).localeCompare(rowDate(b));
    return d !== 0 ? d : a.first_seen_at.localeCompare(b.first_seen_at);
  });

  const items: AdvisoryTimelineItem[] = [];
  // Unpaired issued items, most recent last.
  const openItems: AdvisoryTimelineItem[] = [];

  for (const row of sorted) {
    if (row.status === "lifted") {
      const cls = scopeClass(row.scope);
      let matchIdx = -1;
      for (let i = openItems.length - 1; i >= 0; i--) {
        const cand = openItems[i];
        if (scopeClass(cand.scope) !== cls) continue;
        if (cls === "localized" && !tokensOverlap(cand.title, row.title)) continue;
        matchIdx = i;
        break;
      }
      if (matchIdx !== -1) {
        const item = openItems[matchIdx];
        item.liftedOn = rowDate(row);
        item.liftedSourceUrl = row.source_url;
        item.open = false;
        openItems.splice(matchIdx, 1);
        continue;
      }
      items.push({
        key: row.source_url,
        title: row.title,
        summary: row.summary,
        scope: row.scope,
        status: "lifted",
        sourceUrl: row.source_url,
        issuedOn: null,
        liftedOn: rowDate(row),
        liftedSourceUrl: row.source_url,
        open: false,
      });
      continue;
    }

    const item: AdvisoryTimelineItem = {
      key: row.source_url,
      title: row.title,
      summary: row.summary,
      scope: row.scope,
      status: row.status,
      sourceUrl: row.source_url,
      issuedOn: rowDate(row),
      liftedOn: null,
      liftedSourceUrl: null,
      open: false,
    };
    items.push(item);
    openItems.push(item);
  }

  for (const item of openItems) {
    item.open = daysBetween(item.issuedOn!, nowIso) <= openWindowDays;
  }

  if (items.length <= limit) return items;
  const keep = new Set(items.slice(-limit));
  for (const item of items) if (item.open) keep.add(item);
  return items.filter((i) => keep.has(i));
}

/** "2026-09-19" → "Sep 19, 2026" (UTC, deterministic for ISR). */
export function formatAdvisoryDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One honest sentence about where a city's advisories come from, derived
 * from the source row rather than hardcoded per city. A `.gov` / `.us`
 * feed is the city's own; anything else is treated as a newsroom feed
 * and carries the latency caveat.
 */
export function describeAdvisorySource(
  kind: string,
  config: Record<string, unknown>,
): string {
  if (kind === "opencities_list") return "Watching the city's own advisory page.";
  const feed = typeof config.feed_url === "string" ? config.feed_url : null;
  let host: string | null = null;
  try {
    host = feed ? new URL(feed).hostname.replace(/^www\./, "") : null;
  } catch {
    host = null;
  }
  if (host && /\.(gov|us)$/i.test(host)) return "Watching the city's own news feed.";
  if (host) {
    const label = host.split(".")[0];
    const pretty = label.length <= 5 ? label.toUpperCase() : label;
    return `Watching ${pretty}'s news feed, which typically runs one to three hours behind the city.`;
  }
  return "Watching a public feed for this city.";
}
