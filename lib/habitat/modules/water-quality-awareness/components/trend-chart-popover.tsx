"use client";

/**
 * Hover/tap trend-chart popover (issue #293). Wraps a contaminant's inline
 * trend indicator; on hover (desktop) or tap (touch) it expands into a
 * larger year-by-year line chart built from the persisted history series.
 *
 * Why a portal: the finding modal's body scrolls (overflow), which would
 * clip an absolutely-positioned child. We render the popover into
 * document.body with fixed positioning computed from the trigger rect, so
 * it floats above the modal and never clips. A short close-delay bridges
 * the gap between the trigger and the popover so moving the mouse across it
 * doesn't dismiss.
 *
 * Honesty: the EPA-limit line + each point's tooltip use the **per-year**
 * limit the report stated (`point.limit`), so a historical MCL change reads
 * as a step rather than today's value painted backward. The utility name +
 * PWSID sit in the header so a screenshot carries its own attribution. The
 * geometry is the shared pure `trendChartGeometry`; this file only renders.
 */

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  computeTrend,
  trendChartGeometry,
  trendDataSpanLabel,
  trendTone,
  trendWord,
  type ContaminantSeries,
  type TrendDirection,
} from "@/lib/habitat/water-quality/contaminants/trends";

const CHART_W = 380;
const CHART_H = 188;
const POP_PAD = 16;
const POP_W = CHART_W + POP_PAD * 2;
const POP_H_ESTIMATE = 340;
const GAP = 8;

function toneColor(direction: TrendDirection): string {
  const t = trendTone(direction);
  if (t === "attention") return "var(--color-accent)";
  if (t === "positive") return "var(--color-success)";
  return "var(--color-text-tertiary)";
}

function fmt(value: number, unit: string | null): string {
  const v = Number.isInteger(value)
    ? String(value)
    : value < 1
      ? value.toFixed(2)
      : value.toFixed(1);
  return unit ? `${v} ${unit}` : v;
}

export function TrendChartPopover({
  children,
  series,
  analyteName,
  utilityName,
  pwsid,
}: {
  children: React.ReactNode;
  series: ContaminantSeries | null;
  analyteName: string;
  utilityName: string | null;
  pwsid: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogId = useId();

  const trend = computeTrend(series);
  const geo = trendChartGeometry(series?.points ?? [], {
    width: CHART_W,
    height: CHART_H,
  });

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const placeBelow = below >= POP_H_ESTIMATE + GAP || below >= above;
    let top = placeBelow ? r.bottom + GAP : r.top - POP_H_ESTIMATE - GAP;
    if (top < GAP) top = GAP;
    let left = r.left;
    if (left + POP_W > window.innerWidth - GAP) {
      left = window.innerWidth - POP_W - GAP;
    }
    if (left < GAP) left = GAP;
    setPos({ top, left });
  }, []);

  const doOpen = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    reposition();
    setOpen(true);
  }, [reposition]);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onMove() {
      reposition();
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Fewer than two readings → no chart; render the inline indicator plainly.
  if (!geo) return <>{children}</>;

  const color = toneColor(trend.direction);
  const limitPoints = geo.points.filter((p) => p.limitY !== null);
  const limitLabelY =
    limitPoints.length > 0
      ? (limitPoints[limitPoints.length - 1].limitY as number) - 4
      : 0;

  const popover =
    open && pos
      ? createPortal(
          <div
            id={dialogId}
            role="dialog"
            aria-label={`${analyteName} — year over year`}
            onMouseEnter={doOpen}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: POP_W,
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
            </div>

            {utilityName || pwsid ? (
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 6,
                }}
              >
                {utilityName ? (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {utilityName}
                  </span>
                ) : null}
                {utilityName && pwsid ? " · " : ""}
                {pwsid ? `PWSID ${pwsid}` : ""}
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
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{ width: 14, height: 2, backgroundColor: color }}
                  aria-hidden
                />
                Level ({geo.unit ?? "—"})
              </span>
              {geo.limitPolyline ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
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

            <div style={{ position: "relative", width: CHART_W, height: CHART_H }}>
              <svg
                width={CHART_W}
                height={CHART_H}
                role="img"
                aria-label={`${analyteName} level by year, ${trendDataSpanLabel(
                  trend,
                )}`}
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
                  const many = geo.xLabels.length > 7;
                  const show =
                    !many ||
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
                    stroke={
                      hovered === i ? "var(--color-bg-surface-raised)" : "none"
                    }
                    strokeWidth={hovered === i ? 2 : 0}
                  />
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
                    const left = Math.min(Math.max(p.x - 72, 0), CHART_W - 150);
                    const above = p.y > CHART_H / 2;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          left,
                          width: 150,
                          ...(above
                            ? { bottom: CHART_H - p.y + 10 }
                            : { top: p.y + 10 }),
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
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-secondary)",
                          }}
                        >
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
                          from your {p.year} report
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
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                lineHeight: 1.5,
              }}
            >
              Each point is one of your utility&rsquo;s annual reports.
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "block" }}
      onMouseEnter={doOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => (open ? setOpen(false) : doOpen())}
        onFocus={doOpen}
        onBlur={scheduleClose}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          color: "inherit",
          display: "block",
          width: "100%",
        }}
      >
        {children}
      </button>
      {popover}
    </span>
  );
}
