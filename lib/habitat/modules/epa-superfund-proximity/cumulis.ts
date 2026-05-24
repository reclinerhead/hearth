/**
 * EPA Cumulis profile-page helpers (issue #143).
 *
 * The structured Envirofacts REST API exposes only the base site record —
 * address, NPL status, archived flag, region, federal-facility indicator.
 * The fields that make a homeowner-facing UI actually useful (the
 * Community Involvement Coordinator contact, the per-site documents
 * library) live on the rendered Cumulis profile pages and aren't
 * available through any sibling table in the SEMS schema. This module
 * carries the small per-site scrape that fills the gap.
 *
 * Two pieces:
 *   - `siteDocumentsUrl(siteId)`: deterministic URL build — no scraping,
 *     no HTTP, the EPA path pattern is stable.
 *   - `fetchSiteContacts(siteId)`: GETs the Contacts sub-page, parses the
 *     Community Involvement Coordinator block, returns it (or null when
 *     EPA hasn't designated one — the Peerless Plating Co. case in our
 *     test sample).
 *
 * Soft-fail by design throughout: a Cumulis fetch failure or a parse
 * miss leaves the CIC field null on the site entry. The check() flow
 * still ships the finding with the rest of the data intact.
 *
 * **EPA site_id format note.** site_ids arrive from Envirofacts
 * zero-padded ("0503011"). The Cumulis URL handlers REQUIRE the
 * zero-padded form — the older `cursites/csitinfo.cfm` URL is
 * forgiving of the padded form but returns "No site is found" when
 * the leading zero is stripped. The older code in fetch.ts that
 * stripped the leading zero was producing 404 URLs in production; the
 * fix lives alongside this module's URL helpers so the canonical
 * pattern is enforced in one place.
 */

const CUMULIS_BASE = "https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Canonical Cumulis "Site Profile" overview URL for a given site_id.
 * Use this in user-facing "View on EPA's site" links — it's the URL
 * EPA's own navigation generates and the one Cumulis canonicalizes to.
 *
 * The legacy `cursites/csitinfo.cfm?id=...` URL also works when given
 * the zero-padded id, but it's a redirect target and not the form
 * EPA's UI publishes. Pin to the canonical form so deep links stay
 * stable as EPA rearranges legacy paths.
 */
export function siteProfileUrl(siteId: string): string {
  return `${CUMULIS_BASE}?fuseaction=second.scs&id=${encodeURIComponent(siteId)}`;
}

/** Deep link to the site's documents library on Cumulis. Deterministic. */
export function siteDocumentsUrl(siteId: string): string {
  return `${CUMULIS_BASE}?fuseaction=second.docdata&id=${encodeURIComponent(siteId)}`;
}

/** Deep link to the site's contacts page. Used by the fetcher below. */
export function siteContactsUrl(siteId: string): string {
  return `${CUMULIS_BASE}?fuseaction=second.contacts&id=${encodeURIComponent(siteId)}`;
}

/**
 * Community Involvement Coordinator contact pulled from a Cumulis
 * Contacts page. Every field is independently nullable — most sites
 * publish name + email; phone is occasionally absent; some sites have
 * no CIC entry at all (in which case the parser returns null).
 */
export type CommunityInvolvementCoordinator = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Parse the CIC block out of a Cumulis Contacts page's HTML. Returns
 * null when no CIC entry is present (the page may still list a
 * Remedial Project Manager — that's the technical-cleanup contact,
 * not the community-facing one, and not what we surface to homeowners).
 *
 * The block we're looking for, observed verbatim across sampled MI
 * Final-NPL sites in November 2025:
 *
 *     <b>
 *         Community Involvement Coordinator:
 *     </b><br>
 *     <p>
 *     Kirstin&nbsp;Safakas
 *     <br><a href="mailto:Safakas.Kirstin@epa.gov">Safakas.Kirstin@epa.gov</a>
 *
 * Names use a non-breaking space (`&nbsp;`) between first and last; we
 * normalize that to a regular space. Phone numbers, when present, sit
 * inside the same <p> on their own line — we extract the first
 * North-American-style number we find. Email is always inside the
 * mailto: link.
 *
 * Pure given the input — no HTTP, no DOM, just regex over a string.
 * Easy to unit-test against fixture HTML.
 */
