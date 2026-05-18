"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { HabitatActionChip } from "./habitat-action-chip";
import {
  SEVERITY_COLOR,
  SEVERITY_WORD,
  SeverityDot,
} from "./habitat-severity";
import type { ActivityStep } from "@/lib/habitat/activity-log";
import type {
  FindingAction,
  HabitatModule,
  HabitatSeverity,
} from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";

/**
 * Finding detail modal for a single hearth.habitat_findings row.
 *
 * Generic by design — renders from the HabitatFinding shape only
 * (headline, summary, actions, source_url, activity_log). No per-module
 * branches; structured per-module content (Superfund map, timeline)
 * gets designed when a richer module forces the slotted-shell contract
 * that's deferred today.
 *
 * Modal mechanics (scroll-lock, focus trap, ESC, backdrop close, return
 * focus) are lifted from DocumentModal rather than extracted into a
 * shared primitive — two callers is the threshold for extraction and
 * we'd have exactly two after this lands. When a third modal appears,
 * pull a shared base out of the two of them in one step.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const ACTIVITY_LOG_FALLBACK_COPY =
  "This finding was recorded before we started capturing how it was computed. The next time we check, you'll see the full reasoning here.";

function formatCheckedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isInternalUrl(url: string): boolean {
  return url.startsWith("/");
}

export function HabitatFindingModal({
  open,
  onClose,
  row,
  habitatModule,
  getReturnFocusElement,
}: {
  open: boolean;
  onClose: () => void;
  row: HabitatFindingRow;
  habitatModule: HabitatModule;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [logOpen, setLogOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (
          e.shiftKey &&
          (active === first || !dialogRef.current.contains(active))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
      getReturnFocusElement?.()?.focus();
    };
  }, [open, onClose, getReturnFocusElement]);

  if (!open) return null;

  // The hook types these loosely; once the panel filters by populated
  // severity/headline/summary, the modal can trust them. The trigger
  // wrapper only renders when these are present, but cast defensively.
  const severity = row.severity as HabitatSeverity;
  const headline = row.headline ?? "";
  const summary = row.summary ?? "";
  const actions = (row.actions ?? null) as FindingAction[] | null;
  const hasActions = Array.isArray(actions) && actions.length > 0;
  const checkedAtFormatted = formatCheckedAt(row.checked_at ?? null);
  const activityLog = row.activity_log ?? null;
  const steps: ActivityStep[] | null =
    activityLog && Array.isArray(activityLog.steps) ? activityLog.steps : null;
  const hasSteps = steps !== null && steps.length > 0;

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface-ai relative w-full max-w-3xl max-h-[92dvh] overflow-hidden flex flex-col"
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <SeverityDot severity={severity} />
              <span className="eyebrow">{habitatModule.name}</span>
              <span
                className="eyebrow"
                style={{ color: SEVERITY_COLOR[severity] }}
              >
                {SEVERITY_WORD[severity]}
              </span>
            </div>
            <h2 id={titleId} className="h2 mt-0.5">
              {headline}
            </h2>
            <p
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {summary}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon"
            aria-label="Close finding detail"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-5">
          {hasActions ? (
            <section aria-labelledby={`${titleId}-actions`}>
              <div id={`${titleId}-actions`} className="eyebrow mb-2">
                What to do next
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.map((action, i) => (
                  <HabitatActionChip
                    key={`${action.kind}:${action.url}:${i}`}
                    action={action}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby={`${titleId}-log`}>
            <button
              type="button"
              onClick={() => setLogOpen((v) => !v)}
              aria-expanded={logOpen}
              aria-controls={`${titleId}-log-body`}
              className="flex items-center gap-1.5 mb-2 -ml-1 px-1 py-0.5 rounded transition-colors hover:bg-(--color-bg-surface-raised) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
            >
              <Icon
                name="chevron-down"
                size={14}
                className={`transition-transform ${logOpen ? "" : "-rotate-90"}`}
              />
              <h3
                id={`${titleId}-log`}
                className="text-small"
                style={{
                  color: "var(--color-text-secondary)",
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                How we got here
              </h3>
            </button>
            {logOpen ? (
              <div id={`${titleId}-log-body`}>
                {hasSteps ? (
                  <ActivityLogTimeline steps={steps} />
                ) : (
                  <p
                    className="text-small"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    {ACTIVITY_LOG_FALLBACK_COPY}
                  </p>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <footer
          className="flex items-center justify-between gap-3 p-3 sm:p-4 text-small"
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-tertiary)",
          }}
        >
          <span>
            {checkedAtFormatted ? `Last checked ${checkedAtFormatted}` : ""}
          </span>
          <span className="flex items-center gap-3">
            {row.source_url ? (
              <a
                href={row.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>View source</span>
                <Icon name="external-link" size={14} />
              </a>
            ) : null}
            <span>
              Press <kbd className="mono">Esc</kbd> to close
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}

function ActivityLogTimeline({ steps }: { steps: ActivityStep[] }) {
  return (
    <ol
      className="relative flex flex-col gap-4"
      style={{
        // 1px rule running down the centerline of the step badges. Left
        // offset matches the badge's half-width so the rule passes
        // through the badge center.
        paddingLeft: "var(--space-6)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "calc(var(--space-3) - 0.5px)",
          top: 6,
          bottom: 6,
          width: 1,
          backgroundColor: "var(--color-border-subtle)",
        }}
      />
      {steps.map((step) => (
        <ActivityLogStep key={step.step} step={step} />
      ))}
    </ol>
  );
}

function ActivityLogStep({ step }: { step: ActivityStep }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute flex items-center justify-center mono"
        style={{
          left: "calc(-1 * var(--space-6) + var(--space-3) - 10px)",
          top: 2,
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: "var(--color-bg-surface-raised)",
          border: "1px solid var(--color-border-subtle)",
          color: "var(--color-text-tertiary)",
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        {step.step}
      </span>
      <div className="min-w-0">
        <p style={{ color: "var(--color-text-primary)" }}>{step.narration}</p>
        {step.result_summary ? (
          <span
            className="mono inline-block mt-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 12,
              backgroundColor: "var(--color-bg-surface-raised)",
              color: "var(--color-text-secondary)",
            }}
          >
            {step.result_summary}
          </span>
        ) : null}
        {step.detail ? (
          <div
            className="mono mt-1.5"
            style={{
              fontSize: 12,
              color: "var(--color-text-tertiary)",
              paddingLeft: "var(--space-2)",
            }}
          >
            {step.detail}
          </div>
        ) : null}
        {step.source ? (
          <div className="text-small mt-1.5">
            <a
              href={step.source.url}
              {...(isInternalUrl(step.source.url)
                ? {}
                : { target: "_blank", rel: "noopener noreferrer" })}
              style={{ color: "var(--color-text-secondary)" }}
            >
              Source: {step.source.label}
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}
