/**
 * Personalization layer over the static remediation matrix.
 *
 * Two pure functions (epic #165, WQA-5):
 *
 *   personalizeRemediationMatrix — resolves the user's detected
 *     contaminants onto matrix rows, marking which rows are "in your
 *     water" and building each row's context label. Drives the amber
 *     highlighting in the matrix view.
 *
 *   recommendRemediationCombination — selects the concrete product
 *     combination to put in front of the user: an under-sink carbon
 *     block as the primary (the broad single-device answer), with the
 *     NSF certifications it should carry, the count of detected
 *     contaminants it covers, and an optional reverse-osmosis add-on
 *     when something carbon can't handle (fluoride, arsenic, nitrate)
 *     was detected.
 *
 * Both are deterministic given their inputs and carry no I/O — they're
 * the tested core of WQA-5. The static cost figures are intentionally
 * coarse ("~$200") ballparks, not quotes.
 */

import {
  REMEDIATION_MATRIX,
  type RemediationRow,
} from "./matrix";

/**
 * One detected contaminant, normalized from whichever source surfaced
 * it. On the `cws_with_ccr` branch these come from the CCR's contaminant
 * table; on `cws_no_ccr` / `non_community` they come from the SDWIS
 * lead/copper samples. `code` carries an optional source code (SDWIS
 * contaminant code, LCR rollup code) so a row that only matches by code
 * still resolves. `level_label` is a pre-formatted "9 ppb" the caller
 * built from the source units; we don't re-derive units here.
 */
export type DetectedContaminantInput = {
  name: string;
  code?: string | null;
  level_label?: string | null;
};

/** One row of the personalized matrix: the static row + detection state. */
export type PersonalizedRemediationRow = {
  row: RemediationRow;
  detected: boolean;
  /**
   * What to show under the row label. "<level> · in your water" when
   * detected with a level, "Detected · in your water" when detected
   * without a clean single level (e.g. PFAS reported as several
   * species), otherwise the row's neutral `default_context`.
   */
  context_label: string;
};

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Which matrix row, if any, a detected contaminant resolves to. Exact
 * (normalized) match against the row's alias union, by name first then
 * by code. Null when nothing in the matrix covers it (e.g. copper,
 * which the matrix deliberately omits — see matrix.ts).
 *
 * Exported for the test suite.
 */
export function matchRemediationRow(
  detected: DetectedContaminantInput,
): RemediationRow | null {
  const name = normalize(detected.name);
  const code = normalize(detected.code);
  for (const row of REMEDIATION_MATRIX) {
    for (const alias of row.match_aliases) {
      const a = normalize(alias);
      if (a.length === 0) continue;
      if (name === a || (code.length > 0 && code === a)) return row;
    }
  }
  return null;
}

/**
 * Resolve detected contaminants onto every matrix row. Returns all
 * rows in matrix order (the view always renders the full grid), each
 * flagged with whether the user has it and what context line to show.
 *
 * A row counts as detected when ANY detected contaminant maps to it.
 * When exactly one maps and it has a level, that level drives the
 * context label; when several map (PFOA + PFOS → the PFAS row) we fall
 * back to "Detected" rather than arbitrarily picking one species'
 * number.
 */
export function personalizeRemediationMatrix(
  detected: DetectedContaminantInput[],
): PersonalizedRemediationRow[] {
  // Collect, per row key, the detected inputs that mapped to it.
  const hits = new Map<string, DetectedContaminantInput[]>();
  for (const d of detected) {
    const row = matchRemediationRow(d);
    if (!row) continue;
    const existing = hits.get(row.key);
    if (existing) existing.push(d);
    else hits.set(row.key, [d]);
  }

  return REMEDIATION_MATRIX.map((row) => {
    const mapped = hits.get(row.key);
    if (!mapped || mapped.length === 0) {
      return { row, detected: false, context_label: row.default_context };
    }
    const withLevel = mapped.filter((d) => Boolean(d.level_label));
    const context_label =
      mapped.length === 1 && withLevel.length === 1
        ? `${withLevel[0].level_label} · in your water`
        : "Detected · in your water";
    return { row, detected: true, context_label };
  });
}

