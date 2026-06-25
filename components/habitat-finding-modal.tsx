"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { triggerHabitatModuleRecheck } from "@/app/(app)/dashboard/actions";
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
  HabitatRecheckSource,
  HabitatRecheckSummary,
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

// Module thumbnail size in the modal header on DESKTOP. Matches
// HERO_PX in HabitatFindingTileCompact so the same image renders at the
// same dimensions in both surfaces — the tile the user clicked and the
// header of the modal that opened.
//
// Issue #228 intentionally decouples this on mobile: the pinned header
// thumbnail shrinks to 44px below the `sm:` breakpoint to claw back
// vertical space (the size is driven by a `--thumb` CSS var on the
// thumbnail wrapper, 44px → 72px at `sm:`). The tile and the modal are
// different surfaces and the user has already transitioned between
// them, so the same-size invariant only needs to hold on desktop. This
// constant stays the desktop value and feeds the image `sizes` hint.
const HEADER_THUMB_PX = 72;

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
  houseId,
  getReturnFocusElement,
}: {
  open: boolean;
  onClose: () => void;
  row: HabitatFindingRow;
  habitatModule: HabitatModule;
  /**
   * Surface-level context the module's `renderOverviewBody` slot may
   * need for house-scoped affordances (e.g. WQA's CCR upload modal).
   * Forwarded as `{ houseId }` to that slot.
   */
  houseId: string;
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

  // Issue #196 — "Recheck findings" affordance + fresh-update banner.
  //
  // `pendingRecheck` holds the trigger metadata between the click (or
  // CCR upload finalize) and the realtime row update that lands when
  // the workflow completes:
  //   - `since` is the wall-clock time the trigger fired; we use it to
  //     ignore stale row updates that arrived before the trigger.
  //   - `source` lets the module's summarizeRecheckChanges slot tune
  //     copy by what kicked off the recheck (manual click vs. CCR
  //     upload).
  //   - `beforeRow` is the snapshot of the persisted finding at trigger
  //     time, so the module's diff function has something to compare
  //     against.
  //
  // `recheckBanner` is the rendered banner payload (or null when
  // nothing's worth surfacing). Set when the matching row update lands;
  // cleared when the user clicks anywhere in the body.
  const [pendingRecheck, setPendingRecheck] = useState<{
    since: number;
    source: HabitatRecheckSource;
    beforeRow: HabitatFindingRow;
  } | null>(null);
  const [recheckBanner, setRecheckBanner] = useState<{
    summary: HabitatRecheckSummary;
    source: HabitatRecheckSource;
  } | null>(null);

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

  // Issue #196 — Watch the row prop for the "recheck just finished"
  // transition. The dashboard's useHabitatFindings keeps the row prop
  // live via Realtime, so when the workflow's final UPSERT lands we
  // see a new row here with status='completed' and a fresh checked_at.
  //
  // The summary computation runs only when a recheck is actually
  // pending — without that guard, every initial mount or unrelated row
  // change would speculatively fire the banner.
  useEffect(() => {
    if (!pendingRecheck) return;
    if (row.status !== "completed") return;
    const checkedAt = row.checked_at
      ? new Date(row.checked_at).getTime()
      : null;
    if (checkedAt === null || checkedAt < pendingRecheck.since) return;

    const summary =
      habitatModule.summarizeRecheckChanges?.(
        pendingRecheck.beforeRow,
        row,
        pendingRecheck.source,
      ) ?? null;

    if (summary !== null) {
      setRecheckBanner({ summary, source: pendingRecheck.source });
    } else if (pendingRecheck.source === "manual") {
      // The user explicitly asked for a recheck and the module had
      // nothing surfaceable to report. We still acknowledge the click
      // — but "nothing changed" IS the positive outcome here (it means
      // the data the user is already looking at is current), so the
      // banner uses the success tone (green) rather than reading as
      // a flat "OK, nothing happened" neutral note.
      setRecheckBanner({
        summary: {
          headline: "Recheck complete — no new changes.",
          tone: "success",
        },
        source: pendingRecheck.source,
      });
    }
    // ccr_upload with no changes is silently no-op; the upload modal's
    // own acknowledgment already covered that path.

    setPendingRecheck(null);
  }, [pendingRecheck, row, habitatModule]);

  // Reset state when the modal closes — otherwise re-opening it would
  // show stale banner content from a previous session.
  useEffect(() => {
    if (open) return;
    setPendingRecheck(null);
    setRecheckBanner(null);
  }, [open]);

  const handleTriggerRecheck = useCallback(
    (source: HabitatRecheckSource) => {
      // Capture the current row as the "before" snapshot. Important to
      // snapshot synchronously here, before the realtime sub flips
      // status='running' and replaces our prop.
      setPendingRecheck({
        since: Date.now(),
        source,
        beforeRow: row,
      });
      setRecheckBanner(null);
      void triggerHabitatModuleRecheck(houseId, habitatModule.key);
    },
    [houseId, habitatModule.key, row],
  );

  // Module-side opt-in for the banner. WQA calls this from its CCR
  // upload modal's onSuccess so the banner that lands ~10-20s later
  // reads as a CCR confirmation rather than a generic recheck note.
  const notifyRecheckTriggered = useCallback(
    (source: HabitatRecheckSource) => {
      setPendingRecheck({
        since: Date.now(),
        source,
        beforeRow: row,
      });
      setRecheckBanner(null);
    },
    [row],
  );

  const dismissBanner = useCallback(() => {
    if (recheckBanner !== null) setRecheckBanner(null);
  }, [recheckBanner]);

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

  // Issue #140: modules that implement getOverviewCards own the card
  // order (Superfund sorts by label-desc → severity-desc → distance-asc
  // in its module file). The modal renders cards in the order the
  // module returns them — re-sorting here would silently override the
  // module's preferred surfacing.
  const cards: OverviewCard[] = habitatModule.getOverviewCards?.(row) ?? [];
  const hasCards = cards.length > 0;
  const overviewCardsHeader = habitatModule.overviewCardsHeader ?? "Details";

  // Issue #140: optional module slot that replaces the severity word
  // in the header eyebrow. The slot return value disambiguates three
  // cases:
  //   - object → render that word in the eyebrow
  //   - null   → explicit suppression (show nothing for the second
  //              eyebrow word; the severity dot + module name stay)
  //   - undefined (or slot not implemented) → fall back to the default
  //              severity-word treatment so legacy rows persisted before
  //              the module gained the slot keep rendering the severity
  //              word until the next yearly cadence backfills
  const findingLabelResult = habitatModule.getFindingLabel?.(row);
  const findingLabelSuppressed = findingLabelResult === null;
  const findingLabelObject =
    findingLabelResult && findingLabelResult !== null ? findingLabelResult : null;
  const showDefaultSeverityWord =
    findingLabelResult === undefined && !findingLabelSuppressed;

  // Issue #140: optional banner above the overview cards. The Superfund
  // module returns its AI-generated portfolio summary here.
  const overviewBanner = habitatModule.getOverviewBanner?.(row) ?? null;

  // Issue #144: optional "recommended actions" section rendered
  // between the banner and the overview cards. Modules compute the
  // cards from their own data (Superfund: water source × pathway
  // profile); the modal owns the rendering. Empty array suppresses
  // the section entirely.
  const recommendedActions = habitatModule.getRecommendedActions?.(row) ?? [];
  const hasRecommendedActions = recommendedActions.length > 0;

  // Issue #171 (WQA-4): a module can take over the entire body
  // between the header and the activity log. When present, the
  // banner / recommended-actions / overview-cards / generic-actions
  // sections are bypassed entirely — the module renders whatever it
  // wants. Activity log + footer still come from the modal shell.
  const overviewBody =
    habitatModule.renderOverviewBody?.(row, {
      houseId,
      notifyRecheckTriggered,
    }) ?? null;
  const hasCustomOverviewBody = overviewBody !== null;

  // Issue #196 — Recheck affordance. "Running" combines two signals:
  //   * `row.status === 'running'` — the server has acknowledged the
  //     trigger and the workflow is in flight.
  //   * `pendingRecheck !== null` — we just fired a trigger locally
  //     but haven't yet seen the row flip via Realtime.
  //
  // The second signal matters because some modules (radon, for one)
  // run sub-second on the server, so the `status='running'` upsert
  // and the `status='completed'` upsert can deliver inside a single
  // React render batch — without local pendingRecheck we'd never
  // visibly show the in-flight state. The local signal also gives
  // immediate feedback on the click, eliminating the perceived
  // network round-trip before anything happens.
  //
  // We don't gate by `module.isApplicable(houseContext)` here because
  // if the modal is open at all, the user got here by clicking the
  // tile — which only renders when the module produced a finding for
  // this house, i.e. it was applicable.
  const isRunning = row.status === "running" || pendingRecheck !== null;
  const recheckLabel = isRunning ? "Rechecking…" : "Recheck findings";

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
      // Intentionally no backdrop-click-to-close: the finding modal now hosts
      // rich interactive surfaces (the trend popover, copy button, the upload
      // flow), and a stray click outside dumping the user back to the
      // dashboard was jarring. Close is via the X button or Esc only.
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
          {habitatModule.iconImage ? (
            // Issue #228: shrink the pinned thumbnail on mobile (44px)
            // to claw back vertical space, full size (72px) on desktop.
            // Driven off a `--thumb` CSS var set by utility classes — an
            // inline `width`/`height` would win over a `sm:` class, so
            // the breakpoint override lives on the var, not the size.
            <div
              className="relative overflow-hidden shrink-0 [--thumb:44px] sm:[--thumb:72px]"
              style={{
                width: "var(--thumb)",
                height: "var(--thumb)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border-subtle)",
                backgroundColor: "var(--color-bg-surface-raised)",
              }}
            >
              <Image
                src={habitatModule.iconImage}
                alt=""
                fill
                sizes={`${HEADER_THUMB_PX}px`}
                style={{ objectFit: "cover" }}
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <SeverityDot severity={severity} />
              <span className="eyebrow">{habitatModule.name}</span>
              {findingLabelObject ? (
                <span
                  className="eyebrow"
                  style={{ color: findingLabelObject.color }}
                >
                  {findingLabelObject.word}
                </span>
              ) : showDefaultSeverityWord ? (
                <span
                  className="eyebrow"
                  style={{ color: SEVERITY_COLOR[severity] }}
                >
                  {SEVERITY_WORD[severity]}
                </span>
              ) : null}
            </div>
            <h2 id={titleId} className="h2 mt-0.5">
              {headline}
            </h2>
            {/* Issue #228: on mobile the summary moves out of the pinned
                header into the scroll region (re-emitted below in the
                overview pane). Desktop keeps it inline here, in both the
                overview and detail panes, exactly as before. */}
            <p
              className="text-small mt-1 hidden sm:block"
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
          <div
            className="overflow-y-auto p-4 sm:p-5 space-y-5"
            onClick={dismissBanner}
          >
            {/* Issue #228: mobile-only relocation of the header summary
                into the scroll flow (the pinned-header copy above is
                `hidden sm:block`). Same visual treatment as the header
                version; absent on desktop and in the detail pane. */}
            <p
              className="text-small sm:hidden"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {summary}
            </p>
            {recheckBanner ? (
              <RecheckBanner
                summary={recheckBanner.summary}
                onDismiss={dismissBanner}
              />
            ) : null}
            {hasCustomOverviewBody ? (
              // Issue #171: module-owned body. Skip the default
              // banner / recommended-actions / cards / actions
              // sections — the module's renderOverviewBody is
              // expected to include anything it needs from those.
              <section aria-labelledby={`${titleId}-custom-body`}>
                <div id={`${titleId}-custom-body`}>{overviewBody}</div>
              </section>
            ) : (
              <>
                {overviewBanner ? (
                  <section aria-labelledby={`${titleId}-banner`}>
                    <div
                      id={`${titleId}-banner`}
                      className="rounded-md"
                      style={{
                        border: "1px solid var(--color-border-subtle)",
                        backgroundColor: "var(--color-bg-surface-raised)",
                        padding: "var(--space-4)",
                        color: "var(--color-text-primary)",
                        fontSize: 14,
                        lineHeight: 1.55,
                      }}
                    >
                      {overviewBanner.text}
                    </div>
                  </section>
                ) : null}

                {hasRecommendedActions ? (
                  <section aria-labelledby={`${titleId}-recommended-actions`}>
                    <div
                      id={`${titleId}-recommended-actions`}
                      className="eyebrow mb-2"
                    >
                      Recommended for your situation
                    </div>
                    <ul className="flex flex-col gap-2">
                      {recommendedActions.map((action) => (
                        <li key={action.id}>
                          <RecommendedActionCard action={action} />
                        </li>
                      ))}
                    </ul>
                    {/*
                      Section-level disclaimer. The action cards (today, all
                      Superfund) link out to EPA directories — the CCR
                      search tool, the certified-lab listing, the vapor-
                      intrusion overview. Live testing surfaced that the
                      CCR directory can list utility entries whose own
                      "CCR website" links 404, and the directory's coverage
                      isn't always current. Hardcoded here (rather than
                      per-action) because every current action links to
                      an EPA resource and the fallback advice is the same;
                      if a future module ever returns actions that don't
                      link to EPA, this becomes a slot-driven field.
                    */}
                    <p
                      className="text-small mt-3"
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      EPA&rsquo;s directories aren&rsquo;t always complete
                      or current. If a link is broken or your utility
                      isn&rsquo;t listed, your city or county water
                      department is the most reliable next step.
                    </p>
                  </section>
                ) : null}

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
              </>
            )}

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
                    fontWeight: 500,
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
          <span className="flex items-center gap-3 min-w-0">
            <span className="truncate">
              {checkedAtFormatted ? `Last checked ${checkedAtFormatted}` : ""}
            </span>
            <button
              type="button"
              onClick={() => handleTriggerRecheck("manual")}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5"
              style={{
                color: isRunning
                  ? "var(--color-text-tertiary)"
                  : "var(--color-text-secondary)",
                cursor: isRunning ? "wait" : "pointer",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: 3,
              }}
              aria-label={
                isRunning
                  ? "Recheck in progress"
                  : "Re-run this habitat check"
              }
            >
              {isRunning ? <Spinner /> : null}
              <span>{recheckLabel}</span>
            </button>
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
        {card.subheading ? (
          // Issue #145: optional second-line emphasis between headline
          // and subtitle. Primary text color but at small size — more
          // present than the subtitle's secondary muted treatment,
          // visually subordinate to the h3 headline above. Not
          // line-clamped: the subheading is usually short (e.g. "Heavy
          // metals and PCBs and dioxins") and a wrap on rare long
          // phrases reads better than truncation.
          <div
            className="text-small"
            style={{
              color: "var(--color-text-primary)",
              marginBottom: 2,
            }}
          >
            {card.subheading}
          </div>
        ) : null}
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
  // The decorative centerline rule lives in a wrapper div instead of
  // inside the <ol> — the HTML spec forbids non-<li> direct children of
  // <ol>. Wrapper is the positioning context for the rule; the <ol>'s
  // padding-left still owns the badge column so the math is unchanged.
  return (
    <div className="relative">
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
      <ol
        className="flex flex-col gap-4"
        style={{ paddingLeft: "var(--space-6)" }}
      >
        {steps.map((step) => (
          <ActivityLogStep key={step.step} step={step} />
        ))}
      </ol>
    </div>
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

/**
 * Issue #144 recommended-action card. Renders one action as an
 * icon + headline + supporting line + optional external link. The
 * data shape is module-defined (see getRecommendedActions on
 * HabitatModule); the modal owns the visual treatment so every
 * future module that opts into recommended actions gets the same
 * card chrome for free.
 */
function RecommendedActionCard({
  action,
}: {
  action: {
    id: string;
    icon: string;
    headline: string;
    supporting_line: string;
    link?: { label: string; url: string };
  };
}) {
  return (
    <div
      className="rounded-md flex items-start gap-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: "var(--radius-md)",
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 14%, transparent)",
          color: "var(--color-accent)",
        }}
      >
        <Icon name={action.icon as never} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {action.headline}
        </div>
        <p
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            margin: 0,
            marginTop: 4,
            lineHeight: 1.55,
          }}
        >
          {action.supporting_line}
        </p>
        {action.link ? (
          <div className="text-small mt-2">
            <a
              href={action.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-accent)" }}
            >
              <span>{action.link.label}</span>
              <Icon name="external-link" size={14} />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- recheck-affordance support ------------------------------- */

/**
 * Fresh-update banner that surfaces at the top of the modal body when a
 * recheck completes. Module-provided headline + tone; the shell owns
 * the strip layout and the dismiss affordance. Issue #196.
 */
function RecheckBanner({
  summary,
  onDismiss,
}: {
  summary: HabitatRecheckSummary;
  onDismiss: () => void;
}) {
  const accent =
    summary.tone === "success"
      ? "var(--color-success)"
      : summary.tone === "info"
        ? "var(--color-info)"
        : "var(--color-text-secondary)";
  const background =
    summary.tone === "success"
      ? "color-mix(in oklab, var(--color-success) 14%, transparent)"
      : summary.tone === "info"
        ? "color-mix(in oklab, var(--color-info) 14%, transparent)"
        : "var(--color-bg-surface-raised)";
  const border =
    summary.tone === "success"
      ? "color-mix(in oklab, var(--color-success) 35%, transparent)"
      : summary.tone === "info"
        ? "color-mix(in oklab, var(--color-info) 35%, transparent)"
        : "var(--color-border-subtle)";
  const iconName =
    summary.tone === "success" ? "circle-check" : "info";
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md flex items-center gap-3 p-3"
      style={{
        border: `1px solid ${border}`,
        backgroundColor: background,
      }}
    >
      <span aria-hidden className="shrink-0" style={{ color: accent }}>
        <Icon name={iconName as never} size={18} />
      </span>
      <p
        className="text-small"
        style={{
          color: "var(--color-text-primary)",
          fontWeight: 500,
          lineHeight: 1.55,
          margin: 0,
          flex: 1,
        }}
      >
        {summary.headline}
      </p>
      <button
        type="button"
        onClick={(e) => {
          // Stop the click from bubbling to the body's onClick that also
          // dismisses — both run the same handler, but a stop here keeps
          // the X press from looking double-counted in tests.
          e.stopPropagation();
          onDismiss();
        }}
        className="btn btn-ghost btn-icon shrink-0"
        style={{
          padding: 4,
          color: "var(--color-text-tertiary)",
        }}
        aria-label="Dismiss this update"
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Inline spinner for the footer "Rechecking…" state. Borrowed from the
 * CcrUploadModal pattern — three-line declaration via inline animation.
 */
function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border-2"
      style={{
        borderColor:
          "color-mix(in oklab, var(--color-text-secondary) 30%, transparent)",
        borderTopColor: "var(--color-text-secondary)",
        animation: "spin 0.8s linear infinite",
      }}
      aria-hidden
    />
  );
}
