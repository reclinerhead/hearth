/**
 * HTML parsing for the Granicus OpenCities advisory list (issue #331).
 *
 * Deliberately regex-based against the specific, server-rendered markup
 * the City of Kalamazoo's site emits — no DOM library. The markup is
 * narrow and stable enough that a real parser would buy nothing, and the
 * committed fixture under ./fixtures/ pins what "stable" means: if the
 * city changes its template, `parse.test.ts` fails before production
 * does (and the watcher's zero-entries rule alarms in production).
 *
 * Three shapes are read:
 *   - list entries:  div.list-item-container > article > a[href]
 *                       > h2.list-item-title + p
 *   - the site-wide emergency banner:
 *                    div.oc-emergency-announcement-container
 *                      > .emergency-message-box.oc-emergency-severity-NN
 *                        > h3.side-box-title, p, a[href]
 *   - the detail page's "Published on Month D, YYYY" line
 *
 * All functions here are pure.
 */

export type ListEntry = {
  href: string;
  title: string;
  summary: string;
};

export type BannerEntry = {
  href: string | null;
  title: string;
  summary: string;
  severity: number | null;
};

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

/** Decode the named and numeric entities OpenCities actually emits. */
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITY_MAP[lower] ?? match;
    },
  );
}

/** Strip tags, decode entities, collapse whitespace (and the space a
 *  stripped inline tag leaves before punctuation: "Elm St</b>." → "Elm St."). */
export function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Normalize a URL for identity comparisons (banner link ↔ list entry):
 * lowercase host, drop a trailing slash, drop fragment. Query strings
 * are kept — OpenCities doesn't use them on content URLs, and dropping
 * them could conflate genuinely different pages elsewhere.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

/**
 * Parse the advisory list entries. Returns them in page order. An entry
 * without an href or a title is skipped — both are load-bearing (the
 * href is the row identity).
 */
export function parseOpenCitiesList(html: string): ListEntry[] {
  const out: ListEntry[] = [];
  const blockRe =
    /<div class="list-item-container">([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const href = /<a\s+[^>]*href="([^"]+)"/i.exec(block)?.[1];
    const title = /<h2 class="list-item-title">([\s\S]*?)<\/h2>/i.exec(block)?.[1];
    if (!href || !title) continue;
    const summary = /<p>([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? "";
    out.push({
      href: decodeEntities(href.trim()),
      title: cleanText(title),
      summary: cleanText(summary),
    });
  }
  return out;
}

/**
 * Parse the site-wide emergency announcements. Every announcement on the
 * page is returned (including non-water ones); the caller filters by
 * link. Severity is the numeric suffix of `oc-emergency-severity-NN`.
 */
export function parseEmergencyBanner(html: string): BannerEntry[] {
  const containerStart = html.indexOf("oc-emergency-announcement-container");
  if (containerStart === -1) return [];
  const container = html.slice(containerStart);

  const out: BannerEntry[] = [];
  const boxRe =
    /emergency-message-box\s+oc-emergency-severity-(\d+)[^>]*>([\s\S]*?)<\/div>\s*(?:<button[\s\S]*?<\/button>)?\s*<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = boxRe.exec(container)) !== null) {
    const severity = Number.parseInt(m[1], 10);
    const box = m[2];
    const title = /<h3 class="side-box-title">([\s\S]*?)<\/h3>/i.exec(box)?.[1];
    if (!title) continue;
    const summary = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(box)?.[1] ?? "";
    const href = /<a\s+[^>]*href="([^"]+)"/i.exec(box)?.[1] ?? null;
    out.push({
      href: href ? decodeEntities(href.trim()) : null,
      title: cleanText(title),
      summary: cleanText(summary),
      severity: Number.isFinite(severity) ? severity : null,
    });
  }
  return out;
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/**
 * "Published on September 19, 2026" → "2026-09-19". Null when the page
 * prints no such line or the month isn't recognized. The city's date is
 * a calendar date, not an instant — we never attach a timezone.
 */
export function parsePublishedOn(html: string): string | null {
  const m = /Published on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(
    cleanText(html.slice(0, 200_000)),
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

const DETAIL_TITLE_RE =
  /<h1[^>]*class=['"][^'"]*oc-page-title[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/i;

/** The detail page's h1 (the city's page title, which can differ from the list title). */
export function parseDetailTitle(html: string): string | null {
  const m = DETAIL_TITLE_RE.exec(html);
  return m ? cleanText(m[1]) : null;
}

export const DETAIL_LEAD_MAX = 400;
const DETAIL_LEAD_BLOCKS = 2;
// How far past the h1 to look for the lead. The article body follows the
// heading directly; the bound keeps a page with no body from reading its
// footer as the lead.
const DETAIL_LEAD_SCAN = 60_000;

/**
 * The detail page's lead (issue #355): the text of the first two
 * text-bearing `h2` / `h3` / `p` blocks after the page title, skipping the
 * "Published on" line, joined with a space and capped at DETAIL_LEAD_MAX.
 * Kalamazoo prepends its updates here ("This advisory has been lifted.",
 * "Sunday, September 20 Update: …"), so the lead is where an in-place edit
 * shows first. Null when the title or any body text is missing.
 */
export function parseDetailLead(html: string): string | null {
  const titleMatch = DETAIL_TITLE_RE.exec(html);
  if (!titleMatch) return null;
  const start = titleMatch.index + titleMatch[0].length;
  const region = html.slice(start, start + DETAIL_LEAD_SCAN);

  const blockRe = /<(h2|h3|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(region)) !== null && blocks.length < DETAIL_LEAD_BLOCKS) {
    if (/published-on/i.test(m[2])) continue;
    const text = cleanText(m[3]);
    if (text.length === 0) continue;
    blocks.push(text);
  }
  if (blocks.length === 0) return null;
  return blocks.join(" ").slice(0, DETAIL_LEAD_MAX).trim();
}
