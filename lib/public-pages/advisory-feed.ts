/**
 * The JSON advisories feed for one public water system (issue #358): the
 * machine-readable twin of the public page's advisories block, served at
 * `GET /api/water/{slug}/advisories` for consumers that poll — Home
 * Assistant on the owner's LAN first, which cannot be pushed to. Pure: the
 * route loads (`resolveAdvisoryFeed` in water-data.ts), this derives.
 *
 * It publishes nothing the indexed page doesn't already show. Every item
 * goes through the page's own `toPublicAdvisoryItem` (title capped, summary
 * only on an open advisory) and is re-listed field by field, so a new
 * column can't ride along unnoticed. The system is named by its registry
 * place name, never its PWSID. The only additions are the watcher's own
 * timestamps, so a consumer can tell "watched, nothing new" from "the
 * watcher has been blind for hours" — silence must never look like "no
 * advisory" (water-advisories.md).
 *
 * History = advisories plus their all-clears. The shared timeline pairs a
 * lift onto the issued item it closes (`liftedOn`); a lift with nothing to
 * close stands alone. The feed reverses it to newest first, keeps items
 * whose latest date (the lift, else the issue) is inside the window, and
 * caps the count — open items are never dropped. The cap is for the
 * consumer: Home Assistant's recorder skips state attributes over 16 KB,
 * and `items` rides as one.
 */

import {
  buildAdvisoryTimeline,
  describeAdvisorySource,
  type AdvisoryTimelineItem,
  type TimelineRow,
} from "@/lib/water-advisories/timeline";
import type { PublicWaterSystemEntry } from "./slugs";
import { toPublicAdvisoryItem, type PublicAdvisoryItem } from "./water-summary";

export const ADVISORY_FEED_WINDOW_DAYS = 365;
export const ADVISORY_FEED_LIMIT = 20;
/** Rows are read this many days before the window, so a lift inside it can
 *  still pair with an issue posted shortly before it. */
export const ADVISORY_FEED_READ_MARGIN_DAYS = 30;

/** What the loader hands over. `null` = the read failed, never "no advisories". */
export type AdvisoryFeedInput =
  | null
  | { watched: false }
  | {
      watched: true;
      sourceKind: string;
      sourceConfig: Record<string, unknown>;
      /** ISO timestamp the source row was created. */
      watchingSince: string;
      /** `water_advisory_sources.last_run_at`, ISO or null. */
      lastRunAt: string | null;
      /** `water_advisory_sources.last_ok_at`, ISO or null. */
      lastOkAt: string | null;
      rows: TimelineRow[];
    };

/** One feed item: the public page's item minus its React key (`sourceUrl` carries the URL). */
export type AdvisoryFeedItem = Omit<PublicAdvisoryItem, "key">;

type AdvisoryFeedBase = {
  system: { slug: string; name: string };
  /** When this response was built (generation time, not request time). */
  generatedAt: string;
};

export type AdvisoryFeed =
  | (AdvisoryFeedBase & { state: "not_watched" })
  | (AdvisoryFeedBase & { state: "unavailable" })
  | (AdvisoryFeedBase & {
      state: "watched";
      sourceNote: string;
      watcher: {
        /** ISO calendar date the watcher started on this system. */
        watchingSince: string;
        lastCheckedAt: string | null;
        lastOkAt: string | null;
      };
      /** Open items by scope class; `unknown` counts as system-wide, as the planner treats it. */
      open: { systemWide: number; localized: number };
      /** Newest first. */
      items: AdvisoryFeedItem[];
    });

export type AdvisoryFeedOptions = {
  windowDays?: number;
  limit?: number;
};

/** The date an item last moved: its all-clear when it has one, else its issue. */
function latestDate(t: AdvisoryTimelineItem): string {
  return t.liftedOn ?? t.issuedOn ?? "";
}

function toFeedItem(t: AdvisoryTimelineItem): AdvisoryFeedItem {
  const p = toPublicAdvisoryItem(t);
  return {
    title: p.title,
    summary: p.summary,
    scope: p.scope,
    status: p.status,
    issuedOn: p.issuedOn,
    liftedOn: p.liftedOn,
    sourceUrl: p.sourceUrl,
    liftedSourceUrl: p.liftedSourceUrl,
    open: p.open,
  };
}

export function buildAdvisoryFeed(
  entry: Pick<PublicWaterSystemEntry, "slug" | "placeName">,
  input: AdvisoryFeedInput,
  now: Date,
  options: AdvisoryFeedOptions = {},
): AdvisoryFeed {
  const base: AdvisoryFeedBase = {
    system: { slug: entry.slug, name: entry.placeName },
    generatedAt: now.toISOString(),
  };
  if (input === null) return { ...base, state: "unavailable" };
  if (!input.watched) return { ...base, state: "not_watched" };

  const windowDays = options.windowDays ?? ADVISORY_FEED_WINDOW_DAYS;
  const limit = options.limit ?? ADVISORY_FEED_LIMIT;
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);

  // The shared timeline, uncapped (oldest first); the window and cap are the feed's own.
  const timeline = buildAdvisoryTimeline(input.rows, now.toISOString(), {
    limit: Number.POSITIVE_INFINITY,
  });
  const newestFirst = timeline.filter((t) => t.open || latestDate(t) >= cutoff).reverse();
  const kept = newestFirst.filter((t, i) => i < limit || t.open);

  return {
    ...base,
    state: "watched",
    sourceNote: describeAdvisorySource(input.sourceKind, input.sourceConfig),
    watcher: {
      watchingSince: input.watchingSince.slice(0, 10),
      lastCheckedAt: input.lastRunAt,
      lastOkAt: input.lastOkAt,
    },
    open: {
      systemWide: newestFirst.filter((t) => t.open && t.scope !== "localized").length,
      localized: newestFirst.filter((t) => t.open && t.scope === "localized").length,
    },
    items: kept.map(toFeedItem),
  };
}
