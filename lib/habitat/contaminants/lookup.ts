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

import {
  CONTAMINANTS,
  PATHWAY_EXPLANATIONS,
  type Contaminant,
  type Pathway,
} from "./data";

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

/**
 * Collapse a site's contaminants list into the set of distinct
 * pathways those chemicals travel by. Used by the planned Superfund
 * recommended-actions logic (issue #144) to decide whether a
 * vapor-intrusion action applies to a given site, and by the
 * portfolio-summary prompt to identify the dominant pathway across
 * nearby sites.
 *
 * Unknown raw strings (no alias match) contribute nothing — the
 * function returns only pathways that some canonical-table entry
 * actually claims. Empty input or an input where every string is
 * unknown returns `[]`. Order is stable: the pathway-enum ordering
 * declared in [`data.ts`](./data.ts), so callers can render
 * deterministically across runs.
 */
export function getPathwaysForContaminants(raw: string[]): Pathway[] {
  const seen = new Set<Pathway>();
  for (const r of raw) {
    const entry = findContaminantByAlias(r);
    if (!entry) continue;
    for (const p of entry.pathways) seen.add(p);
  }
  // Stable canonical ordering so the output is deterministic regardless
  // of input order. Matches the Pathway-enum declaration order in data.ts.
  const ORDER: Pathway[] = [
    "groundwater",
    "vapor_intrusion",
    "soil_exposure",
    "surface_water",
    "airborne_particulate",
  ];
  return ORDER.filter((p) => seen.has(p));
}

/**
 * Plain-English explanation of how a pathway typically reaches a
 * homeowner. Thin wrapper over `PATHWAY_EXPLANATIONS` so callers
 * don't have to import both the map and the type from data.ts.
 */
export function getPathwayExplanation(pathway: Pathway): string {
  return PATHWAY_EXPLANATIONS[pathway];
}