export function parseCommunityInvolvementCoordinator(
  html: string,
): CommunityInvolvementCoordinator | null {
  // Find the "Community Involvement Coordinator:" label and grab the
  // chunk that follows up to the next <b> (start of the next role's
  // block) or a sensible closing tag. The /is flags make . match
  // newlines and the match case-insensitive (EPA capitalizes the
  // label consistently today but we don't want a stray edit to break
  // the parser).
  const blockMatch = html.match(
    /Community Involvement Coordinator:\s*<\/b>\s*<br>\s*<p>([\s\S]*?)(?=<b>|<\/p>|<\/td>|<\/div>)/i,
  );
  if (!blockMatch) return null;
  const block = blockMatch[1];

  // Email comes from the first mailto: link in the block.
  const emailMatch = block.match(/<a\s+href="mailto:([^"]+)"/i);
  const email = emailMatch ? decodeEntities(emailMatch[1].trim()) : null;

  // Name is the first non-empty line of text content before the first
  // <a> or <br>. Strip tags AND decode entities — EPA's pages put
  // `&nbsp;` between first and last name, which has to become a
  // regular space before the display layer can render it sensibly.
  const beforeFirstLink = block.split(/<a\s/i)[0] ?? "";
  const nameText = decodeEntities(stripTags(beforeFirstLink));
  // Some sites print the name as "FIRST LAST" all-caps; others as
  // "First Last". Pass through verbatim — the display layer keeps
  // EPA's casing rather than re-titlecasing.
  const name = nameText.length > 0 ? nameText : null;

  // Phone: first North American style number anywhere in the block.
  // EPA's format is "(312) 886-6015" — accept variants defensively.
  const phoneMatch = block.match(
    /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
  );
  const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : null;

  // If the block existed but every field came out empty, treat as
  // "no CIC" rather than returning a row of nulls — keeps the display
  // layer's null check the single source of truth for "no contact."
  if (!name && !email && !phone) return null;

  return { name, email, phone };
}

/**
 * Fetch + parse a site's Contacts page. Soft-fail at every step —
 * network errors, non-2xx responses, parse failures all return null
 * rather than throwing. The Superfund check() flow enriches each
 * qualifying site in parallel and a single failed lookup must not
 * fail the whole module run.
 */
export type FetchSiteContactsOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchSiteContacts(
  siteId: string,
  options: FetchSiteContactsOptions = {},
): Promise<CommunityInvolvementCoordinator | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = siteContactsUrl(siteId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return parseCommunityInvolvementCoordinator(html);
  } catch {
    // Timeout, network error, parser threw — all collapse to null.
    // The caller's activity log step surfaces the count of sites
    // that resolved with a CIC vs. those that didn't so we don't
    // silently swallow the signal entirely.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip HTML tags. Crude — enough for the CIC block, which is
 * structurally simple, and we don't want a full HTML parser in the
 * dependency tree for two fields. The parser only ever sees content
 * EPA generated server-side from a CMS template, so the tag shapes
 * we encounter are bounded.
 */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ");
}

/**
 * Decode the small set of HTML entities EPA's pages emit. We see
 * `&nbsp;` (non-breaking space between first and last name) and a
 * few of the common XML entities; the parser doesn't need a full
 * entity table.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonicalize a phone number string to the EPA-display shape
 * `(NNN) NNN-NNNN`. Accepts the few variants we've seen — spaces,
 * dashes, dots — and falls back to the input when it doesn't fit.
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return raw.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
