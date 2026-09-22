"use client";

/**
 * Expanded trend chart (issues #293, #340) — one popover per contaminant
 * row, reachable from two triggers that share a single instance:
 *
 *   * `TrendChartIconButton` — the explicit chart-line icon next to the
 *     level/limit line (in-app only). Click / keyboard / tap toggles the
 *     popover *pinned* open. This is the #293 follow-up's trigger and the
 *     accessible one: a real button with `aria-haspopup` / `aria-expanded`.
 *   * `TrendSparklineTrigger` — the inline 56×16 sparkline itself. Hovering
 *     it (pointer devices only, after a short hover-intent delay) opens the
 *     popover *unpinned*; leaving both the sparkline and the popover closes
 *     it after a grace period so the pointer can travel into the chart.
 *     Clicking the sparkline pins it (or toggles it closed when already
 *     pinned). On the public page — which has no icon — the sparkline is
 *     a real `<button>` so keyboard and touch users still have a trigger.
 *
 * Why hover on the sparkline and not the whole indicator: #293 first shipped
 * hover on the entire trend row (glyph + word + sparkline + caption) and it
 * got in the way — the popover sat over the next contaminant as the pointer
 * moved down the list — so it was replaced by the icon (`b639bea`). The
 * sparkline is a much smaller target and the hover-intent delay filters
 * pass-through; that's the #340 compromise.
 *
 * `useTrendChart` owns the state (open / pinned / anchor / timers) and
 * returns the portal node plus the handlers the two triggers bind. Rendering
 * it as a hook rather than a wrapper component is what lets the icon (beside
 * the measure line) and the sparkline (a row below) drive one popover
 * without lifting state into every row component by hand.
 *
 * Why a portal: the finding modal's body scrolls (overflow), which would clip
 * an absolutely-positioned child. We render into document.body with fixed
 * positioning computed from the anchor (click point, or the trigger's rect),
 * so it floats above the modal and never clips. It closes on Esc, outside
 * click, scroll, and resize.
 *
 * Honesty: the EPA-limit line + each point's tooltip use the **per-year**
 * limit the report stated (`point.limit`), so a historical MCL change reads
 * as a step rather than today's value painted backward. Every point carries
 * an always-visible value label (#340) so the reader gets each year's number
 * without hovering. The header carries the utility name plus either the
 * PWSID (in-app) or the place name (public — no machine identifiers on a
 * public page), so a screenshot carries its own attribution. The geometry is
 * the shared pure `trendChartGeometry` / `trendChartValueLabels`; this file
 * only renders.
 */

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icon";
import { Tooltip } from "@/components/tooltip";
import {
  buildTrendClipboardTsv,
  computeTrend,
  formatTrendLevel,
  sparklineGeometry,
  trendChartGeometry,
  trendChartValueLabels,
  trendDataSpanLabel,
  trendTone,
  trendWord,
  type ContaminantSeries,
  type ContaminantTrend,
  type TrendChartVoice,
  type TrendDirection,
} from "@/lib/habitat/water-quality/contaminants/trends";

const CHART_W_MAX = 380;
const CHART_H = 188;
const POP_PAD = 16;
const POP_H_ESTIMATE = 360;
const GAP = 8;
/** Hover-intent delay before a sparkline hover opens the chart. */
const HOVER_OPEN_MS = 180;
/** Grace period after leaving the sparkline/popover before an unpinned
 *  chart closes — long enough to travel from the sparkline into the chart. */
const HOVER_CLOSE_MS = 260;

const SPARK_W = 56;
const SPARK_H = 16;

/** Who the chart is attributed to, and in whose voice it speaks. */
export type TrendChartAttribution = {
  /** The utility's display name (EPA `pws_name`, or the system card's). */
  utilityName: string | null;
  /** Spelled-out PWSID — in-app only; the public page passes null. */
  pwsid: string | null;
  /** The place the system serves — the public page's substitute for the
   *  PWSID (hard rule 3: no machine identifiers on public surfaces). */
  placeName?: string | null;
  voice: TrendChartVoice;
};

