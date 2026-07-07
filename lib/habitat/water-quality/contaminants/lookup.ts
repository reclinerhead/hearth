/**
 * Alias-based resolver against the WQA contaminants reference table.
 *
 * Walks every alias on every entry case-insensitively and returns the
 * first match. Designed to handle both display names ("Lead", "lead",
 * "LEAD") and the various contaminant codes upstream sources emit
 * (`"PB90"`, `"5000"`, etc.) — one function for every lookup path so
 * callers don't have to know which upstream data shape they're
 * looking at.
 *
 * CCR-printed names arrive with real-world variance (issue #303): stray
 * internal whitespace ("Cis-1,2- Dichloroethylene"), and the combined
 * name-plus-abbreviation form ("Perfluorooctanoic acid (PFOA)"). The
 * resolver normalizes whitespace around hyphens before matching, and
 * when the whole string misses, retries the base name and the
 * parenthetical separately. Normalized exact match runs first, so an
 * alias that itself contains a parenthetical ("Nitrate (as N)",
 * "Chromium (total)") keeps winning before any decomposition happens.
 *
 * Returning `null` is meaningful: it tells the caller "we don't have
 * editorial enrichment for this contaminant," which should fall back
 * to rendering the raw value with a generic label and treating it as
 * "context" tier visually.
 *
 * Same shape as `lib/habitat/contaminants/lookup.ts` (the Superfund
 * resolver) but scoped to drinking water and reading from
 * `WQA_CONTAMINANTS`.
 */

import { WQA_CONTAMINANTS, type WqaContaminant } from "./data";

/** Lowercase, collapse whitespace runs, remove spaces around hyphens. */
function normalizeAlias(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-");
}

/** Normalized alias → entry, built once. First declaration wins, matching
 *  the original walk order so existing resolutions can't change. */
let aliasIndex: Map<string, WqaContaminant> | null = null;
function getAliasIndex(): Map<string, WqaContaminant> {
  if (aliasIndex) return aliasIndex;
  aliasIndex = new Map();
  for (const entry of WQA_CONTAMINANTS) {
    for (const alias of entry.aliases) {
      const key = normalizeAlias(alias);
      if (!aliasIndex.has(key)) aliasIndex.set(key, entry);
    }
  }
  return aliasIndex;
}

export function findWqaContaminantByAlias(
  raw: string | null | undefined,
): WqaContaminant | null {
  if (typeof raw !== "string") return null;
  const needle = normalizeAlias(raw);
  if (needle.length === 0) return null;

  const index = getAliasIndex();
  const direct = index.get(needle);
  if (direct) return direct;

  // "Base name (Abbreviation)" decomposition — try the base first (more
  // specific), then the parenthetical. Only when the combined form missed.
  const m = needle.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (m) {
    const base = index.get(normalizeAlias(m[1]));
    if (base) return base;
    const abbr = index.get(normalizeAlias(m[2]));
    if (abbr) return abbr;
  }
  return null;
}
