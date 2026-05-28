"use client";

// The brand-thesis section of the task detail modal (issue #137). Every
// per-task reasoning field that the synthesis + direct-event pipelines
// invested in finally renders here: the source kind in plain words, the
// cadence basis, the modifiers that adjusted the cadence for this home,
// and the anchor that grounded the first occurrence.
//
// The expand defaults OPEN (issue #177). The reasoning is the second
// most important thing on the page after the instructions callout, and
// dashboard testing showed users were missing it because the closed
// state read as "just metadata" — the brand-thesis of "we explain our
// recommendations" only lands when the explanation is visible by
// default. Users who want the calmer view can still tap to collapse.
//
// The collapsed label switches between "Why this task" and "Why this
// practice" via the kind prop so per-use rows read naturally (a
// per-use is a standing practice, not a scheduled task).

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import type { TaskReasoning } from "@/lib/maintenance/types";

const SOURCE_LABEL: Record<TaskReasoning["source_kind"], string> = {
  manufacturer_guidance: "From the manufacturer",
  class_default: "Standard practice for this kind of equipment",
  habitat_modifier: "Based on your home's environment",
  installation_anchored: "Based on this item's install date",
  receipt_anchored: "Based on a prior service receipt",
  document_expiration: "From your uploaded document",
  manual_completion: "Based on your last completion",
};

const MODIFIER_LABEL: Record<
  NonNullable<TaskReasoning["modifiers"][number]["kind"]>,
  string
> = {
  habitat: "Adjusted for your home's environment",
  system_age: "Adjusted for this item's age",
  environment: "Adjusted for local conditions",
};

const SEASONAL_ANCHOR_LABEL: Record<string, string> = {
  before_heating_season: "before heating season",
  before_cooling_season: "before cooling season",
  spring: "in spring",
  fall: "in fall",
};

export type WhyThisTaskExpandProps = {
  reasoning: TaskReasoning;
  cadenceKind: string | null;
  cadenceIntervalMonths: number | null;
  cadenceSeasonalAnchor: string | null;
  /** "task" (default) → "Why this task"; "practice" → "Why this practice" for per-use rows. */
  variant?: "task" | "practice";
};

export function WhyThisTaskExpand({
  reasoning,
  cadenceKind,
  cadenceIntervalMonths,
  cadenceSeasonalAnchor,
  variant = "task",
}: WhyThisTaskExpandProps) {
  const [open, setOpen] = useState(true);
  const hasModifiers = reasoning.modifiers.length > 0;
  const cadenceLine = formatCadenceLine(
    cadenceKind,
    cadenceIntervalMonths,
    cadenceSeasonalAnchor,
  );
  const headerLabel = variant === "practice" ? "Why this practice" : "Why this task";

  return (
    <section
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-(--color-bg-surface-raised) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="sparkles" size={16} />
          <span style={{ fontWeight: 500 }}>{headerLabel}</span>
          {hasModifiers ? (
            <span
              className="shrink-0 px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--color-accent) 16%, transparent)",
                color: "var(--color-accent)",
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {reasoning.modifiers.length} adjustment
              {reasoning.modifiers.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <Icon
          name={open ? "chevron-down" : "chevron-right"}
          size={16}
          style={{ color: "var(--color-text-tertiary)" }}
        />
      </button>

      {open ? (
        <div
          className="flex flex-col gap-4 p-4"
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <div className="flex flex-col gap-1">
            <div
              className="eyebrow"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Source
            </div>
            <div>{SOURCE_LABEL[reasoning.source_kind] ?? "From your maintenance plan"}</div>
            {reasoning.cadence_basis ? (
              <p
                className="text-small"
                style={{
                  color: "var(--color-text-secondary)",
                  marginTop: 2,
                }}
              >
                {reasoning.cadence_basis}
              </p>
            ) : null}
          </div>

          {cadenceLine ? (
            <div className="flex flex-col gap-1">
              <div
                className="eyebrow"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Cadence
              </div>
              <div>{cadenceLine}</div>
            </div>
          ) : null}

          {hasModifiers ? (
            <div className="flex flex-col gap-2">
              <div
                className="eyebrow"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                What we adjusted for
              </div>
              <ul className="flex flex-col gap-2 list-none p-0 m-0">
                {reasoning.modifiers.map((m, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 p-3"
                    style={{
                      backgroundColor:
                        "color-mix(in oklab, var(--color-accent) 8%, transparent)",
                      border:
                        "1px solid color-mix(in oklab, var(--color-accent) 16%, transparent)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <Icon
                      name="arrow-right"
                      size={14}
                      style={{
                        color: "var(--color-accent)",
                        marginTop: 3,
                        flexShrink: 0,
                      }}
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="text-small" style={{ fontWeight: 500 }}>
                        {MODIFIER_LABEL[m.kind] ?? "Adjusted"}
                      </div>
                      <div
                        className="text-small"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        {m.effect}
                      </div>
                      {m.finding_module_key ? (
                        // The "See finding" link uses the hash-based
                        // dashboard anchor — habitat tiles don't have
                        // individual deep-link routes today, so the
                        // dashboard #habitat anchor scrolls the user
                        // into the section and they pick the relevant
                        // tile from there. Good enough for v1.
                        <Link
                          href="/dashboard#habitat"
                          className="text-small inline-flex items-center gap-1"
                          style={{
                            color: "var(--color-accent)",
                            marginTop: 2,
                          }}
                        >
                          See finding
                          <Icon name="chevron-right" size={12} />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reasoning.anchor?.detail ? (
            <div className="flex flex-col gap-1">
              <div
                className="eyebrow"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Anchor
              </div>
              <div
                className="text-small"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {reasoning.anchor.detail}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatCadenceLine(
  kind: string | null,
  months: number | null,
  anchor: string | null,
): string | null {
  if (!kind || kind === "one_time") return null;
  if (kind === "per_use") return "Every time you use it";
  if (kind === "interval" && months) {
    if (months === 1) return "Monthly";
    if (months === 3) return "Every 3 months";
    if (months === 6) return "Every 6 months";
    if (months === 12) return "Annually";
    if (months === 24) return "Every 2 years";
    return `Every ${months} months`;
  }
  if (kind === "seasonal" && months) {
    const anchorLabel = anchor ? SEASONAL_ANCHOR_LABEL[anchor] ?? anchor : null;
    if (months === 12) {
      return anchorLabel ? `Annually · ${anchorLabel}` : "Annually";
    }
    return anchorLabel
      ? `Every ${months} months · ${anchorLabel}`
      : `Every ${months} months`;
  }
  return null;
}