export type TrendChartHandle = {
  /** True when there are 2+ readings — i.e. there is something to chart. */
  available: boolean;
  open: boolean;
  dialogId: string;
  trend: ContaminantTrend;
  analyteName: string;
  /** Click / tap / keyboard: pin open, or close when already pinned. */
  toggle: (anchor: { x: number; y: number } | null, el: HTMLElement | null) => void;
  /** Pointer entered a hover trigger (the sparkline). */
  hoverStart: (el: HTMLElement) => void;
  /** Pointer left a hover trigger. */
  hoverEnd: () => void;
  /** The portal node — render it once anywhere inside the row. */
  popover: ReactNode;
};

/**
 * Attribute every trigger carries so the outside-click handler can tell a
 * click on one of this chart's own triggers from a genuine outside click
 * (a data attribute rather than a ref: the React Compiler lint treats an
 * object with a ref callback on it as a ref itself and rejects reading any
 * of its fields during render).
 */
const TRIGGER_ATTR = "data-trend-chart-trigger";

function toneColor(direction: TrendDirection): string {
  const t = trendTone(direction);
  if (t === "attention") return "var(--color-accent)";
  if (t === "positive") return "var(--color-success)";
  return "var(--color-text-tertiary)";
}

function fmt(value: number, unit: string | null): string {
  const v = formatTrendLevel(value);
  return unit ? `${v} ${unit}` : v;
}

function hoverCapable(): boolean {
  if (typeof window === "undefined") return false;
  // jsdom has no matchMedia; treat "unknown" as hover-capable so the
  // pointer path is exercisable in tests. Real touch browsers report
  // `(hover: none)` and never see the hover path.
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: hover)").matches;
}

export function useTrendChart({
  series,
  analyteName,
  attribution,
}: {
  series: ContaminantSeries | null;
  analyteName: string;
  attribution: TrendChartAttribution;
}): TrendChartHandle {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [chartW, setChartW] = useState(CHART_W_MAX);
  const [hovered, setHovered] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogId = useId();

  const trend = computeTrend(series);
  const available = trend.yearsOfData >= 2;

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [clearTimers],
  );

  // Position the popover to the upper-right of the anchor, then clamp into
  // the viewport — dropping below the anchor if there's no room above. The
  // chart narrows on phone widths so the whole popover fits the screen.
  const openAt = useCallback(
    (anchor: { x: number; y: number }, pin: boolean) => {
      const w = Math.min(
        CHART_W_MAX,
        Math.max(240, window.innerWidth - POP_PAD * 2 - GAP * 2),
      );
      const popW = w + POP_PAD * 2;
      let left = anchor.x + GAP;
      if (left + popW > window.innerWidth - GAP) {
        left = window.innerWidth - popW - GAP;
      }
      if (left < GAP) left = GAP;
      let top = anchor.y - POP_H_ESTIMATE - GAP;
      if (top < GAP) {
        top = Math.min(anchor.y + GAP, window.innerHeight - POP_H_ESTIMATE - GAP);
      }
      if (top < GAP) top = GAP;
      setChartW(w);
      setPos({ top, left });
      setHovered(null);
      setPinned(pin);
      setOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);

  const anchorFromEl = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.right, y: r.top };
  };

  const toggle = useCallback<TrendChartHandle["toggle"]>(
    (anchor, el) => {
      clearTimers();
      if (open) {
        // An unpinned (hover-opened) chart pins on click so it stops
        // auto-closing; a pinned one closes.
        if (pinned) close();
        else setPinned(true);
        return;
      }
      const usable = anchor && (anchor.x !== 0 || anchor.y !== 0) ? anchor : null;
      const a = usable ?? (el ? anchorFromEl(el) : null);
      if (!a) return;
      openAt(a, true);
    },
    [open, pinned, clearTimers, close, openAt],
  );

  const hoverStart = useCallback<TrendChartHandle["hoverStart"]>(
    (el) => {
      if (!hoverCapable()) return;
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (open || openTimer.current) return;
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        openAt(anchorFromEl(el), false);
      }, HOVER_OPEN_MS);
    },
    [open, openAt],
  );

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setPinned(false);
    }, HOVER_CLOSE_MS);
  }, []);

  const hoverEnd = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (open && !pinned) scheduleClose();
  }, [open, pinned, scheduleClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      const el = t instanceof Element ? t : t.parentElement;
      if (el?.closest(`[${TRIGGER_ATTR}="${dialogId}"]`)) return;
      if (popoverRef.current?.contains(t)) {
        // Interacting with a hover-opened chart (hovering points, copying
        // data) is a signal to keep it: pin it so it stops auto-closing.
        setPinned(true);
        return;
      }
      close();
    }
    // The popover is anchored to a point, so scrolling/resizing has no
    // element to re-track — close it rather than let it drift.
    function onMove() {
      close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, close, dialogId]);

  const copyData = useCallback(() => {
    const tsv = buildTrendClipboardTsv({
      analyteName,
      utilityName: attribution.utilityName,
      pwsid: attribution.pwsid,
      points: series?.points ?? [],
      voice: attribution.voice,
    });
    navigator.clipboard
      ?.writeText(tsv)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* clipboard blocked — leave the button as-is */
      });
  }, [analyteName, attribution, series]);

  const popover =
    open && pos && available ? (
      <TrendChartPopover
        ref={popoverRef}
        dialogId={dialogId}
        series={series}
        trend={trend}
        analyteName={analyteName}
        attribution={attribution}
        chartW={chartW}
        pos={pos}
        pinned={pinned}
        hovered={hovered}
        setHovered={setHovered}
        copied={copied}
        onCopy={copyData}
        onClose={close}
        onPointerEnter={() => {
          if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
        }}
        onPointerLeave={() => {
          if (!pinned) scheduleClose();
        }}
      />
    ) : null;

  return {
    available,
    open,
    dialogId,
    trend,
    analyteName,
    toggle,
    hoverStart,
    hoverEnd,
    popover,
  };
}

