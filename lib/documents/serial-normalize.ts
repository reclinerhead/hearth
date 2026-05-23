/**
 * Serial-number normalization for the receipt → inventory matcher
 * (issue #117). Receipts in the wild print VINs and appliance serials
 * with assorted punctuation that the user's nameplate-captured serial
 * usually doesn't have — "1HGBH41J-XMN-109186" on the receipt vs.
 * "1HGBH41JXMN109186" on the door-jamb sticker, or "ABC 123-45 / 67"
 * vs. "ABC1234567". The matcher's second pass strips punctuation and
 * whitespace and case-folds both sides before comparing.
 *
 * The matcher's first pass uses a less aggressive normalization (case
 * fold only) so a serial that genuinely contains a dash never
 * accidentally collides with a different serial that just lacks one.
 * Two passes, narrowest-wins.
 */

/**
 * Case-fold only. The lightest possible normalization — strips nothing
 * else. Used by the matcher's first pass (exact-after-case-fold).
 *
 * Returns null for empty/whitespace input so callers can short-circuit
 * before touching the database.
 */
export function caseFoldSerial(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toUpperCase();
}

/**
 * Aggressive normalization. Strips all whitespace, hyphens, dots,
 * slashes, and colons — every character likely to be a typographic
 * separator that means nothing to the underlying identifier. Used by
 * the matcher's second pass.
 *
 * Returns null for empty/whitespace input or for a normalized result
 * that ends up empty after stripping (e.g. input of pure punctuation),
 * so the matcher can avoid joining everything to everything.
 */
export function normalizeSerial(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Strip whitespace, hyphens, dots, slashes, colons. The character
  // class is whitelisted rather than catch-all-non-alphanumeric so an
  // unusual-but-legitimate identifier character (say, a Unicode digit
  // outside ASCII) survives the normalization instead of being silently
  // erased.
  const stripped = raw.replace(/[\s\-.\/:]+/g, "");
  if (stripped.length === 0) return null;
  return stripped.toUpperCase();
}
