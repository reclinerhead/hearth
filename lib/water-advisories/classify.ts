/**
 * Status + scope classification for a parsed advisory (issue #331).
 *
 * Pure. The rules are deliberately simple and biased toward
 * over-notifying: an advisory we can't place ends up `unknown`, and the
 * planner treats unknown scope as district-wide. The failure mode we
 * accept is one extra email, never a missed city-wide advisory.
 *
 * Scope precedence:
 *   1. on the site-wide emergency banner          → system_wide
 *   2. title/summary matches a system-wide phrase → system_wide
 *   3. the title's subject looks like a street or
 *      house-number list                          → localized
 *   4. otherwise                                  → unknown
 *
 * The generic phrase list below is city-agnostic; a source can add its
 * own wording via `config.system_wide_phrases` (Kalamazoo: "City of
 * Kalamazoo water customers").
 */

import type {
  AdvisoryDetail,
  AdvisoryScope,
  AdvisoryStatus,
  ClassifiedAdvisory,
  ParsedAdvisory,
} from "./types";

export const DEFAULT_SYSTEM_WIDE_PHRASES: readonly string[] = [
  "pressure district",
  "all customers",
  "all water customers",
  "city-wide",
  "citywide",
  "entire city",
];

export type ClassifyOptions = {
  /** Extra district-wide phrases from the source's config. */
  systemWidePhrases?: readonly string[];
};

const STREET_TOKEN =
  /\b(st|street|ave|avenue|dr|drive|rd|road|ct|court|ln|lane|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|trl|trail|hwy|highway|pkwy|parkway)\b\.?/i;
const HOUSE_NUMBER_RANGE = /\b\d{2,5}\s*(?:–|-|to|through)\s*\d{2,5}\b/i;
const HOUSE_NUMBER_LIST = /\b\d{3,5},\s*(?:\d{3,5}|and\b)/i;

const TITLE_LIFTED = /\b(lifted|rescinded)\b/;
// "This advisory has been lifted." with a title that doesn't say so.
const BODY_LIFTED = /\b(has been|is|was) (lifted|rescinded)\b/;

/**
 * Status from the title, then the summary. When the advisory's own page
 * has been read (`detail`), its heading and lead are checked for a lift
 * FIRST: Kalamazoo lifts an advisory by editing that page in place while
 * the list entry keeps its original wording (issue #355). Everything
 * other than "lifted" still reads the list fields only.
 */
export function classifyStatus(
  title: string,
  summary: string,
  detail?: AdvisoryDetail,
): AdvisoryStatus {
  const t = title.toLowerCase();
  const s = summary.toLowerCase();
  if (detail) {
    if (detail.title && TITLE_LIFTED.test(detail.title.toLowerCase())) return "lifted";
    if (detail.lead && BODY_LIFTED.test(detail.lead.toLowerCase())) return "lifted";
  }
  if (TITLE_LIFTED.test(t)) return "lifted";
  if (BODY_LIFTED.test(s)) return "lifted";
  if (/\bscheduled\b/.test(t)) return "scheduled";
  if (/\b(advisory|order|notice|do not (drink|use))\b/.test(t)) return "active";
  return "unknown";
}

/** The part of the title after the first colon, or the whole title. */
function titleSubject(title: string): string {
  const idx = title.indexOf(":");
  return idx === -1 ? title : title.slice(idx + 1);
}

export function classifyScope(
  advisory: Pick<ParsedAdvisory, "title" | "summary" | "on_emergency_banner">,
  options: ClassifyOptions = {},
): AdvisoryScope {
  if (advisory.on_emergency_banner) return "system_wide";

  const haystack = `${advisory.title} ${advisory.summary}`.toLowerCase();
  const phrases = [
    ...DEFAULT_SYSTEM_WIDE_PHRASES,
    ...(options.systemWidePhrases ?? []),
  ];
  for (const phrase of phrases) {
    const p = phrase.trim().toLowerCase();
    if (p.length > 0 && haystack.includes(p)) return "system_wide";
  }

  const subject = titleSubject(advisory.title);
  if (
    STREET_TOKEN.test(subject) ||
    HOUSE_NUMBER_RANGE.test(subject) ||
    HOUSE_NUMBER_LIST.test(subject)
  ) {
    return "localized";
  }

  return "unknown";
}

export function classify(
  advisory: ParsedAdvisory,
  options: ClassifyOptions = {},
): ClassifiedAdvisory {
  return {
    ...advisory,
    status: classifyStatus(advisory.title, advisory.summary, advisory.detail),
    scope: classifyScope(advisory, options),
  };
}
