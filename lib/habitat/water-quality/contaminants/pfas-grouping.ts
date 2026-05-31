/**
 * PFAS-family grouping for "Detected in your water" surfaces.
 *
 * Shared, pure, and dependency-light on purpose: both the Water Quality
 * Report (`lib/reports/water-quality/report.ts`, issue #234) and the
 * findings modal (`overview-body.tsx`, issue #239) fold detected PFAS
 * analytes into a single family entry, and they must agree on what counts
 * as PFAS and how it's positioned. This module is the single source of that
 * logic so the two surfaces can't drift.
 *
 * It lives here — not in `report.ts` — because the modal is a client
 * component and `report.ts` transitively imports `node:crypto` (via the
 * cache-signature helper), which can't go in a browser bundle. This module
 * imports only `PFAS_NAME_HINTS` + the contaminant type.
 *
 * It is NOT grouping in `buildDisplayedCcrContaminants` or the persisted
 * payload — the remediation matrix's `deriveDetectedContaminants` reads the
 * CCR sections itself and must not be pre-merged (#224 contract). Grouping
 * is a presentation decision each list-rendering surface makes for itself.
 */

import {
  PFAS_NAME_HINTS,
  type CcrSummarizedContaminant,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";

/**
 * Plain-language heading for the PFAS family card (issue #234 open
 * question 1). The body and EPA link come from the "PFAS" family reference
 * entry in `data.ts`; the heading is a presentation choice and lives here so
 * both surfaces share it.
 */
export const PFAS_FAMILY_HEADING = "PFAS — the “forever chemicals”";

/**
 * Is this contaminant a PFAS-family analyte? Uses the SAME hint list the
 * summarizer uses to floor PFAS at the caution tier, so the rendering
 * surfaces and the summarizer never disagree on what counts as PFAS.
 */
export function isPfasName(name: string): boolean {
  const n = name.toLowerCase();
  return PFAS_NAME_HINTS.some((hint) => n.includes(hint));
}

/**
 * One entry in a "Detected in your water" list: either a normal single
 * contaminant, or the PFAS family (2+ analytes folded into one card).
 */
export type AwarenessItem =
  | { kind: "single"; contaminant: CcrSummarizedContaminant }
  | { kind: "pfasFamily"; analytes: CcrSummarizedContaminant[] };

/**
 * Fold PFAS-family analytes into a single family entry, in place, at the
 * position of the first PFAS row (preserving the input ordering for
 * everything else). With 0 or 1 PFAS rows the list is returned unchanged —
 * a lone analyte renders as a normal row, no empty family wrapper.
 *
 * Analytes within the family are ordered by detected level, descending, so
 * the largest number leads.
 */
export function groupPfasFamily(
  contaminants: CcrSummarizedContaminant[],
): AwarenessItem[] {
  const pfasCount = contaminants.filter((c) => isPfasName(c.contaminant_name)).length;
  if (pfasCount < 2) {
    return contaminants.map((contaminant) => ({ kind: "single", contaminant }));
  }

  const analytes = contaminants
    .filter((c) => isPfasName(c.contaminant_name))
    .sort((a, b) => (b.detected_level ?? -Infinity) - (a.detected_level ?? -Infinity));

  const items: AwarenessItem[] = [];
  let familyEmitted = false;
  for (const c of contaminants) {
    if (isPfasName(c.contaminant_name)) {
      if (!familyEmitted) {
        items.push({ kind: "pfasFamily", analytes });
        familyEmitted = true;
      }
      continue; // subsequent PFAS rows are folded into the family entry
    }
    items.push({ kind: "single", contaminant: c });
  }
  return items;
}
