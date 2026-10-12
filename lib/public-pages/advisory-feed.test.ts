import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@/lib/water-advisories/timeline";
import {
  ADVISORY_FEED_LIMIT,
  ADVISORY_FEED_WINDOW_DAYS,
  buildAdvisoryFeed,
  type AdvisoryFeed,
  type AdvisoryFeedInput,
} from "./advisory-feed";
import { PUBLIC_ADVISORY_SUMMARY_MAX, PUBLIC_ADVISORY_TITLE_MAX } from "./water-summary";

const NOW = new Date("2026-10-12T18:00:00.000Z");
const KZOO = { slug: "kalamazoo-mi", placeName: "Kalamazoo, Michigan" };
const LIST = "https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories";

function row(overrides: Partial<TimelineRow> & { source_url: string; title: string }): TimelineRow {
  return {
    summary: "",
    status: "active",
    scope: "system_wide",
    published_on: null,
    first_seen_at: "2026-09-24T12:00:00.000Z",
    ...overrides,
  };
}

function watched(rows: TimelineRow[], extra: Partial<Extract<AdvisoryFeedInput, { watched: true }>> = {}): AdvisoryFeedInput {
  return {
    watched: true,
    sourceKind: "opencities_list",
    sourceConfig: { list_url: LIST },
    watchingSince: "2026-09-22T15:00:00.000Z",
    lastRunAt: "2026-10-12T17:30:04.000Z",
    lastOkAt: "2026-10-12T17:30:04.000Z",
    rows,
    ...extra,
  };
}

function asWatched(feed: AdvisoryFeed) {
  if (feed.state !== "watched") throw new Error(`expected watched, got ${feed.state}`);
  return feed;
}

// The real September 2026 district-wide advisory and its lift.
const SEPT_ISSUED = row({
  source_url: `${LIST}/Boil-Water-Advisory-LOW-and-HIGH-Pressure-Districts-ONLY`,
  title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
  summary: "E.coli bacteria were found in one sample on September 18, 2026.",
  published_on: "2026-09-19",
});
const SEPT_LIFTED = row({
  source_url: `${LIST}/Boil-Water-Advisory-LIFTED-LOW-and-HIGH-Pressure-Districts`,
  title: "Boil Water Advisory LIFTED for Water Customers (High & Low Districts)",
  status: "lifted",
  published_on: "2026-09-21",
});

describe("buildAdvisoryFeed — states", () => {
  it("a failed read is 'unavailable', never an empty list", () => {
    const feed = buildAdvisoryFeed(KZOO, null, NOW);
    expect(feed.state).toBe("unavailable");
    expect(feed).not.toHaveProperty("items");
    expect(feed).not.toHaveProperty("open");
  });

  it("an unwatched system is 'not_watched'", () => {
    const feed = buildAdvisoryFeed(KZOO, { watched: false }, NOW);
    expect(feed.state).toBe("not_watched");
    expect(feed).not.toHaveProperty("items");
  });

  it("a watched system with no rows is 'watched' with an empty list and the watcher's timestamps", () => {
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([]), NOW));
    expect(feed.items).toEqual([]);
    expect(feed.open).toEqual({ systemWide: 0, localized: 0 });
    expect(feed.watcher).toEqual({
      watchingSince: "2026-09-22",
      lastCheckedAt: "2026-10-12T17:30:04.000Z",
      lastOkAt: "2026-10-12T17:30:04.000Z",
    });
    expect(feed.sourceNote).toBe("Watching the city's own advisory page.");
  });

  it("names the system by its registry place name and stamps generation time", () => {
    const feed = buildAdvisoryFeed(KZOO, watched([]), NOW);
    expect(feed.system).toEqual({ slug: "kalamazoo-mi", name: "Kalamazoo, Michigan" });
    expect(feed.generatedAt).toBe("2026-10-12T18:00:00.000Z");
  });

  it("passes a never-succeeded watcher through as nulls", () => {
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([], { lastRunAt: null, lastOkAt: null }), NOW));
    expect(feed.watcher.lastCheckedAt).toBeNull();
    expect(feed.watcher.lastOkAt).toBeNull();
  });
});

