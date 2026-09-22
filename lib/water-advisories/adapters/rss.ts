/**
 * `rss` adapter (issue #337) — reads an RSS 2.0 or Atom feed and keeps the
 * items that look like water advisories.
 *
 * The highest-leverage adapter Hearth can have: every CivicPlus town (the
 * most common municipal CMS in the US) exposes a News Flash feed, most
 * other municipal CMSs expose something similar, and local news outlets
 * publish open feeds too. A new city is a source row, not parsing code.
 *
 * Two cities use it today:
 *   - Portage, MI — its own CivicPlus News Flash feed (advisories mixed
 *     into general city news, hence the keyword filter).
 *   - Kalamazoo, MI — WMUK's news feed, as an *interim* source: the city's
 *     own page sits behind Akamai, which rejects every cloud egress we
 *     tested. News runs an hour or three behind the city, but it's open.
 *
 * Failure semantics differ from the OpenCities adapter in one deliberate
 * way: a well-formed feed whose items all fail the keyword filter returns
 * `[]` and is a SUCCESS (a city with nothing current). Zero *raw* items,
 * a non-XML body, or a missing channel/feed root is a failure.
 *
 * Config:
 *   feed_url            required
 *   keywords            any-of, matched against title + summary
 *                       (default: boil water / do not drink / do not use /
 *                       water advisory / water notice)
 *   required_keywords   all-of — e.g. ["kalamazoo"] on a regional news feed
 *   exclude_keywords    none-of
 *   system_wide_phrases handed to the classifier (see classify.ts)
 *   use_fetch_proxy     route through WATER_ADVISORY_FETCH_PROXY_URL
 */

import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { cleanText, normalizeUrl } from "../parse";
import type { ParsedAdvisory } from "../types";
import { fetchText } from "./fetch";

export const rssConfigSchema = z.object({
  feed_url: z.url(),
  keywords: z.array(z.string()).optional(),
  required_keywords: z.array(z.string()).optional(),
  exclude_keywords: z.array(z.string()).optional(),
  system_wide_phrases: z.array(z.string()).optional(),
  use_fetch_proxy: z.boolean().optional(),
});
export type RssConfig = z.infer<typeof rssConfigSchema>;

export const DEFAULT_ADVISORY_KEYWORDS: readonly string[] = [
  "boil water",
  "boil-water",
  "do not drink",
  "do not use",
  "water advisory",
  "water notice",
];

const SUMMARY_MAX = 600;

export type FeedItem = {
  title: string;
  link: string | null;
  summary: string;
  /** The raw date string as the feed printed it. */
  dateRaw: string | null;
  guid: string | null;
};

export type ParsedFeed = {
  title: string | null;
  items: FeedItem[];
};

// --------------------------------------------------------------------------
// Feed parsing (pure)
// --------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  // Force list shape where a feed with one entry would otherwise collapse
  // to an object.
  isArray: (_name, jpath) =>
    jpath === "rss.channel.item" || jpath === "feed.entry" || jpath === "feed.entry.link",
});

type Node = string | number | { [k: string]: unknown } | null | undefined;

/** Text of a node that may be a string, a {#text} object, or absent. */
function text(node: Node): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  const t = (node as Record<string, unknown>)["#text"];
  return typeof t === "string" ? t : null;
}

function firstString(...nodes: Node[]): string | null {
  for (const n of nodes) {
    const t = text(n);
    if (t && t.trim().length > 0) return t;
  }
  return null;
}

