/**
 * Pure validation and normalization helpers for user-supplied PWSIDs.
 * Used by both the client-side WQA correction input (issue #193) and
 * the server actions that persist the corrected value. Keeping the
 * regex in one place avoids client/server drift.
 *
 * EPA's PWSID convention is a 2-letter state code plus a 7-digit
 * identifier — e.g. "MI0003520" for Kalamazoo Public Water Supply.
 * The database column carries the same CHECK constraint
 * (`~ '^[A-Z]{2}[0-9]{7}$'`), so the validator mirrors that contract
 * exactly. Normalization (uppercase + trim) runs before the regex test
 * so users typing "mi0003520" or " MI0003520 " succeed without
 * surprise.
 */

const PWSID_PATTERN = /^[A-Z]{2}[0-9]{7}$/;

/**
 * Normalize a user-supplied PWSID to the canonical persisted form.
 * Uppercases letters and trims surrounding whitespace; does NOT strip
 * internal characters — a value with a hyphen or space inside fails
 * the regex test downstream rather than being silently rewritten.
 *
 * Returns the normalized string; does not validate. Callers chain
 * `normalizePwsid` → `isValidPwsid` to make the boundaries explicit.
 */
export function normalizePwsid(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Whether a candidate string matches EPA's PWSID format. Operates on
 * the already-normalized form — callers that accept user input should
 * call `normalizePwsid` first.
 */
export function isValidPwsid(candidate: string): boolean {
  return PWSID_PATTERN.test(candidate);
}

/**
 * Parsed pieces of a valid PWSID. Surfaces the state code separately
 * so future UI can render "MI · 0003520" if useful. Returns null on
 * any invalid input — callers should normalize first and decide
 * whether they want the parsed pieces or just the validation verdict.
 */
export function parsePwsid(candidate: string):
  | { stateCode: string; identifier: string; canonical: string }
  | null {
  const normalized = normalizePwsid(candidate);
  if (!isValidPwsid(normalized)) return null;
  return {
    stateCode: normalized.slice(0, 2),
    identifier: normalized.slice(2),
    canonical: normalized,
  };
}