describe("buildAdvisoryFeed — history", () => {
  it("shows the September advisory and its all-clear as one item", () => {
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([SEPT_ISSUED, SEPT_LIFTED]), NOW));
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
      scope: "system_wide",
      issuedOn: "2026-09-19",
      liftedOn: "2026-09-21",
      sourceUrl: SEPT_ISSUED.source_url,
      liftedSourceUrl: SEPT_LIFTED.source_url,
      open: false,
      summary: null,
    });
  });

  it("keeps a lift with nothing to close as its own all-clear item", () => {
    const lift = row({
      source_url: "https://www.portagemi.gov/CivicAlerts.aspx?AID=1",
      title: "Boil Water Advisory Lifted",
      status: "lifted",
      published_on: "2026-09-10",
    });
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([lift]), NOW));
    expect(feed.items).toEqual([
      expect.objectContaining({ status: "lifted", issuedOn: null, liftedOn: "2026-09-10", open: false }),
    ]);
  });

  it("lists newest first", () => {
    const rows = [
      row({ source_url: `${LIST}/a`, title: "Boil Water Advisory: 100 Main St", scope: "localized", status: "lifted", published_on: "2026-03-02" }),
      row({ source_url: `${LIST}/b`, title: "Boil Water Advisory: 200 Oak St", scope: "localized", status: "lifted", published_on: "2026-06-15" }),
      row({ source_url: `${LIST}/c`, title: "Boil Water Advisory: 300 Elm St", scope: "localized", status: "lifted", published_on: "2026-08-01" }),
    ];
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched(rows), NOW));
    expect(feed.items.map((i) => i.liftedOn)).toEqual(["2026-08-01", "2026-06-15", "2026-03-02"]);
  });

  it("drops items whose latest date is outside the window", () => {
    const old = row({ source_url: `${LIST}/old`, title: "Boil Water Advisory: 1 Pine St", scope: "localized", status: "lifted", published_on: "2025-09-30" });
    const recent = row({ source_url: `${LIST}/new`, title: "Boil Water Advisory: 2 Pine St", scope: "localized", status: "lifted", published_on: "2026-01-05" });
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([old, recent]), NOW));
    expect(feed.items.map((i) => i.sourceUrl)).toEqual([`${LIST}/new`]);
  });

  it("keeps an advisory issued before the window when its all-clear landed inside it", () => {
    const issued = row({ source_url: `${LIST}/x`, title: "Boil Water Advisory: Pressure District", published_on: "2025-10-01" });
    const lifted = row({ source_url: `${LIST}/x-lifted`, title: "Boil Water Advisory LIFTED: Pressure District", status: "lifted", published_on: "2025-10-20" });
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([issued, lifted]), NOW));
    expect(feed.items).toEqual([
      expect.objectContaining({ issuedOn: "2025-10-01", liftedOn: "2025-10-20" }),
    ]);
  });

  it("caps the list and never drops an open advisory past the cap", () => {
    const lifts = [1, 2, 3].map((d) =>
      row({
        source_url: `${LIST}/lift-${d}`,
        title: `Boil Water Advisory LIFTED: ${d}00 Birch St`,
        scope: "localized",
        status: "lifted",
        published_on: `2026-10-0${d + 5}`,
      }),
    );
    const open = row({ source_url: `${LIST}/open`, title: "Boil Water Advisory: Westnedge Ave", scope: "localized", published_on: "2026-10-03" });
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched([open, ...lifts]), NOW, { limit: 2 }));
    expect(feed.items.map((i) => i.sourceUrl)).toEqual([`${LIST}/lift-3`, `${LIST}/lift-2`, `${LIST}/open`]);
    expect(feed.items[2].open).toBe(true);
  });

  it("defaults to a 365-day window and 20 items", () => {
    expect(ADVISORY_FEED_WINDOW_DAYS).toBe(365);
    expect(ADVISORY_FEED_LIMIT).toBe(20);
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({
        source_url: `${LIST}/many-${i}`,
        title: `Boil Water Advisory LIFTED: ${i + 1} Cedar St`,
        scope: "localized",
        status: "lifted",
        published_on: `2026-0${(i % 9) + 1}-1${i % 10}`,
      }),
    );
    expect(asWatched(buildAdvisoryFeed(KZOO, watched(rows), NOW)).items).toHaveLength(20);
  });
});

describe("buildAdvisoryFeed — open counts and text discipline", () => {
  it("counts open items by scope class, with unknown as system-wide", () => {
    const rows = [
      row({ source_url: `${LIST}/wide`, title: "Boil Water Advisory: LOW Pressure District", published_on: "2026-10-10" }),
      row({ source_url: `${LIST}/unknown`, title: "Water Notice", scope: "unknown", published_on: "2026-10-11" }),
      row({ source_url: `${LIST}/local`, title: "Boil Water Advisory: 400 Maple St", scope: "localized", published_on: "2026-10-09" }),
      SEPT_ISSUED,
      SEPT_LIFTED,
    ];
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched(rows), NOW));
    expect(feed.open).toEqual({ systemWide: 2, localized: 1 });
  });

  it("caps titles and shows a capped summary only on an open item", () => {
    const longTitle = `Boil Water Advisory: ${"Westnedge Avenue between Kilgore and Crosstown ".repeat(6)}`;
    const longSummary = "Customers should boil water before drinking. ".repeat(12);
    const open = row({ source_url: `${LIST}/long-open`, title: longTitle, summary: longSummary, scope: "localized", published_on: "2026-10-10" });
    const closed = row({ source_url: `${LIST}/long-closed`, title: "Boil Water Advisory: 9 Spruce St", summary: longSummary, scope: "localized", status: "lifted", published_on: "2026-10-01" });
    const [first, second] = asWatched(buildAdvisoryFeed(KZOO, watched([closed, open]), NOW)).items;
    expect(first.open).toBe(true);
    expect(first.title.length).toBeLessThanOrEqual(PUBLIC_ADVISORY_TITLE_MAX);
    expect(first.title.endsWith("…")).toBe(true);
    expect(first.summary?.length).toBeLessThanOrEqual(PUBLIC_ADVISORY_SUMMARY_MAX);
    expect(first.summary?.endsWith("…")).toBe(true);
    expect(second.summary).toBeNull();
  });

  it("serialises only the allowlisted fields — no PWSID, raw capture, hash, or React key", () => {
    const rows = [
      { ...SEPT_ISSUED, raw: { detail_lead: "x" }, content_hash: "abc123", pwsid: "MI0003520" } as unknown as TimelineRow,
      SEPT_LIFTED,
    ];
    const feed = asWatched(buildAdvisoryFeed(KZOO, watched(rows), NOW));
    expect(Object.keys(feed).sort()).toEqual(["generatedAt", "items", "open", "sourceNote", "state", "system", "watcher"]);
    expect(Object.keys(feed.items[0]).sort()).toEqual(
      ["issuedOn", "liftedOn", "liftedSourceUrl", "open", "scope", "sourceUrl", "status", "summary", "title"],
    );
    const json = JSON.stringify(feed);
    expect(json).not.toContain("MI0003520");
    expect(json).not.toContain("content_hash");
    expect(json).not.toContain("abc123");
    expect(json).not.toContain("detail_lead");
  });
});
