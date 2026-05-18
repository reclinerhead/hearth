/**
 * Alias-based resolver against the canonical contaminants table.
 *
 * EPA's SEMS dataset emits contaminant names in ALL CAPS with
 * inconsistent punctuation and abbreviations. Each canonical entry in
 * `./data.ts` enumerates the variants we've actually observed in the
 * `aliases` array; this lookup walks every alias case-insensitively and
 * returns the canonical entry for the first match.
 *
 * Returning `null` is meaningful: it signals "we don't have enrichment
 * for this contaminant" to the caller, which should fall back to
 * rendering the raw EPA string through the chemistry-aware formatter
 * and treat it as moderate concern visually.
 */

import { CONTAMINANTS, type Contaminant } from "./data";

export function findContaminantByAlias(raw: string): Contaminant | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  for (const entry of CONTAMINANTS) {
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === needle) return entry;
    }
  }
  return null;
}
