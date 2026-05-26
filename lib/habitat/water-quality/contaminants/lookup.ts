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

export function findWqaContaminantByAlias(
  raw: string | null | undefined,
): WqaContaminant | null {
  if (typeof raw !== "string") return null;
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) return null;
  for (const entry of WQA_CONTAMINANTS) {
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === needle) return entry;
    }
  }
  return null;
}