/** A treatment recommendation card on the matrix view. */
export type RemediationPrimaryRecommendation = {
  /** "Under-sink carbon block" */
  label: string;
  /** Certs the unit should carry — includes "NSF P473" iff PFAS detected. */
  nsf_standards: string[];
  /** Display labels of the detected contaminants this device fully covers. */
  covered: string[];
  covered_count: number;
  detected_count: number;
  /** Coarse ballpark, not a quote. */
  cost_install: string;
  cost_ongoing: string;
};

export type RemediationRoAddon = {
  label: string;
  /** Detected contaminants that drove the add-on (fluoride/arsenic/nitrate). */
  reason_contaminants: string[];
  /**
   * True when the ONLY driver is fluoride — which is intentionally
   * added for dental health, so removing it is a personal/values call
   * rather than a health necessity. Flips the card's framing.
   */
  values_based: boolean;
  cost_install: string;
  cost_ongoing: string;
};

export type RemediationCombination = {
  primary: RemediationPrimaryRecommendation;
  ro_addon: RemediationRoAddon | null;
  /**
   * Detected whole-house problems (hardness, iron) that a tap filter
   * can't and shouldn't address — surfaced so the matrix view can say
   * "…except hardness, which is handled separately."
   */
  handled_separately: string[];
};

// Detected contaminants that carbon block can't fully handle but RO
// can — the trigger set for the RO add-on. Whole-house problems
// (hardness/iron) are deliberately excluded; they route to a softener,
// not point-of-use RO.
const RO_ADDON_ROW_KEYS = new Set(["fluoride", "arsenic", "nitrate"]);

/**
 * Select the recommended product combination for the user's detected
 * contaminants. Carbon block is always the primary (it's the broad,
 * inexpensive single-device answer); the RO add-on appears only when a
 * detected contaminant in {fluoride, arsenic, nitrate} needs it.
 *
 * `detected_count` counts only contaminants that map to a matrix row,
 * so the "covers N of M" framing stays honest (copper, which has no
 * row, is neither counted nor claimed as covered).
 */
export function recommendRemediationCombination(
  detected: DetectedContaminantInput[],
): RemediationCombination {
  const personalized = personalizeRemediationMatrix(detected);
  const detectedRows = personalized.filter((p) => p.detected).map((p) => p.row);

  const pfasDetected = detectedRows.some((r) => r.key === "pfas");
  const nsf_standards = pfasDetected
    ? ["NSF/ANSI 53", "NSF P473"]
    : ["NSF/ANSI 53"];

  const covered = detectedRows
    .filter((r) => r.effectiveness.carbon_block === "full")
    .map((r) => r.label);

  const primary: RemediationPrimaryRecommendation = {
    label: "Under-sink carbon block",
    nsf_standards,
    covered,
    covered_count: covered.length,
    detected_count: detectedRows.length,
    cost_install: "~$200 install",
    cost_ongoing: "~$60/yr cartridges",
  };

  const roReasonRows = detectedRows.filter((r) => RO_ADDON_ROW_KEYS.has(r.key));
  const ro_addon: RemediationRoAddon | null =
    roReasonRows.length > 0
      ? {
          label:
            roReasonRows.length === 1 && roReasonRows[0].key === "fluoride"
              ? "Add RO if removing fluoride"
              : "Add reverse osmosis",
          reason_contaminants: roReasonRows.map((r) => r.label),
          values_based:
            roReasonRows.length === 1 && roReasonRows[0].key === "fluoride",
          cost_install: "~$350 install",
          cost_ongoing: "~$100/yr membranes & filters",
        }
      : null;

  const handled_separately = detectedRows
    .filter((r) => r.install === "whole_house")
    .map((r) => r.label);

  return { primary, ro_addon, handled_separately };
}