/* ---------- triggers --------------------------------------------------- */

/**
 * The explicit chart-line icon button (in-app). Renders nothing when there
 * is nothing to chart, so a single-reading row shows no dead control.
 */
export function TrendChartIconButton({ chart }: { chart: TrendChartHandle }) {
  const { available, analyteName, open, dialogId, toggle } = chart;
  if (!available) return null;
  return (
    <Tooltip content={`See every year of data we have for ${analyteName}`}>
      <button
        {...{ [TRIGGER_ATTR]: dialogId }}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Show the ${analyteName} trend chart for every year of data we have`}
        onClick={(e) => toggle({ x: e.clientX, y: e.clientY }, e.currentTarget)}
        className="inline-flex items-center justify-center shrink-0"
        style={{
          background: "transparent",
          border: "none",
          padding: 2,
          margin: 0,
          cursor: "pointer",
          color: "var(--color-text-primary)",
          lineHeight: 0,
        }}
      >
        <Icon name="chart-line" size={16} />
      </button>
    </Tooltip>
  );
}

/**
 * The inline sparkline, now a hover trigger for the chart (#340). Appears
 * at 3+ readings — the same threshold the static sparkline always had.
 *
 * `focusable` makes it a real `<button>` with dialog ARIA — the public page
 * has no icon, so this is its only trigger. In-app it stays a non-focusable
 * span (the icon already carries the accessible control; a second tab stop
 * per row would be noise).
 */
export function TrendSparklineTrigger({
  chart,
  color,
  focusable = false,
}: {
  chart: TrendChartHandle;
  color: string;
  focusable?: boolean;
}) {
  const { trend, analyteName, open, dialogId, toggle, hoverStart, hoverEnd } =
    chart;
  const points = trend.points;
  const geo =
    points.length >= 3
      ? sparklineGeometry(points, { width: SPARK_W, height: SPARK_H, padding: 2 })
      : null;
  if (!geo) return null;
  const last = geo.dots[geo.dots.length - 1];

  const svg = (
    <svg
      viewBox={`0 0 ${geo.width} ${geo.height}`}
      width={geo.width}
      height={geo.height}
      aria-hidden
      style={{ display: "block" }}
    >
      <polyline
        points={geo.polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={1.8} fill={color} />
    </svg>
  );

  // A little breathing room around the 56×16 line so the hover target and
  // the tap target are forgiving without changing the row's rhythm.
  const boxStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 4px",
    margin: "-3px -4px",
    borderRadius: "var(--radius-sm)",
    background: open
      ? `color-mix(in oklab, ${color} 12%, transparent)`
      : "transparent",
    cursor: "pointer",
    lineHeight: 0,
  } as const;

  if (focusable) {
    return (
      <button
        {...{ [TRIGGER_ATTR]: dialogId }}
        data-trend-sparkline
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Show the ${analyteName} trend chart for every year of data on file`}
        onMouseEnter={(e) => hoverStart(e.currentTarget)}
        onMouseLeave={hoverEnd}
        onClick={(e) => toggle({ x: e.clientX, y: e.clientY }, e.currentTarget)}
        className="shrink-0"
        style={{ ...boxStyle, border: "none" }}
      >
        {svg}
      </button>
    );
  }

  return (
    <span
      {...{ [TRIGGER_ATTR]: dialogId }}
      data-trend-sparkline
      onMouseEnter={(e) => hoverStart(e.currentTarget)}
      onMouseLeave={hoverEnd}
      onClick={(e) => toggle({ x: e.clientX, y: e.clientY }, e.currentTarget)}
      className="shrink-0"
      style={boxStyle}
    >
      {svg}
    </span>
  );
}

