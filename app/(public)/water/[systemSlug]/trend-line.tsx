"use client";

/**
 * The trend row under a public contaminant's measure line (issues #303,
 * #340): direction arrow + word, the sparkline (a hover/tap trigger for the
 * expanded year-by-year chart), the prior reading, and the honest data-span
 * caption.
 *
 * This is the public page's one client island. It receives already-derived
 * numbers and Hearth's own labels from the server component — nothing here
 * fetches, reads a cookie, or touches a server action, so the route stays
 * fully static (public-pages hard rules 6–7). The chart itself is the same
 * shared popover the in-app finding uses; the only differences are the
 * attribution (system + place name, never a PWSID — hard rule 3) and the
 * third-person voice ("the utility's reports", not "your reports").
 */

import {
  TrendSparklineTrigger,
  useTrendChart,
} from "@/lib/habitat/modules/water-quality-awareness/components/trend-chart-popover";
import {
  normalizeContaminantGroupKey,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";
import {
  trendArrowPath,
  type ContaminantSeries,
} from "@/lib/habitat/water-quality/contaminants/trends";
import type { PublicTrend } from "@/lib/public-pages/water-summary";

/** Trend tone → page color, matching the modal's mapping. */
function trendColor(tone: PublicTrend["tone"]): string {
  if (tone === "attention") return "var(--color-accent)";
  if (tone === "positive") return "var(--color-success)";
  return "var(--color-text-tertiary)";
}

export function PublicTrendLine({
  trend,
  unit,
  analyteName,
  systemName,
  placeName,
}: {
  trend: PublicTrend | null;
  unit: string | null;
  /** Canonical reference name (never extraction text). */
  analyteName: string;
  /** EPA `pws_name`-derived display name. */
  systemName: string;
  placeName: string;
}) {
  // Rebuild the series shape the shared chart reads, from the sanitized
  // public points: validated numbers plus the row's allowlisted unit.
  const series: ContaminantSeries | null = trend
    ? {
        key: normalizeContaminantGroupKey(analyteName),
        display_name: analyteName,
        unit,
        points: trend.points.map((p) => ({
          year: p.year,
          level: p.level,
          unit,
          limit: p.limit,
        })),
      }
    : null;
  const chart = useTrendChart({
    series,
    analyteName,
    attribution: {
      utilityName: systemName,
      pwsid: null,
      placeName,
      voice: "third",
    },
  });

  if (!trend) return null;
  const color = trendColor(trend.tone);
  const prev = trend.previous
    ? `was ${trend.previous.level}${unit ? ` ${unit}` : ""} in ${trend.previous.year}`
    : null;
  return (
    <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
      <span className="inline-flex items-center gap-1" style={{ color }}>
        <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden>
          <path
            d={trendArrowPath(trend.direction)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-small" style={{ fontWeight: 500 }}>
          {trend.word}
        </span>
      </span>
      <TrendSparklineTrigger chart={chart} color={color} focusable />
      <span className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
        {prev ? `${prev} · ` : ""}
        {trend.spanLabel}
      </span>
      {chart.popover}
    </div>
  );
}
