import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify } from "../classify";
import {
  advisoriesFromFeed,
  feedDateToIso,
  fetchRssAdvisories,
  matchAdvisoryItem,
  parseFeed,
  type FeedItem,
} from "./rss";

// Committed 2026-09-22 snapshots. Portage's CivicPlus News Flash feed
// (advisories mixed into city news) and WMUK's regional news feed
// (Kalamazoo's interim source while the city page is unreachable).
const PORTAGE_XML = readFileSync(join(__dirname, "..", "fixtures", "portage-newsflash.xml"), "utf8");
const WMUK_XML = readFileSync(join(__dirname, "..", "fixtures", "wmuk-news.xml"), "utf8");

const PORTAGE_FEED = "https://www.portagemi.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml";
const WMUK_FEED = "https://www.wmuk.org/wmuk-news.rss";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Town</title>
  <entry>
    <title>Boil Water Advisory: Elm St</title>
    <link rel="self" href="https://atom.example/self"/>
    <link rel="alternate" href="https://atom.example/elm"/>
    <id>tag:atom.example,2026:elm</id>
    <published>2026-09-20T10:00:00Z</published>
    <summary type="html">&lt;p&gt;Precautionary advisory for &lt;b&gt;Elm St&lt;/b&gt;.&lt;/p&gt;</summary>
  </entry>
