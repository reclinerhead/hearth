/**
 * Water-property extraction for the maintenance bridge (epic #165, WQA-6).
 *
 * Pulls the water-touching properties — hardness, iron, manganese — a
 * homeowner's CCR reports, normalizes them, and classifies hardness, so
 * the maintenance-synthesis bridge can adapt water-touching equipment
 * cadences (anode-rod inspection, softener resin, dishwasher rinse-aid,
 * faucet aerator) and the WQA panel's "AUTOMATIC" card can name what
 * was detected.
 *
 * **These are NOT a dedicated CCR extraction field.** Hardness/iron are
 * secondary (aesthetic) parameters, not part of the federally regulated
 * set. They ride opportunistically in `ccr_findings.contaminants` — the
 * extraction prompt captures every measured row in the CCR's tables, so
 * hardness/iron land there as `context`-tier rows *when the utility
 * prints them* (many do, many don't). This reader pulls them back out
 * by name. The reliable-but-heavier alternative — a dedicated
 * normalized `secondary_parameters` section on the CCR schema — is
 * deliberately deferred (issue #226 decision); this opportunistic path
 * ships the value now and is forward-compatible (the same
 * `WaterProperties` shape would be populated either way).
 *
 * Pure. Returns null when the CCR didn't report any water-touching
 * property, so callers can suppress the bridge cleanly.
 */

import type { CcrFindings, CcrSummarizedContaminant } from "./ccr";

/**
 * USGS/EPA hardness classification, in mg/L as CaCO₃:
 *   soft        < 60
 *   moderate    60–120
 *   hard        120–180
 *   very hard   > 180
 */
export type HardnessClass = "soft" | "moderate" | "hard" | "very_hard";

export type WaterHardness = {
  /** Normalized to mg/L as CaCO₃ (the canonical hardness unit). */
  mg_l_caco3: number;
  /** Same value in grains/gallon (the unit US softener specs use). */
  grains_per_gallon: number;
  classification: HardnessClass;
  /** The value + unit as printed in the CCR, for provenance. */
  raw_label: string;
};

export type WaterMetal = {
  detected: boolean;
  /** mg/L when the CCR printed the level in mg/L or ppm; null otherwise. */
  mg_l: number | null;
  raw_label: string;
};

export type WaterProperties = {
  hardness: WaterHardness | null;
  iron: WaterMetal | null;
  manganese: WaterMetal | null;
  /**
   * Whether any property carries a cadence-relevant signal — hardness
   * at moderate-or-above, or iron/manganese detected. Drives both the
   * summary-sentence enrichment (so the synthesis only sees it when
   * it's actionable) and the AUTOMATIC card's fire condition.
   */
  affects_maintenance: boolean;
};

/** 1 grain/gallon = 17.118 mg/L as CaCO₃. */
const GRAINS_TO_MG_L = 17.118;

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Convert a printed hardness value to mg/L as CaCO₃. CCRs print
 * hardness either in mg/L (≡ ppm ≡ "mg/L as CaCO₃") or in grains per
 * gallon ("gpg", "grains/gallon"). Exported for the test suite.
 */
export function hardnessToMgL(value: number, unit: string | null): number {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("grain") || u.includes("gpg")) return value * GRAINS_TO_MG_L;
  return value;
}

/** Classify hardness by mg/L as CaCO₃. Exported for the test suite. */
export function classifyHardness(mgL: number): HardnessClass {
  if (mgL < 60) return "soft";
  if (mgL < 120) return "moderate";
  if (mgL < 180) return "hard";
  return "very_hard";
}

function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function rawLabel(row: CcrSummarizedContaminant): string {
  if (row.detected_level === null) return "";
  return row.unit ? `${row.detected_level} ${row.unit}` : `${row.detected_level}`;
}

function findRow(
  rows: CcrSummarizedContaminant[],
  test: RegExp,
): CcrSummarizedContaminant | null {
  return rows.find((r) => test.test(normalize(r.contaminant_name))) ?? null;
}

function readMetal(row: CcrSummarizedContaminant | null): WaterMetal | null {
  if (!row) return null;
  const level = row.detected_level;
  const detected = level !== null && level > 0;
  if (!detected) return null;
  const u = (row.unit ?? "").toLowerCase();
  const mg_l = u.includes("mg/l") || u.includes("ppm") ? level : null;
  return { detected: true, mg_l, raw_label: rawLabel(row) };
}

export function extractWaterProperties(
  ccr: CcrFindings | null,
): WaterProperties | null {
  const rows = ccr?.contaminants;
  if (!rows || rows.length === 0) return null;

  const hardnessRow = findRow(rows, /hardness/);
  const ironRow = findRow(rows, /\biron\b/);
  const manganeseRow = findRow(rows, /\bmanganese\b/);

  let hardness: WaterHardness | null = null;
  if (
    hardnessRow &&
    hardnessRow.detected_level !== null &&
    hardnessRow.detected_level > 0
  ) {
    const mgL = hardnessToMgL(hardnessRow.detected_level, hardnessRow.unit);
    hardness = {
      mg_l_caco3: round(mgL),
      grains_per_gallon: round(mgL / GRAINS_TO_MG_L, 1),
      classification: classifyHardness(mgL),
      raw_label: rawLabel(hardnessRow),
    };
  }

  const iron = readMetal(ironRow);
  const manganese = readMetal(manganeseRow);

  if (!hardness && !iron && !manganese) return null;

  const affects_maintenance =
    (hardness !== null && hardness.classification !== "soft") ||
    iron !== null ||
    manganese !== null;

  return { hardness, iron, manganese, affects_maintenance };
}

/**
 * The bare noun phrase describing the cadence-relevant water properties
 * — e.g. "moderately hard water (about 7 grains per gallon) with
 * detectable iron". Returns "" when nothing cadence-relevant is present.
 * Shared by the summary sentence and the AUTOMATIC card so they never
 * drift. Exported for the test suite.
 */
export function waterPropertiesPhrase(
  properties: WaterProperties | null,
): string {
  if (!properties || !properties.affects_maintenance) return "";

  const parts: string[] = [];
  if (properties.hardness && properties.hardness.classification !== "soft") {
    const word =
      properties.hardness.classification === "moderate"
        ? "moderately hard"
        : properties.hardness.classification === "hard"
          ? "hard"
          : "very hard";
    parts.push(`${word} water (about ${properties.hardness.grains_per_gallon} grains per gallon)`);
  }
  const metals: string[] = [];
  if (properties.iron) metals.push("iron");
  if (properties.manganese) metals.push("manganese");
  if (metals.length > 0) {
    parts.push(`detectable ${metals.join(" and ")}`);
  }

  if (parts.length === 0) return "";
  return parts.length === 1
    ? parts[0]
    : `${parts[0]} with ${parts.slice(1).join(" and ")}`;
}

/**
 * One-sentence, synthesis-readable description of the water properties,
 * woven into the WQA finding `summary` so the maintenance-synthesis
 * bridge (which receives the summary) can modulate water-touching
 * cadences. Returns "" when nothing cadence-relevant is present, so the
 * caller appends nothing.
 */
export function describeWaterProperties(
  properties: WaterProperties | null,
): string {
  const phrase = waterPropertiesPhrase(properties);
  if (phrase === "") return "";
  return `Your tap water is ${phrase}, which Hearth factors into the maintenance cadence for water-touching equipment.`;
}
