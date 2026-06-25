/**
 * Year-over-year contaminant trends for the Water Quality surfaces.
 * Issue #289.
 *
 * Shared, pure, and dependency-light on purpose — the same way
 * `pfas-grouping.ts` is. Both the finding modal (`overview-body.tsx`) and
 * the PDF Water Quality Report (`lib/reports/water-quality/report.ts`)
 * render the trend indicator, so the direction rules, the data-span
 * labeling, and the sparkline geometry all live here and the two surfaces
 * can't drift. Rendering (React vs. HTML-string SVG) is each surface's
 * own job; the math and the words are shared.
 *
 * It imports only the per-year CCR summarizer (`buildCcrFindings` +
 * `buildDisplayedCcrContaminants`) and the name-normalizer from `ccr.ts`,
 * plus the extraction type. No `node:crypto`, no Supabase client — so it
 * stays safe to import into a client component, the same constraint
 * `pfas-grouping.ts` documents. `ccr.ts` never imports this module, so
 * there is no cycle.
 *
 * TRANSPARENCY IS THE LOAD-BEARING CONSTRAINT. We surface only what the
 * uploaded reports actually contain. A series carries a point ONLY for a
 * year that printed a positive measured level for the analyte. We never
 * fabricate non-detect points (the CCR extraction drops non-detect rows,
 * so an analyte's absence in a year is genuinely ambiguous — not-detected
 * vs. not-reported — and we refuse to guess). The data-span label always
 * states exactly how many readings we have and which years, so nothing
 * ever implies more history than we hold.
 *
 * DELIBERATELY OMITTED: "newly detected" / "no longer detected" arrows.
 * Because absence-in-a-year is ambiguous, we cannot honestly distinguish
 * a true first-time detection from a contaminant the utility simply
 * didn't print that year. Claiming "new detection" would mislead. We only
 * compare years that both carry a real measured number.
 */