</feed>`;

function item(overrides: Partial<FeedItem>): FeedItem {
  return { title: "", link: "https://x.example/a", summary: "", dateRaw: null, guid: null, ...overrides };
}

describe("parseFeed", () => {
  it("reads the Portage RSS feed: titles, links, dates, stripped descriptions", () => {
    const feed = parseFeed(PORTAGE_XML);
    expect(feed.title).toBe("Portage, MI - News Flash");
    expect(feed.items).toHaveLength(12);
    const lift = feed.items.find((i) => /Boil Water Advisory Lifted/.test(i.title));
    expect(lift).toBeDefined();
    expect(lift!.link).toMatch(/^https:\/\/www\.portagemi\.gov\//);
    expect(lift!.dateRaw).toMatch(/Sep 2026/);
    expect(lift!.summary).not.toMatch(/<[a-z]/i);
  });

  it("reads the WMUK feed", () => {
    const feed = parseFeed(WMUK_XML);
    expect(feed.items).toHaveLength(10);
    const titles = feed.items.map((i) => i.title);
    expect(titles).toContain("Boil water advisory issued for many Kalamazoo customers");
    expect(titles).toContain("Boil water advisory lifted for affected Kalamazoo customers");
  });

  it("reads Atom, preferring the alternate link and stripping HTML summaries", () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe("Atom Town");
    expect(feed.items).toEqual([
      {
        title: "Boil Water Advisory: Elm St",
        link: "https://atom.example/elm",
        summary: "Precautionary advisory for Elm St.",
        dateRaw: "2026-09-20T10:00:00Z",
        guid: "tag:atom.example,2026:elm",
      },
    ]);
  });

  it("rejects non-feed bodies", () => {
    expect(() => parseFeed("<html><body>Access Denied</body></html>")).toThrow(/not an RSS or Atom feed/);
    expect(() => parseFeed("<rss><nope/></rss>")).toThrow(/neither an rss\/channel nor a feed root/);
  });
});

describe("feedDateToIso", () => {
  it("converts RFC 822 and ISO dates to a UTC calendar date", () => {
    expect(feedDateToIso("Sat, 19 Sep 2026 18:55:59 GMT")).toBe("2026-09-19");
    expect(feedDateToIso("Thu, 10 Sep 2026 14:07:13 -0500")).toBe("2026-09-10");
    expect(feedDateToIso("2026-09-20T10:00:00Z")).toBe("2026-09-20");
  });
  it("returns null for junk or absence", () => {
    expect(feedDateToIso("yesterday-ish")).toBeNull();
    expect(feedDateToIso(null)).toBeNull();
  });
});

describe("matchAdvisoryItem", () => {
  const base = { keywords: ["boil water"], requiredKeywords: [], excludeKeywords: [] };

  it("matches any-of keywords case-insensitively in title or summary", () => {
    expect(matchAdvisoryItem(item({ title: "BOIL WATER advisory" }), base)).toEqual(["boil water"]);
    expect(matchAdvisoryItem(item({ summary: "a boil water notice" }), base)).toEqual(["boil water"]);
    expect(matchAdvisoryItem(item({ title: "Fall Fest cancelled" }), base)).toEqual([]);
  });

  it("required keywords must all be present", () => {
    const f = { ...base, requiredKeywords: ["kalamazoo"] };
    expect(matchAdvisoryItem(item({ title: "Boil water advisory for Battle Creek" }), f)).toEqual([]);
    expect(matchAdvisoryItem(item({ title: "Boil water advisory for Kalamazoo" }), f)).toEqual(["boil water"]);
  });

  it("exclude keywords drop an item", () => {
    const f = { ...base, excludeKeywords: ["township"] };
    expect(matchAdvisoryItem(item({ title: "Boil water advisory: Kalamazoo Township" }), f)).toEqual([]);
  });

  it("ignores blank keywords", () => {
    expect(matchAdvisoryItem(item({ title: "Boil water" }), { ...base, keywords: ["  ", "boil water"] })).toEqual(["boil water"]);
  });
});

describe("advisoriesFromFeed", () => {
  it("Portage: keeps the boil-water items, drops the rest, classifies them", () => {
    const parsed = advisoriesFromFeed(parseFeed(PORTAGE_XML), { feed_url: PORTAGE_FEED });
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    for (const p of parsed) expect(p.title.toLowerCase()).toContain("boil water");
    const lift = parsed.find((p) => /Lifted/.test(p.title))!;
    expect(lift).toMatchObject({ published_on: "2026-09-10", on_emergency_banner: false });
    expect(lift.raw).toMatchObject({ feed_title: "Portage, MI - News Flash" });
    expect(lift.raw.matched_keywords).toContain("boil water");
    expect(lift.summary).toMatch(/Windemere Street/);
    expect(classify(lift)).toMatchObject({ status: "lifted" });
  });

  it("Portage: an address-range title classifies as localized", () => {
    // The issued-style title the city used on 2026-09-09 (the fixture only
    // carries the later lifted item), so the street/range rule is pinned
    // against real Portage wording.
    const synthetic = item({
      title: "Boil Water Advisory (6742 – 6852 Windemere Street, 1412, 1420 Hardwick Avenue)",
      summary: "The City of Portage has issued a precautionary boil water advisory for the addresses listed.",
      link: "https://www.portagemi.gov/CivicAlerts.aspx?AID=2089",
    });
    const [adv] = advisoriesFromFeed({ title: null, items: [synthetic] }, { feed_url: PORTAGE_FEED });
    expect(classify(adv)).toMatchObject({ status: "active", scope: "localized" });
  });

  it("WMUK with required 'kalamazoo': both district-wide stories, correctly classified", () => {
    const config = {
      feed_url: WMUK_FEED,
      required_keywords: ["kalamazoo"],
      system_wide_phrases: ["many Kalamazoo customers", "Kalamazoo water customers"],
    };
    const parsed = advisoriesFromFeed(parseFeed(WMUK_XML), config);
    expect(parsed.map((p) => p.title).sort()).toEqual([
      "Boil water advisory issued for many Kalamazoo customers",
      "Boil water advisory lifted for affected Kalamazoo customers",
    ]);
    const issued = classify(parsed.find((p) => /issued/.test(p.title))!, {
      systemWidePhrases: config.system_wide_phrases,
    });
    const lifted = classify(parsed.find((p) => /lifted/.test(p.title))!, {
      systemWidePhrases: config.system_wide_phrases,
    });
    expect(issued).toMatchObject({ status: "active", scope: "system_wide", published_on: "2026-09-19" });
    expect(lifted).toMatchObject({ status: "lifted", published_on: "2026-09-21" });
    expect(lifted.source_url).toBe(
      "https://www.wmuk.org/wmuk-news/2026-09-21/boil-water-advisory-lifted-for-affected-kalamazoo-customers",
    );
  });

  it("a healthy feed with no advisory items yields an empty list (success, not failure)", () => {
    const feed = { title: "Quiet Town", items: [item({ title: "Parade Saturday" })] };
    expect(advisoriesFromFeed(feed, { feed_url: "https://quiet.example/rss" })).toEqual([]);
  });

  it("skips items with no link or no title", () => {
    const feed = {
      title: null,
      items: [item({ title: "Boil water advisory", link: null }), item({ title: "", summary: "boil water" })],
    };
    expect(advisoriesFromFeed(feed, { feed_url: "https://x.example/rss" })).toEqual([]);
  });
});

describe("fetchRssAdvisories", () => {
  const fake = (status: number, body: string): typeof fetch =>
    (async () => new Response(body, { status })) as typeof fetch;

  it("throws on a feed with zero raw items", async () => {
    const empty = `<rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    await expect(
      fetchRssAdvisories({ feed_url: PORTAGE_FEED }, { fetchImpl: fake(200, empty) }),
    ).rejects.toThrow(/zero items/);
  });

  it("throws on non-2xx and on non-XML bodies", async () => {
    await expect(
      fetchRssAdvisories({ feed_url: PORTAGE_FEED }, { fetchImpl: fake(500, "boom") }),
    ).rejects.toThrow(/→ 500/);
    await expect(
      fetchRssAdvisories({ feed_url: PORTAGE_FEED }, { fetchImpl: fake(200, "<html>Maintenance</html>") }),
    ).rejects.toThrow(/not an RSS or Atom feed/);
  });

  it("returns matched advisories from a live-shaped body", async () => {
    const parsed = await fetchRssAdvisories({ feed_url: PORTAGE_FEED }, { fetchImpl: fake(200, PORTAGE_XML) });
    expect(parsed.some((p) => /Boil Water Advisory Lifted/.test(p.title))).toBe(true);
  });
});