/** Parse RSS 2.0 or Atom into a uniform item list. Throws on non-feed XML. */
export function parseFeed(xml: string): ParsedFeed {
  if (!/<(rss|feed)[\s>]/i.test(xml.slice(0, 2_000))) {
    throw new Error("body is not an RSS or Atom feed");
  }
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`feed XML did not parse: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    const items = (channel.item as Record<string, unknown>[] | undefined) ?? [];
    return {
      title: firstString(channel.title as Node),
      items: items.map((it) => ({
        title: cleanText(firstString(it.title as Node) ?? ""),
        link: firstString(it.link as Node, (it.guid as Node)),
        summary: cleanText(
          firstString(it.description as Node, it["content:encoded"] as Node) ?? "",
        ).slice(0, SUMMARY_MAX),
        dateRaw: firstString(it.pubDate as Node, it["dc:date"] as Node),
        guid: firstString(it.guid as Node),
      })),
    };
  }

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
    return {
      title: firstString(feed.title as Node),
      items: entries.map((e) => {
        const links = (e.link as Record<string, unknown>[] | undefined) ?? [];
        const alt =
          links.find((l) => (l["@_rel"] ?? "alternate") === "alternate") ?? links[0];
        const href = alt ? (alt["@_href"] as string | undefined) : undefined;
        return {
          title: cleanText(firstString(e.title as Node) ?? ""),
          link: href ?? firstString(e.id as Node),
          summary: cleanText(
            firstString(e.summary as Node, e.content as Node) ?? "",
          ).slice(0, SUMMARY_MAX),
          dateRaw: firstString(e.published as Node, e.updated as Node),
          guid: firstString(e.id as Node),
        };
      }),
    };
  }

  throw new Error("feed has neither an rss/channel nor a feed root");
}

/** "Sat, 19 Sep 2026 18:55:59 GMT" → "2026-09-19" (UTC calendar date); null if unparseable. */
export function feedDateToIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export type KeywordFilter = {
  keywords: readonly string[];
  requiredKeywords: readonly string[];
  excludeKeywords: readonly string[];
};

/** Which of the any-of keywords hit; empty means the item is dropped. */
export function matchAdvisoryItem(item: FeedItem, filter: KeywordFilter): string[] {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  const norm = (list: readonly string[]) =>
    list.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
  const hits = norm(filter.keywords).filter((k) => hay.includes(k));
  if (hits.length === 0) return [];
  if (norm(filter.requiredKeywords).some((k) => !hay.includes(k))) return [];
  if (norm(filter.excludeKeywords).some((k) => hay.includes(k))) return [];
  return hits;
}

export function filterFromConfig(config: RssConfig): KeywordFilter {
  return {
    keywords: config.keywords && config.keywords.length > 0 ? config.keywords : DEFAULT_ADVISORY_KEYWORDS,
    requiredKeywords: config.required_keywords ?? [],
    excludeKeywords: config.exclude_keywords ?? [],
  };
}

/** Feed → advisories, pure. Exposed for tests; the adapter wraps it with the fetch. */
export function advisoriesFromFeed(feed: ParsedFeed, config: RssConfig): ParsedAdvisory[] {
  const filter = filterFromConfig(config);
  const out: ParsedAdvisory[] = [];
  for (const item of feed.items) {
    if (!item.link || item.title.length === 0) continue;
    const hits = matchAdvisoryItem(item, filter);
    if (hits.length === 0) continue;
    out.push({
      source_url: normalizeUrl(item.link),
      title: item.title,
      summary: item.summary,
      published_on: feedDateToIso(item.dateRaw),
      on_emergency_banner: false,
      raw: {
        feed_title: feed.title,
        guid: item.guid,
        pub_date_raw: item.dateRaw,
        matched_keywords: hits,
      },
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Adapter (I/O)
// --------------------------------------------------------------------------

export type RssAdapterContext = {
  fetchImpl?: typeof fetch;
};

export async function fetchRssAdvisories(
  config: RssConfig,
  ctx: RssAdapterContext = {},
): Promise<ParsedAdvisory[]> {
  const xml = await fetchText(config.feed_url, {
    fetchImpl: ctx.fetchImpl,
    useProxy: config.use_fetch_proxy ?? false,
    accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  });
  const feed = parseFeed(xml);
  if (feed.items.length === 0) {
    throw new Error(`feed ${config.feed_url} has zero items — empty or changed`);
  }
  return advisoriesFromFeed(feed, config);
}
