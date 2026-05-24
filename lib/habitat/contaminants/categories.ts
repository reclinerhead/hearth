/**
 * Plain-English category phrasing for groups of contaminants. Used by
 * multiple Superfund surfaces — the recommended-actions card
 * supporting lines (issue #144) and the overview-card subheadings
 * (issue #145) — and available to any future module that wants to
 * summarize a set of canonical-table-resolved contaminants in one
 * compact line.
 *
 * The labels are written for inline use (lowercase, no leading
 * capital) because the highest-volume caller embeds them
 * mid-sentence ("documented heavy metals and chlorinated solvents
 * that can migrate..."). Callers that want sentence-case standalone
 * phrasing (overview-card subheading) can capitalize the first
 * letter at the call site — it's a one-character transform and
 * doesn't justify a second label set.
 */

import type { Contaminant, ContaminantCategory } from "./data";

/**
 * Plain-English label per ContaminantCategory. Written lowercase for
 * inline use. Keep these tight — they end up in surfaces that already
 * carry a lot of text, and longer phrases ("polychlorinated biphenyls
 * and dibenzo-p-dioxins") would crowd the cards.
 */
export const CONTAMINANT_CATEGORY_LABELS: Record<ContaminantCategory, string> = {
  heavy_metal: "heavy metals",
  vocs: "volatile organic compounds",
  pcbs_dioxins: "PCBs and dioxins",
  pahs: "polycyclic aromatic hydrocarbons",
  pesticides: "legacy pesticides",
  pfas: "PFAS",
  industrial_chemical: "industrial chemicals",
  petroleum: "petroleum hydrocarbons",
  nutrient: "nutrients",
  common_mineral: "common minerals",
  radionuclide: "radionuclides",
};

/**
 * Editorial ordering for category-label phrasing. Higher-concern
 * families lead, so when the phrase is truncated to keep cards
 * readable, the truncation drops the least-relevant categories
 * first. Mirrors the rank ordering used inside the canonical table
 * for individual chemicals.
 */
export const CONTAMINANT_CATEGORY_PRIORITY: Record<
  ContaminantCategory,
  number
> = {
  vocs: 1,
  heavy_metal: 2,
  pcbs_dioxins: 3,
  pahs: 4,
  pfas: 5,
  pesticides: 6,
  petroleum: 7,
  industrial_chemical: 8,
  radionuclide: 9,
  nutrient: 10,
  common_mineral: 11,
};

/** Default cap on labels in a phrase before suffixing "and others." */
export const DEFAULT_MAX_CATEGORY_LABELS = 3;

/**
 * Squash a set of contaminants down to a deduplicated list of
 * category labels, sorted by editorial priority, joined with Oxford
 * commas, and truncated to `maxLabels` (default
 * `DEFAULT_MAX_CATEGORY_LABELS = 3`). Trailing "and other contaminants"
 * is appended when there were more categories than the cap.
 *
 * Returns the empty string when the input is empty — callers should
 * treat that as "nothing to render" rather than printing the empty
 * phrase. Pure given the input.
 *
 * Examples:
 *   - [Lead, Arsenic]                              → "heavy metals"
 *   - [Lead, Trichloroethene]                      → "volatile organic compounds and heavy metals"
 *   - [Lead, TCE, PCB, Atrazine, PFOA, TPH]        → "volatile organic compounds, heavy metals, and PCBs and dioxins, and other contaminants"
 */
export function summarizeContaminantCategories(
  contaminants: Contaminant[],
  options: { maxLabels?: number } = {},
): string {
  const maxLabels = options.maxLabels ?? DEFAULT_MAX_CATEGORY_LABELS;
  const categories = Array.from(
    new Set(contaminants.map((c) => c.category)),
  ).sort(
    (a, b) =>
      CONTAMINANT_CATEGORY_PRIORITY[a] - CONTAMINANT_CATEGORY_PRIORITY[b],
  );

  const truncated = categories.slice(0, maxLabels);
  const labels = truncated.map((c) => CONTAMINANT_CATEGORY_LABELS[c]);

  let phrase: string;
  if (labels.length === 0) {
    return "";
  } else if (labels.length === 1) {
    phrase = labels[0];
  } else if (labels.length === 2) {
    phrase = `${labels[0]} and ${labels[1]}`;
  } else {
    const lead = labels.slice(0, -1).join(", ");
    phrase = `${lead}, and ${labels[labels.length - 1]}`;
  }

  if (categories.length > maxLabels) {
    phrase = `${phrase}, and other contaminants`;
  }
  return phrase;
}

/**
 * Sentence-case helper for callers that want a standalone phrase
 * (overview-card subheading) rather than the inline form. Lowercase-
 * leading "PFAS" stays "PFAS" (already capitalized); regular phrases
 * get their first character upper-cased. Pure.
 */
export function capitalizeCategoryPhrase(phrase: string): string {
  if (phrase.length === 0) return phrase;
  return phrase[0].toUpperCase() + phrase.slice(1);
}