/* ---------- the popover itself ----------------------------------------- */

function TrendChartPopover({
  ref,
  dialogId,
  series,
  trend,
  analyteName,
  attribution,
  chartW,
  pos,
  pinned,
  hovered,
  setHovered,
  copied,
  onCopy,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  ref: React.Ref<HTMLDivElement>;
  dialogId: string;
  series: ContaminantSeries | null;
  trend: ContaminantTrend;
  analyteName: string;
  attribution: TrendChartAttribution;
  chartW: number;
  pos: { top: number; left: number };
  pinned: boolean;
  hovered: number | null;
  setHovered: (i: number | null) => void;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const geo = trendChartGeometry(series?.points ?? [], {
    width: chartW,
    height: CHART_H,
  });
  if (!geo) return null;

  const color = toneColor(trend.direction);
  const labels = trendChartValueLabels(geo, { fontSize: 10, gap: 7 });
  const limitPoints = geo.points.filter((p) => p.limitY !== null);
  const limitLabelY =
    limitPoints.length > 0
      ? (limitPoints[limitPoints.length - 1].limitY as number) - 4
      : 0;
  const third = attribution.voice === "third";
  const secondary = attribution.pwsid
    ? `PWSID ${attribution.pwsid}`
    : (attribution.placeName ?? "");
  // With many years the axis gets crowded; keep first/last and every
  // other label rather than let four-digit years collide.
  const manyYears = geo.xLabels.length > 10;

  return createPortal(
    <div
      ref={ref}
      id={dialogId}
      role="dialog"
      aria-label={`${analyteName} — year over year`}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: chartW + POP_PAD * 2,
        zIndex: 80,
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: POP_PAD,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 15,
              color: "var(--color-text-primary)",
            }}
          >
            {analyteName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginTop: 2,
            }}
          >
            {trendDataSpanLabel(trend)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="eyebrow"
            style={{
              fontSize: 10,
              color,
              backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
              borderRadius: 999,
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {trendWord(trend.direction)}
          </span>
          <button
            type="button"
            aria-label="Close chart"
            onClick={onClose}
            className="inline-flex items-center justify-center"
            style={{
              background: "transparent",
              border: "none",
              padding: 2,
              cursor: "pointer",
              color: "var(--color-text-tertiary)",
              // An unpinned (hover) chart closes itself; the X only earns
              // its place once the chart is pinned.
              visibility: pinned ? "visible" : "hidden",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {attribution.utilityName || secondary ? (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginTop: 6,
          }}
        >
          {attribution.utilityName ? (
            <span style={{ color: "var(--color-text-secondary)" }}>
              {attribution.utilityName}
            </span>
          ) : null}
          {attribution.utilityName && secondary ? " · " : ""}
          {secondary}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "var(--color-text-secondary)",
          margin: "10px 0 4px",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, backgroundColor: color }} aria-hidden />
          Level ({geo.unit ?? "—"})
        </span>
        {geo.limitPolyline ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 14,
                height: 0,
                borderTop: "2px dashed var(--color-danger)",
              }}
              aria-hidden
            />
            EPA limit
          </span>
        ) : null}
      </div>

      <div style={{ position: "relative", width: chartW, height: CHART_H }}>
        <svg
          width={chartW}
          height={CHART_H}
          role="img"
          aria-label={`${analyteName} level by year, ${trendDataSpanLabel(trend)}: ${geo.points
            .map((p) => `${p.year} ${fmt(p.level, p.unit)}`)
            .join(", ")}`}
          onMouseLeave={() => setHovered(null)}
        >
          {geo.yTicks.map((t) => (
            <g key={`y${t.value}`}>
              <line
                x1={geo.plot.left}
                x2={geo.plot.right}
                y1={t.y}
                y2={t.y}
                stroke="var(--color-border-subtle)"
                strokeWidth={1}
              />
              <text
                x={geo.plot.left - 6}
                y={t.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-text-tertiary)"
              >
                {t.label}
              </text>
            </g>
          ))}

          {geo.xLabels.map((l, i) => {
            const show =
              !manyYears ||
              i === 0 ||
              i === geo.xLabels.length - 1 ||
              i % 2 === 0;
            return show ? (
              <text
                key={l.year}
                x={l.x}
                y={geo.plot.bottom + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-text-tertiary)"
              >
                {l.year}
              </text>
            ) : null;
          })}

          {geo.limitPolyline ? (
            <>
              <polyline
                points={geo.limitPolyline}
                fill="none"
                stroke="var(--color-danger)"
                strokeWidth={1.4}
                strokeDasharray="5 4"
                opacity={0.85}
              />
              <text
                x={geo.plot.right}
                y={limitLabelY}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-danger)"
              >
                EPA limit
              </text>
            </>
          ) : null}

          {hovered !== null ? (
            <line
              x1={geo.points[hovered].x}
              x2={geo.points[hovered].x}
              y1={geo.plot.top}
              y2={geo.plot.bottom}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
          ) : null}

          <polyline
            points={geo.dataPolyline}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {geo.points.map((p, i) => (
            <circle
              key={`pt${i}`}
              cx={p.x}
              cy={p.y}
              r={i === geo.points.length - 1 || hovered === i ? 4 : 3}
              fill={color}
              stroke={hovered === i ? "var(--color-bg-surface-raised)" : "none"}
              strokeWidth={hovered === i ? 2 : 0}
            />
          ))}

          {/* Always-visible value labels (#340). A surface-colored halo
              behind each keeps the digits legible where they cross a
              gridline or the limit line. */}
          {labels.map((l, i) => (
            <text
              key={`lbl${i}`}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              fontSize={10}
              fontWeight={500}
              className="mono"
              fill={hovered === i ? "var(--color-text-primary)" : color}
              stroke="var(--color-bg-surface-raised)"
              strokeWidth={3}
              strokeLinejoin="round"
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {l.text}
            </text>
          ))}

          {geo.points.map((p, i) => {
            const prev = geo.points[i - 1];
            const next = geo.points[i + 1];
            const x1 = prev ? (prev.x + p.x) / 2 : geo.plot.left;
            const x2 = next ? (p.x + next.x) / 2 : geo.plot.right;
            return (
              <rect
                key={`band${i}`}
                x={x1}
                y={geo.plot.top}
                width={Math.max(0, x2 - x1)}
                height={geo.plot.bottom - geo.plot.top}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(i)}
                onClick={() => setHovered(i)}
              />
            );
          })}
        </svg>

        {hovered !== null
          ? (() => {
              const p = geo.points[hovered];
              const left = Math.min(Math.max(p.x - 72, 0), chartW - 150);
              const above = p.y > CHART_H / 2;
              return (
                <div
                  style={{
                    position: "absolute",
                    left,
                    width: 150,
                    ...(above ? { bottom: CHART_H - p.y + 10 } : { top: p.y + 10 }),
                    backgroundColor: "var(--color-bg-base)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "6px 8px",
                    pointerEvents: "none",
                    lineHeight: 1.4,
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {p.year} · {fmt(p.level, p.unit)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {p.limit !== null
                      ? `EPA limit ${fmt(p.limit, p.unit)}`
                      : "EPA limit not stated"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                      marginTop: 2,
                    }}
                  >
                    {third ? `from the ${p.year} report` : `from your ${p.year} report`}
                  </div>
                </div>
              );
            })()
          : null}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          marginTop: 10,
          paddingTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          {third
            ? "Each point is one of the utility’s annual reports."
            : "Each point is one of your utility’s annual reports."}
        </span>
        <Tooltip
          content="Copy this data (tab-separated) to paste into a spreadsheet"
          side="bottom"
        >
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${analyteName}'s yearly data to the clipboard`}
            className="inline-flex items-center gap-1.5 shrink-0"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "3px 9px",
              color: copied ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              cursor: "pointer",
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            <Icon name={copied ? "circle-check" : "copy"} size={13} aria-hidden />
            {copied ? "Copied" : "Copy data"}
          </button>
        </Tooltip>
      </div>
    </div>,
    document.body,
  );
}
