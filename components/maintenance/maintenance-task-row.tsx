"use client";

// Single task row inside the "On your plate" panel (issue #133). The
// whole row is a real <button> so keyboard focus, screen reader
// semantics, and tap mechanics work without inventing custom roles.
// The row stays presentational — it forwards onClick + ref to the
// MaintenanceTaskTrigger wrapper that owns modal state and return-focus
// (issue #137). Keeping the visual treatment here separate from the
// interaction lets the row be reused in non-modal contexts (history
// lists, future reports) without dragging trigger state along.

import { forwardRef } from "react";
import { Icon, type IconName } from "@/components/icon";

export type MaintenanceTaskRowData = {
  id: string;
  inventory_id: string | null;
  kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
  title: string;
  subtitle: string | null;
  next_due_at: string;
  source: "direct_event" | "synthesis";
  /**
   * The display name of the inventory item this task belongs to. Set by
   * the dashboard wrapper so house-scoped rows can call out *which*
   * appliance the task is for ("Check and refill rinse aid" alone isn't
   * obvious; "DISHWASHER · Check and refill rinse aid" is). The item-
   * scoped wrapper leaves this null — the user is already on the item's
   * page, so the context is implicit.
   */
  inventoryName: string | null;
  /**
   * Cadence kind, carried through so the panel can route per-use rows
   * (issue #135) to their own tier inside the same panel rather than
   * mixing them into the date-anchored tiers. Optional / nullable
   * because legacy rows and the dashboard panel's pre-filtered query
   * may not need it; the panel treats anything other than 'per_use' as
   * a scheduled row.
   */
  cadence_kind?: "interval" | "seasonal" | "one_time" | "per_use" | null;
};

export type RowTone = "danger" | "caution" | "neutral";
// 'none' suppresses the right-side label and chevron for per-use rows
// (issue #135) — those have no meaningful due-date to display, and
// hiding both keeps the row visually clean inside the shared panel.
export type RightLabelMode = "overdue" | "date_pill" | "relative_time" | "none";

const KIND_ICON: Record<MaintenanceTaskRowData["kind"], IconName> = {
  renewal: "car",
  service: "tool",
  inspection: "search",
  consumable: "refresh-cw",
  seasonal: "leaf",
};

export type MaintenanceTaskRowProps = {
  task: MaintenanceTaskRowData;
  tone: RowTone;
  relativeMode: RightLabelMode;
  /** Open the task detail modal. Owned by MaintenanceTaskTrigger (issue #137). */
  onClick?: () => void;
};

export const MaintenanceTaskRow = forwardRef<
  HTMLButtonElement,
  MaintenanceTaskRowProps
>(function MaintenanceTaskRow({ task, tone, relativeMode, onClick }, ref) {
  const rightLabel = formatRightLabel(task.next_due_at, relativeMode);
  const accent = formatAccent(task.next_due_at, tone);
  const toneColor = toneAccentColor(tone);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-[var(--radius-md)] transition-colors flex items-center gap-3 p-3 sm:p-4"
      style={{
        // Row background: danger gets a red-tinted surface for the loud
        // "take action now" cue. Everything else (caution = next 30 days,
        // neutral = later this season + per-use) shares the same calm
        // bg-surface so the three non-overdue tiers read as one visual
        // family — the tier divider color, icon backdrop tint, and right-
        // label color carry the per-tier nuance from there.
        backgroundColor:
          tone === "danger"
            ? "color-mix(in oklab, var(--color-danger) 8%, var(--color-bg-surface))"
            : "var(--color-bg-surface)",
        border: "1px solid transparent",
        borderLeft:
          tone === "danger" ? `3px solid ${toneColor}` : undefined,
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor:
            tone === "neutral"
              ? "var(--color-bg-surface-raised)"
              : `color-mix(in oklab, ${toneColor} 18%, transparent)`,
          color: tone === "neutral" ? "var(--color-text-secondary)" : toneColor,
        }}
      >
        <Icon name={KIND_ICON[task.kind]} size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <div
          className="flex items-center gap-2 min-w-0"
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          <span className="truncate">{task.title}</span>
          {accent ? (
            <span
              className="shrink-0 px-1.5 py-0.5 rounded-md uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in oklab, ${toneColor} 22%, transparent)`,
                color: toneColor,
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.08em",
              }}
            >
              {accent}
            </span>
          ) : null}
        </div>
        {task.inventoryName || task.subtitle ? (
          <div
            className="text-small truncate"
            style={{
              color: "var(--color-text-secondary)",
              marginTop: 2,
            }}
          >
            {task.inventoryName ? (
              <>
                <span
                  style={{
                    color: "var(--color-text-tertiary)",
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginRight: 6,
                  }}
                >
                  {task.inventoryName}
                </span>
                {task.subtitle ? (
                  <>
                    <span
                      aria-hidden
                      style={{
                        color: "var(--color-text-tertiary)",
                        marginRight: 6,
                      }}
                    >
                      ·
                    </span>
                    {task.subtitle}
                  </>
                ) : null}
              </>
            ) : (
              task.subtitle
            )}
          </div>
        ) : null}
      </div>

      {relativeMode === "none" ? null : (
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-small"
            style={{
              color:
                tone === "neutral"
                  ? "var(--color-text-tertiary)"
                  : "var(--color-text-secondary)",
            }}
          >
            {rightLabel}
          </span>
          <span aria-hidden style={{ color: "var(--color-text-tertiary)" }}>
            <Icon name="chevron-right" size={14} />
          </span>
        </div>
      )}
    </button>
  );
});

function toneAccentColor(tone: RowTone): string {
  if (tone === "danger") return "var(--color-danger)";
  if (tone === "caution") return "var(--color-warning)";
  return "var(--color-text-secondary)";
}

// Exported so the test harness can pin the label vocabulary without
// instantiating the React tree.
export function formatRightLabel(
  nextDueAt: string,
  mode: RightLabelMode,
  reference: Date = new Date(),
): string {
  if (mode === "none") return "";
  const due = parseDateOnly(nextDueAt);
  if (!due) return nextDueAt;

  if (mode === "date_pill") {
    return due.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const today = normalizeToDateOnly(reference);
  const diffDays = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (mode === "overdue") {
    const lateDays = -diffDays;
    if (lateDays < 7) return `${lateDays} day${lateDays === 1 ? "" : "s"} late`;
    if (lateDays < 60) {
      const weeks = Math.round(lateDays / 7);
      return `${weeks} week${weeks === 1 ? "" : "s"} late`;
    }
    const months = Math.round(lateDays / 30);
    return `${months} month${months === 1 ? "" : "s"} late`;
  }

  // relative_time — "later this season" tier
  if (diffDays < 60) {
    const weeks = Math.round(diffDays / 7);
    return `~${weeks} weeks`;
  }
  const months = Math.round(diffDays / 30);
  return `~${months} months`;
}

// Accent badges are deliberately sparse — only the loudest overdue rows
// get one so the badge retains signal. Mild overdue (< 7 days) lets the
// right-side "X days late" string do the work without doubling up.
function formatAccent(nextDueAt: string, tone: RowTone): string | null {
  if (tone !== "danger") return null;
  const due = parseDateOnly(nextDueAt);
  if (!due) return null;
  const today = normalizeToDateOnly(new Date());
  const lateDays = Math.round(
    (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (lateDays >= 90) return "CRITICAL";
  if (lateDays >= 30) {
    const months = Math.round(lateDays / 30);
    return `${months} MONTHS LATE`;
  }
  return null;
}

function normalizeToDateOnly(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function parseDateOnly(yyyymmdd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}
