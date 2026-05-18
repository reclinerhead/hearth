/**
 * String-formatting helpers for the EPA Superfund Proximity module.
 *
 * EPA Envirofacts SEMS returns every text field in ALL CAPS — site names,
 * street addresses, city, county, contaminant names, everything. We need
 * user-facing copy to read naturally, so each module that touches SEMS
 * data flows it through titleCase() (or one of the specialized helpers)
 * before assembling a finding.
 */

/**
 * Acronyms and initialisms that should stay all-caps even inside a
 * title-cased phrase. Conservative on purpose — short tokens that
 * collide with real words (e.g. "INN", "ACE") are deliberately
 * excluded. Add entries only when the SEMS data demonstrably calls
 * for them.
 */
const KEEP_UPPER = new Set([
  // Business / legal suffixes that read better as initialisms.
  "LLC",
  "LP",
  "LLP",
  "PLC",
  // US-government acronyms that appear in SEMS site names.
  "USA",
  "USN",
  "USAF",
  "USMC",
  "USCG",
  "USDA",
  "DOD",
  "DOE",
  "DOJ",
  "DOI",
  "DOT",
  "EPA",
  "GSA",
  "NASA",
  "TVA",
  // Roman numerals up to VIII (common as plant / facility designations).
  "II",
  "III",
  "IV",
  "VI",
  "VII",
  "VIII",
  "IX",
  "XI",
  "XII",
  // Contaminant abbreviations that appear in EPA contaminant lists.
  "PCB",
  "PCBS",
  "PCE",
  "TCE",
  "VOC",
  "VOCS",
  "PFAS",
  "MTBE",
  "PAH",
  "PAHS",
  "BTEX",
  "DDT",
  "DNT",
]);

/**
 * Tokens that title-case to a properly-capitalized form rather than
 * staying all-caps. "INC" → "Inc." is the canonical example. The key
 * is the ALL-CAPS source token; the value is the rendered form
 * (without any trailing punctuation — that's preserved separately by
 * the caller).
 */
const PROPER_CAP: Record<string, string> = {
  INC: "Inc",
  CORP: "Corp",
  CO: "Co",
  LTD: "Ltd",
};

/**
 * Minor words that drop to lowercase when they appear in the middle of
 * a phrase, not at the start.
 */
const MINOR_WORDS = new Set([
  "of",
  "the",
  "and",
  "or",
  "in",
  "on",
  "at",
  "to",
  "by",
  "for",
  "a",
  "an",
  "as",
  "but",
]);

/**
 * Capitalize a single alphabetic word according to title-case rules.
 * `position` is 0 for the first word in a phrase (always capitalized),
 * positive otherwise (minor words drop to lowercase).
 */
function capitalizeWord(word: string, position: number): string {
  if (!word) return word;
  const upper = word.toUpperCase();

  if (KEEP_UPPER.has(upper)) return upper;

  if (Object.prototype.hasOwnProperty.call(PROPER_CAP, upper)) {
    return PROPER_CAP[upper];
  }

  const lower = word.toLowerCase();
  if (position > 0 && MINOR_WORDS.has(lower)) return lower;

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Title-case a string. Designed for ALL-CAPS input from EPA SEMS but
 * handles mixed-case input cleanly too. Preserves whitespace, slashes,
 * hyphens, periods, and commas — those split the phrase into
 * sub-tokens and each is capitalized in isolation.
 *
 * Examples:
 *   "YANKEE ELECTRONIC SERVICES, INC."     → "Yankee Electronic Services, Inc."
 *   "ALLIED PAPER INC./PORTAGE CREEK"      → "Allied Paper Inc./Portage Creek"
 *   "143 GRASSY PLAIN"                      → "143 Grassy Plain"
 *   "DOT FACILITY"                          → "DOT Facility"
 *   "USN BASE"                              → "USN Base"
 *   "ABC, LLC"                              → "Abc, LLC"
 *   "POLYCHLORINATED BIPHENYLS"             → "Polychlorinated Biphenyls"
 */
export function titleCase(input: string | null | undefined): string {
  if (input == null) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Split into a sequence of (word, separator) chunks. A "word" is a
  // maximal run of [A-Za-z0-9]; everything else is a separator. We
  // track word position so the first word and post-separator words can
  // be capitalized appropriately, while internal minor words drop to
  // lowercase.
  const tokens: string[] = trimmed.split(/([^A-Za-z0-9]+)/);

  let position = 0;
  const out: string[] = [];
  for (const tok of tokens) {
    if (!tok) continue;
    if (/^[^A-Za-z0-9]+$/.test(tok)) {
      out.push(tok);
      continue;
    }
    // Numeric-only tokens pass through unchanged.
    if (/^[0-9]+$/.test(tok)) {
      out.push(tok);
      position++;
      continue;
    }
    out.push(capitalizeWord(tok, position));
    position++;
  }
  return out.join("");
}

/**
 * Title-case a list of contaminant names returned by SEMS. Each entry
 * is title-cased; empty/null entries are filtered out; duplicates
 * (after normalization) are dropped while preserving first-seen order.
 */
export function formatContaminants(
  names: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const cased = titleCase(raw);
    if (!cased) continue;
    const key = cased.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cased);
  }
  return out;
}

/**
 * Round a distance in miles to 1 decimal place for display and storage.
 * Sub-mile precision in this module's source data is already noisy —
 * EPA distributes a single representative point per site, not the
 * polygon — so 1-decimal display is honest about how exact the number is.
 */
export function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10;
}

/**
 * Long-form direction word for a 16-point compass bearing, used in
 * narration / summary copy. ("N" → "north", "NNE" → "north-northeast".)
 */
export function bearingWord(bearing: string): string {
  switch (bearing) {
    case "N":
      return "north";
    case "NNE":
      return "north-northeast";
    case "NE":
      return "northeast";
    case "ENE":
      return "east-northeast";
    case "E":
      return "east";
    case "ESE":
      return "east-southeast";
    case "SE":
      return "southeast";
    case "SSE":
      return "south-southeast";
    case "S":
      return "south";
    case "SSW":
      return "south-southwest";
    case "SW":
      return "southwest";
    case "WSW":
      return "west-southwest";
    case "W":
      return "west";
    case "WNW":
      return "west-northwest";
    case "NW":
      return "northwest";
    case "NNW":
      return "north-northwest";
    default:
      return bearing.toLowerCase();
  }
}