import type { CcrExtractionResult } from "@/lib/documents/ai/ccr-schema";
import {
  buildCcrFindings,
  buildDisplayedCcrContaminants,
  mclRatio,
  normalizeContaminantGroupKey,
  type CcrSummarizedContaminant,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";

/**
 * The relative band within which a year-over-year change reads as
 * "stable" rather than rising/falling. 10% keeps ordinary measurement
 * noise — and the reduced-monitoring case where a utility republishes
 * the prior sample verbatim — from registering as a trend. Tunable; this
 * is a v1 heuristic, documented in `/how-it-works#water-quality-awareness`.
 */
export const TREND_STABLE_TOLERANCE = 0.1;

/** One year's reading for a single analyte. Present only when the report
 *  for that year printed a positive measured level. */
export type ContaminantYearPoint = {
  year: number;
  level: number;
  unit: string | null;
};

/** The full per-analyte reading history, oldest reading first. */
export type ContaminantSeries = {
  /** Normalized grouping key (trim + lowercase), matched across years. */
  key: string;
  /** Printed name from the most recent reading — what the UI shows. */
  display_name: string;
  /** Unit from the most recent reading. */
  unit: string | null;
  /** Chronological ascending by year. One entry per year-with-a-reading. */
  points: ContaminantYearPoint[];
};

/** Persisted on `ccr_findings.contaminant_history` — one series per
 *  analyte seen in any uploaded year. */
export type ContaminantHistory = ContaminantSeries[];

/**
 * One uploaded report year, for the "Reports on file" panel (issue #289).
 * The shared, non-private facts about each year Hearth holds for the
 * utility — never the raw PDF (the extraction is shared across the
 * utility; the uploaded file belongs to whoever contributed it).
 */
export type CcrReportIndexEntry = {
  report_year: number;
  /** The utility's stated publication date, when the CCR printed one. */
  published_date: string | null;
  /** When Hearth extracted this report (ISO) — a proxy for "added". */
  extracted_at: string;
  /** How many contaminants that year's report surfaces (the displayed list). */
  detected_count: number;
};

/** Persisted on `ccr_findings.report_index` — every uploaded year,
 *  newest first. Drives the "Reports on file" disclosure. */
export type CcrReportIndex = CcrReportIndexEntry[];

export type TrendDirection =
  | "rising"
  | "falling"
  | "stable"
  | "first_year"
  | "not_comparable";

/** The computed trend for one analyte, the shape both surfaces render. */
export type ContaminantTrend = {
  direction: TrendDirection;
  /** How many years carry a real reading. The data-span honesty signal. */
  yearsOfData: number;
  firstYear: number | null;
  latestYear: number | null;
  /** Most recent reading. */
  latest: ContaminantYearPoint | null;
  /** The reading immediately preceding `latest` (the comparison basis). */
  previous: ContaminantYearPoint | null;
  /** Signed fractional change of `latest` vs `previous`; null when not
   *  comparable (fewer than two readings, or a unit mismatch). */
  pctChange: number | null;
  /** Every reading, oldest first — drives the sparkline. */
  points: ContaminantYearPoint[];
};

/**
 * Build the per-analyte reading history from a utility's uploaded CCR
 * years. Reuses the per-year summarizer + displayed-list assembly so the
 * analytes (and their chosen display observation) match exactly what the
 * "Detected in your water" list shows for that year — including the
 * folded-in UCMR (PFAS) rows and the lead/copper distribution.
 *
 * `years` may arrive in any order; the output series are sorted ascending
 * by year. Pure.
 */
export function buildContaminantHistory(
  years: Array<{
    report_year: number;
    published_date: string | null;
    extracted_data: CcrExtractionResult;
  }>,
): ContaminantHistory {
  const byKey = new Map<
    string,
    { display_name: string; unit: string | null; points: ContaminantYearPoint[] }
  >();

  for (const year of years) {
    const ccrFindings = buildCcrFindings({
      reportYear: year.report_year,
      publishedDate: year.published_date,
      extractedData: year.extracted_data,
    });
    // null lcrFallback — for a historical year we only count what that
    // year's report itself printed, not today's SDWIS samples.
    const displayed = buildDisplayedCcrContaminants(ccrFindings, null);

    for (const c of displayed) {
      // A usable reading is a finite positive level. Null / zero is a
      // non-detect or unreported value and contributes no point.
      if (
        c.detected_level === null ||
        !Number.isFinite(c.detected_level) ||
        c.detected_level <= 0
      ) {
        continue;
      }
      const key = normalizeContaminantGroupKey(c.contaminant_name);
      const entry = byKey.get(key);
      const point: ContaminantYearPoint = {
        year: year.report_year,
        level: c.detected_level,
        unit: c.unit,
      };
      if (entry) {
        // Guard against two rows for the same analyte in one year
        // (shouldn't happen post-dedup, but keep the series clean).
        if (!entry.points.some((p) => p.year === point.year)) {
          entry.points.push(point);
        }
      } else {
        byKey.set(key, {
          display_name: c.contaminant_name,
          unit: c.unit,
          points: [point],
        });
      }
    }
  }

  const history: ContaminantHistory = [];
  for (const [key, entry] of byKey) {
    const points = entry.points.slice().sort((a, b) => a.year - b.year);
    // Every entry has at least one point (we only create one when adding
    // a reading); unit comes from the most recent reading, display_name
    // from the first time we saw the analyte (names are stable per utility).
    const latest = points[points.length - 1];
    history.push({
      key,
      display_name: entry.display_name,
      unit: latest.unit,
      points,
    });
  }
  // Stable output order: alphabetical by key (the consumer re-orders for
  // display anyway; this just keeps the persisted JSON deterministic).
  return history.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Build the "Reports on file" index from a utility's uploaded CCR years.
 * Newest year first. `detected_count` is the size of the displayed
 * contaminant list for that year (regulated table + folded-in UCMR/PFAS +
 * lead/copper), so it matches what the "Detected in your water" panel
 * would show for that year. Pure.
 */
export function buildCcrReportIndex(
  years: Array<{
    report_year: number;
    published_date: string | null;
    extracted_at: string;
    extracted_data: CcrExtractionResult;
  }>,
): CcrReportIndex {
  return years
    .map((y) => {
      const ccrFindings = buildCcrFindings({
        reportYear: y.report_year,
        publishedDate: y.published_date,
        extractedData: y.extracted_data,
      });
      return {
        report_year: y.report_year,
        published_date: y.published_date,
        extracted_at: y.extracted_at,
        detected_count: buildDisplayedCcrContaminants(ccrFindings, null).length,
      };
    })
    .sort((a, b) => b.report_year - a.report_year);
}

/**
 * Compute the trend for a single analyte's series. Pure.
 *
 * Rules:
 *   * 0 readings        → not_comparable (no data).
 *   * 1 reading         → first_year (we have a number, but nothing to
 *                          compare it to — say so honestly).
 *   * 2+ readings, but the latest two have mismatched units, or the
 *     prior value is non-positive → not_comparable.
 *   * otherwise compare latest vs the immediately preceding reading:
 *       |pctChange| <= TREND_STABLE_TOLERANCE → stable
 *       pctChange > 0                          → rising
 *       pctChange < 0                          → falling
 *
 * "Latest vs immediately preceding reading" deliberately compares the two
 * most recent data-bearing years, ignoring gaps — a 2019 reading and a
 * 2025 reading compare directly when those are the two we have.
 */
export function computeTrend(
  series: ContaminantSeries | null | undefined,
): ContaminantTrend {
  const points = series?.points ?? [];
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const previous = points.length > 1 ? points[points.length - 2] : null;

  const base: ContaminantTrend = {
    direction: "not_comparable",
    yearsOfData: points.length,
    firstYear: points.length > 0 ? points[0].year : null,
    latestYear: latest ? latest.year : null,
    latest,
    previous,
    pctChange: null,
    points,
  };

  if (points.length === 0) return base;
  if (points.length === 1) return { ...base, direction: "first_year" };

  // We have a latest and a previous.
  if (!latest || !previous) return base;
  // Unit mismatch we can't reconcile → don't pretend to compare.
  if (
    latest.unit !== null &&
    previous.unit !== null &&
    latest.unit !== previous.unit
  ) {
    return base;
  }
  if (previous.level <= 0 || !Number.isFinite(previous.level)) return base;

  const pctChange = (latest.level - previous.level) / previous.level;
  const direction: TrendDirection =
    Math.abs(pctChange) <= TREND_STABLE_TOLERANCE
      ? "stable"
      : pctChange > 0
        ? "rising"
        : "falling";

  return { ...base, direction, pctChange };
}

/**
 * Ratio floor (fraction of the limit) at/above which a *rising* contaminant
 * escalates out of the low-levels tier (issue #291). Below this it sits too
 * far under the limit for the upward trend to be worth surfacing; at/above
 * the existing 0.8 `CAUTION_RATIO` it already escalates on level alone,
 * regardless of trend. So this rule only acts in the [0.5, 0.8) band. A v1
 * heuristic, documented in /how-it-works#water-quality-awareness; tunable.
 */
export const APPROACHING_RISING_RATIO = 0.5;

/**
 * Trend-aware tier escalation (issue #291). A contaminant that is below the
 * federal limit but **rising toward it** would otherwise tier as `context`
 * and hide inside the modal's "low levels" collapse — defeating the point
 * of the trend for users who never expand it. This bumps such a row to
 * `caution` ("Worth knowing") so it surfaces by default; because tier is the
 * single axis that drives the collapse, the badge, AND `deriveSeverity`, the
 * escalation cascades through all three from this one change.
 *
 * Pure. Only `context` rows with a computable ratio in the
 * [APPROACHING_RISING_RATIO, 0.8) band and a `rising` trend escalate; PFAS /
 * lead / copper (already caution-floored), stable/falling rows, and rows
 * without a comparable limit are untouched. Never reaches `concern` — a
 * below-limit contaminant caps at `caution`, so the escalation can't
 * overstate.
 */
export function applyTrendEscalation(
  contaminants: CcrSummarizedContaminant[],
  history: ContaminantHistory | null,
): CcrSummarizedContaminant[] {
  return contaminants.map((c) => {
    if (c.tier !== "context") return c;
    const ratio = mclRatio(c);
    if (ratio === null || ratio < APPROACHING_RISING_RATIO) return c;
    const trend = computeTrend(findSeriesByName(history, c.contaminant_name));
    if (trend.direction !== "rising") return c;
    return { ...c, tier: "caution" };
  });
}

/** Find one analyte's series in a persisted history by contaminant name. */
export function findSeriesByName(
  history: ContaminantHistory | null | undefined,
  contaminantName: string,
): ContaminantSeries | null {
  if (!history) return null;
  const key = normalizeContaminantGroupKey(contaminantName);
  return history.find((s) => s.key === key) ?? null;
}

/* ---------- presentation helpers (shared label / tone / geometry) ------- */

/** Human word for a direction. Honest about the thin-data states. */
export function trendWord(direction: TrendDirection): string {
  switch (direction) {
    case "rising":
      return "Rising";
    case "falling":
      return "Falling";
    case "stable":
      return "Stable";
    case "first_year":
      return "First year of data";
    case "not_comparable":
    default:
      return "Trend unclear";
  }
}

/**
 * Semantic tone for a direction. Each surface maps this to its own color
 * (the modal uses CSS custom properties, the PDF uses REPORT_COLORS), so
 * we share the meaning, not the hex.
 *
 *   attention — the level moved up (more contaminant is the worse way).
 *   positive  — the level moved down.
 *   neutral   — stable, or not enough comparable data to say.
 */
export function trendTone(
  direction: TrendDirection,
): "attention" | "positive" | "neutral" {
  if (direction === "rising") return "attention";
  if (direction === "falling") return "positive";
  return "neutral";
}

/**
 * The data-span caption — the transparency line. Always states exactly
 * how many readings we have and the span they cover. Never implies more.
 *
 *   0 readings  → "No prior readings"
 *   1 reading   → "1 reading · 2025"
 *   2 readings  → "2 readings · 2024–2025"
 *   N (gappy)   → "3 readings · 2019–2025"
 */
export function trendDataSpanLabel(trend: ContaminantTrend): string {
  const n = trend.yearsOfData;
  if (n === 0) return "No prior readings";
  const noun = n === 1 ? "reading" : "readings";
  if (n === 1 || trend.firstYear === null || trend.latestYear === null) {
    return `${n} ${noun} · ${trend.latestYear ?? trend.firstYear ?? ""}`.trim();
  }
  if (trend.firstYear === trend.latestYear) {
    return `${n} ${noun} · ${trend.latestYear}`;
  }
  return `${n} ${noun} · ${trend.firstYear}–${trend.latestYear}`;
}

/**
 * The prior-value caption, e.g. "was 2.4 ppt in 2024". Empty when there
 * is no comparable previous reading. The current value is rendered by the
 * surface itself (it already shows level/limit); this adds the year-ago
 * number the user asked to see alongside it.
 */
export function trendPreviousLabel(trend: ContaminantTrend): string {
  const p = trend.previous;
  if (!p) return "";
  const value = p.unit ? `${p.level} ${p.unit}` : `${p.level}`;
  return `was ${value} in ${p.year}`;
}

/**
 * SVG path `d` for the direction glyph, on a 12×12 viewBox, drawn with
 * `stroke="currentColor"` (no fill). Shared so the modal (React `<path>`)
 * and the PDF (HTML SVG string) render the identical arrow and can't
 * drift. Rising points up-right, falling down-right, stable a right
 * arrow; not_comparable is a short dash (we have readings but can't
 * compare them). `first_year` returns the dash too, though surfaces
 * generally suppress the glyph when there's only one reading.
 */
export function trendArrowPath(direction: TrendDirection): string {
  switch (direction) {
    case "rising":
      return "M2 10 L10 2 M10 2 L5.5 2 M10 2 L10 6.5";
    case "falling":
      return "M2 2 L10 10 M10 10 L5.5 10 M10 10 L10 5.5";
    case "stable":
      return "M2 6 L10 6 M10 6 L6.5 3 M10 6 L6.5 9";
    case "first_year":
    case "not_comparable":
    default:
      return "M3 6 L9 6";
  }
}

export type SparklineGeometry = {
  /** Polyline "x,y x,y …" string, ready for an SVG <polyline points=…>. */
  polyline: string;
  /** Per-reading dot coordinates (last one is the latest). */
  dots: Array<{ x: number; y: number }>;
  width: number;
  height: number;
};

/**
 * Compute sparkline geometry from a series' points. Returns null when
 * there are fewer than two readings (nothing to draw a line between) — the
 * caller falls back to the word + data-span only. Pure; both surfaces feed
 * the same points in and get the same coordinates out.
 *
 * Y is inverted for SVG (0 at top). A flat series (all equal levels) draws
 * a centered horizontal line rather than dividing by a zero range.
 */
export function sparklineGeometry(
  points: ContaminantYearPoint[],
  opts: { width: number; height: number; padding?: number },
): SparklineGeometry | null {
  if (points.length < 2) return null;
  const pad = opts.padding ?? 2;
  const w = opts.width;
  const h = opts.height;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const levels = points.map((p) => p.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const range = max - min;

  const dots = points.map((p, i) => {
    const x = pad + (innerW * i) / (points.length - 1);
    const y =
      range === 0
        ? pad + innerH / 2
        : pad + innerH * (1 - (p.level - min) / range);
    return { x: round(x), y: round(y) };
  });

  const polyline = dots.map((d) => `${d.x},${d.y}`).join(" ");
  return { polyline, dots, width: w, height: h };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
