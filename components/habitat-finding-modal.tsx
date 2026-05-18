"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { HabitatActionChip } from "./habitat-action-chip";
import {
  SEVERITY_COLOR,
  SEVERITY_WORD,
  SeverityDot,
  severityWeight,
} from "./habitat-severity";
import type { ActivityStep } from "@/lib/habitat/activity-log";
import type {
  FindingAction,
  HabitatModule,
  HabitatSeverity,
  OverviewCard,
} from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";

/**
 * Finding detail modal for a single hearth.habitat_findings row.
 *
 * Generic shell that renders directly from the HabitatFinding shape
 * (headline, summary, actions, source_url, activity_log) and opts into
 * richer per-module content through two optional slots on
 * HabitatModule:
 *
 *   - getOverviewCards(row) returns one card per drillable item.
 *     Cards land between the action shelf and the activity log on
 *     the overview pane. Clicking one swaps the body to the detail pane.
 *   - renderDetail(row, cardId) returns the body content for the
 *     detail pane. The shell wraps it with a prominent back affordance
 *     and reuses the same header / footer the overview pane uses.
 *
 * Modules that implement neither get exactly the modal they had before
 * the slotted shell landed.
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

/**
 * Sort overview cards severity-desc, subtitle-asc. Stable, pure.
 */
function compareOverviewCards(a: OverviewCard, b: OverviewCard): number {
  const w = severityWeight(b.severity) - severityWeight(a.severity);
  if (w !== 0) return w;
  return a.subtitle.localeCompare(b.subtitle);
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
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const prevActiveCardIdRef = useRef<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // Wrap onClose so closing the modal (from the close button, ESC, or
  // backdrop click) synchronously clears the pane state. Done here
  // rather than from a `useEffect(() => { if (!open) reset() })` so
  // the reset isn't a setState-in-effect (cascading render); the
  // setActiveCardId(null) call batches with whatever onClose triggers
  // in the parent. The next open lands on the overview pane without
  // flashing detail-pane content.
  const handleClose = useCallback(() => {
    setActiveCardId(null);
    prevActiveCardIdRef.current = null;
    onClose();
  }, [onClose]);

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
        handleClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables =
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
  }, [open, handleClose, getReturnFocusElement]);

  // Pane-transition focus management. Entering detail focuses the back
  // affordance so screen readers announce the pane change and keyboard
  // users can return immediately; leaving detail returns focus to the
  // originating card. Uses a previous-value ref so the very first
  // commit (no transition yet) is a no-op.
  useEffect(() => {
    if (!open) return;
    const prev = prevActiveCardIdRef.current;
    prevActiveCardIdRef.current = activeCardId;
    if (prev === null && activeCardId !== null) {
      requestAnimationFrame(() => backButtonRef.current?.focus());
    } else if (prev !== null && activeCardId === null) {
      const target = cardRefs.current.get(prev);
      requestAnimationFrame(() => target?.focus());
    }
  }, [activeCardId, open]);

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

  const rawCards = habitatModule.getOverviewCards?.(row) ?? [];
  const cards = [...rawCards].sort(compareOverviewCards);
  const hasCards = cards.length > 0;
  const overviewCardsHeader = habitatModule.overviewCardsHeader ?? "Details";

  const activeCard =
    activeCardId !== null
      ? (cards.find((c) => c.id === activeCardId) ?? null)
      : null;
  const detailContent =
    activeCard && habitatModule.renderDetail
      ? habitatModule.renderDetail(row, activeCard.id)
      : null;
  const showDetailPane = activeCard !== null && detailContent !== null;

  const footerSourceUrl = activeCard?.sourceUrl ?? row.source_url ?? null;

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
        if (e.target === e.currentTarget) handleClose();
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
            onClick={handleClose}
            className="btn btn-ghost btn-icon"
            aria-label="Close finding detail"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        {showDetailPane ? (
          <DetailPane
            backButtonRef={backButtonRef}
            onBack={() => setActiveCardId(null)}
            totalCards={cards.length}
          >
            {detailContent}
          </DetailPane>
        ) : (
          <div className="overflow-y-auto p-4 sm:p-5 space-y-5">
            {hasCards ? (
              <section aria-labelledby={`${titleId}-cards`}>
                <div id={`${titleId}-cards`} className="eyebrow mb-2">
                  {overviewCardsHeader}
                </div>
                <ul className="flex flex-col gap-2">
                  {cards.map((card) => (
                    <li key={card.id}>
                      <OverviewCardButton
                        card={card}
                        onClick={() => setActiveCardId(card.id)}
                        registerRef={(el) => {
                          if (el) cardRefs.current.set(card.id, el);
                          else cardRefs.current.delete(card.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

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
        )}

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
            {footerSourceUrl ? (
              <a
                href={footerSourceUrl}
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

/**
 * The detail-pane shell. The shell owns the back affordance and the
 * scroll container; the module's renderDetail() supplies the body
 * content with no inner chrome.
 *
 * Back-affordance contract (UX-load-bearing, see issue): subtle but
 * unmistakable, full-width sticky row at the top of the scroll area,
 * 44px minimum height for fat-finger taps. Label includes the total
 * card count when there's more than one card so the user is anchored
 * on what they're coming back to.
 */
function DetailPane({
  backButtonRef,
  onBack,
  totalCards,
  children,
}: {
  backButtonRef: React.RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  totalCards: number;
  children: React.ReactNode;
}) {
  const label =
    totalCards > 1
      ? `Back to all ${totalCards} findings`
      : "Back to all findings";
  return (
    <div className="overflow-y-auto">
      <div
        className="sticky top-0 z-10"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <button
          ref={backButtonRef}
          type="button"
          onClick={onBack}
          aria-label="Return to finding overview"
          className="w-full flex items-center gap-2 px-4 sm:px-5 text-left transition-colors hover:bg-(--color-bg-surface) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
          style={{
            minHeight: 44,
            color: "var(--color-text-primary)",
            fontWeight: 500,
          }}
        >
          <Icon name="chevron-left" size={18} />
          <span>{label}</span>
        </button>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

/**
 * One overview card. Visual treatment scales down HabitatFindingTileCompact
 * for the inside-modal context: same severity dot + eyebrow + headline +
 * subtitle stack, no 72px hero image, full-width clickable surface.
 */
function OverviewCardButton({
  card,
  onClick,
  registerRef,
}: {
  card: OverviewCard;
  onClick: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={registerRef}
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-md flex items-center gap-3 transition-colors hover:bg-(--color-bg-surface-raised) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
      style={{
        border: "1px solid var(--color-border-subtle)",
        padding: "var(--space-3)",
        backgroundColor: "transparent",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <SeverityDot severity={card.severity} />
          <span className="eyebrow">{card.eyebrow}</span>
        </div>
        <div className="h3" style={{ marginBottom: 2 }}>
          {card.headline}
        </div>
        <div
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.subtitle}
        </div>
      </div>
      <span
        aria-hidden
        className="shrink-0 transition-transform group-hover:translate-x-0.5"
        style={{ color: "var(--color-text-tertiary)", lineHeight: 0 }}
      >
        <Icon name="chevron-right" size={18} />
      </span>
    </button>
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
        <p style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
          {step.narration}
        </p>
        {step.result_summary ? (
          <span
            className="mono inline-block mt-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 11,
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
              fontSize: 11,
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
