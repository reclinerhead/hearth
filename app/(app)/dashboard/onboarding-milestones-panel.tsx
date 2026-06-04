"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { markFoundationCelebrationSeenAction } from "@/app/actions/houses/mark-foundation-celebration-seen";
import { Icon } from "@/components/icon";
import { SmartUploader } from "@/components/smart-uploader/SmartUploader";
import {
  GO_DEEPER_CARDS,
  GO_DEEPER_HEADER,
  GO_DEEPER_NEXT_EYEBROW,
  isAllComplete,
  resolvePanelView,
  type GoDeeperAction,
  type GoDeeperMode,
  type Milestone,
  type MilestoneAction,
} from "./onboarding-milestones";

/**
 * Dashboard onboarding-milestones panel (issue #216).
 *
 * A small set of awareness-framed cards that appear after setup, nudging the
 * user toward the handful of high-value first actions (record an emergency
 * video, add a first appliance, add a home photo, review habitat findings).
 * As each milestone completes — derived server-side from real data, never a
 * tracked checklist — its card flips to a green "done" tile and persists in
 * the grid so the user sees their progress; the whole panel retires once every
 * milestone is done, leaving the dashboard in its normal shape with no layout
 * hole.
 *
 * Render-nothing-when-empty makes this safe to ship un-flagged: an empty
 * `milestones` list (or an all-complete one whose reward beat has already
 * shown) renders nothing at all.
 *
 * The CTAs deep-link to each action's surface:
 *   - Emergency video / first appliance open the Smart Uploader (hosted
 *     here) directly — those surfaces are modals, so there's nowhere to
 *     scroll to.
 *   - Home photo / habitat scroll to their inline surfaces (the hero image
 *     surface owns the photo picker; opening any habitat finding modal is
 *     what stamps `habitat_reviewed`). They live just below this panel.
 *
 * Once every milestone is complete the panel hands off to the **go-deeper
 * panel** (issue #220) — the old single-line retire beat grown into a
 * re-openable "ways to go deeper" surface. It shows in `celebration` mode on
 * the final-flip load (auto, dismissible) and in `reopen` mode when the user
 * clicks the dashboard `?` trigger later (`reopened` / `onCloseReopen` props,
 * owned by the coordinator that also hosts `DashboardLive`).
 */

function scrollToAnchor(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function OnboardingMilestonesPanel({
  houseId,
  milestones,
  celebrationSeen,
  reopened = false,
  onCloseReopen,
  onOpenHomeDetails,
}: {
  houseId: string;
  milestones: Milestone[];
  /**
   * Durable server flag (issue #269): true once the foundation-complete
   * celebration has auto-shown. Decided server-side from
   * `houses.onboarding_state.foundation_celebration_seen` so the beat appears
   * exactly once, ever, and never re-surfaces in a later session.
   */
  celebrationSeen: boolean;
  /** True when the dashboard `?` trigger has opened the go-deeper panel. */
  reopened?: boolean;
  /** Close the reopened go-deeper panel (the `?`-opened one). */
  onCloseReopen?: () => void;
  /** Open the home-details edit modal (go-deeper card 3), owned by DashboardLive. */
  onOpenHomeDetails?: () => void;
}) {
  const router = useRouter();

  // Which Smart Uploader flow (if any) is open. Hosting one instance and
  // switching its entry mode keeps a single modal mount.
  const [uploader, setUploader] = useState<null | "appliance" | "emergency">(
    null,
  );

  // The "foundation set" celebration is a one-time reward beat. Whether it has
  // already been seen is now durable server state (`celebrationSeen`, issue
  // #269), so SSR and the first client render agree (no hydration flash) and
  // the beat never re-surfaces in a later session. `dismissed` only hides the
  // live view when the user clicks the `x` this load — the durable stamp below
  // is what keeps it gone afterward.
  const allComplete = isAllComplete(milestones);
  const [dismissed, setDismissed] = useState(false);

  // Stamp the durable flag the moment the celebration auto-shows, so it never
  // auto-returns in a later session. Fire-and-forget and idempotent (the action
  // skips the write when already set) — mirrors the habitat-reviewed stamp. The
  // `?` reopen path is independent and never stamps.
  useEffect(() => {
    if (allComplete && !celebrationSeen) {
      void markFoundationCelebrationSeenAction(houseId);
    }
  }, [allComplete, celebrationSeen, houseId]);

  function runAction(action: MilestoneAction) {
    switch (action) {
      case "open-uploader-appliance":
        setUploader("appliance");
        break;
      case "open-uploader-emergency":
        setUploader("emergency");
        break;
      case "scroll-to-hero":
        scrollToAnchor("dashboard-hero");
        break;
      case "scroll-to-habitat":
        scrollToAnchor("dashboard-habitat");
        break;
    }
  }

  function runGoDeeper(action: GoDeeperAction) {
    switch (action) {
      case "open-uploader-appliance":
        setUploader("appliance");
        break;
      case "open-uploader-emergency":
        setUploader("emergency");
        break;
      case "open-home-details":
        onOpenHomeDetails?.();
        break;
    }
  }

  const view = resolvePanelView(milestones, celebrationSeen || dismissed);

  // The go-deeper panel: `reopen` (manual `?` override) takes precedence over
  // the auto `celebration` beat on the final-flip load. It's independent of
  // the milestone cards — `reopen` can show while cards are still pending, and
  // the `?` never restores dismissed cards (per #216 semantics).
  const goDeeperMode: GoDeeperMode | null = reopened
    ? "reopen"
    : view === "retire-beat"
      ? "celebration"
      : null;

  // While any milestone is still pending (the "cards" view), the grid shows
  // *all four* in fixed order — completed ones persist as green "done" tiles
  // alongside the pending ones, so the user always sees their progress and the
  // grid stays full. The whole panel only leaves once every milestone is
  // complete, when `resolvePanelView` hands off to the go-deeper panel.

  return (
    <>
      {view === "cards" ? (
        <section
          aria-label="Getting started"
          className="surface flex flex-col gap-4 p-4 sm:p-5"
        >
          <div>
            <div className="eyebrow">Settling in</div>
            <p
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              A few first steps that help Hearth understand your home.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {milestones.map((milestone) => (
              <MilestoneCard
                key={milestone.id}
                milestone={milestone}
                onAction={() => runAction(milestone.action)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {goDeeperMode ? (
        <GoDeeperPanel
          mode={goDeeperMode}
          onAction={runGoDeeper}
          onDismiss={() => {
            if (goDeeperMode === "reopen") {
              onCloseReopen?.();
            } else {
              // Celebration dismiss: hide the beat now. The reveal effect has
              // already stamped the durable flag, so it stays gone across this
              // and every future session (issue #269).
              setDismissed(true);
            }
          }}
        />
      ) : null}

      {uploader ? (
        <SmartUploader
          open
          houseId={houseId}
          initialEmergencyEntry={
            uploader === "emergency" ? "category-picker" : undefined
          }
          onOpenChange={(open) => {
            if (!open) {
              setUploader(null);
              // Pull the freshly-derived milestone states so the just-added
              // milestone flips to its green "done" tile on the spot rather
              // than waiting for a manual reload. (Only reached for the
              // emergency flow now — the appliance flow redirects away in
              // onSaved before this fires.)
              router.refresh();
            }
          }}
          // The "add a first appliance" milestone is a discovery-mode mount,
          // so it's the same "land on what you made" seam as the top-nav
          // (issue #262): a successful appliance save routes to the new item's
          // detail page. Emergency-video saves never fire onSaved (no
          // inventory row), so they stay on the dashboard and refresh on close.
          onSaved={(result) => router.push(`/inventory/${result.inventoryId}`)}
        />
      ) : null}
    </>
  );
}

/**
 * The completed-state verb per milestone — the muted-green pill label shown on
 * a tile once its milestone is complete. Completed tiles persist in the grid
 * alongside the pending ones until every milestone is done (then the whole
 * panel retires), so the user always sees their progress. Kept here as
 * presentation, not in the pure content map, since it only matters to this
 * tile treatment.
 */
const COMPLETED_VERB: Record<Milestone["id"], string> = {
  home_photo: "Added",
  emergency_video: "Recorded",
  first_appliance: "Added",
  habitat_reviewed: "Reviewed",
};

/**
 * One milestone tile. A full-bleed image card modeled on the Emergency panel's
 * `PrimaryTile` (issue #218): category art under a bottom gradient scrim, a
 * prominent top-left glyph chip, white overlay text, and a solid amber CTA
 * pill. The whole tile is the click target (matching `PrimaryTile` /
 * `InventoryTile`); the pill is the visible affordance.
 *
 * When `imageSrc` is absent the art layer is skipped and the glyph sits over a
 * flat warm `--color-bg-surface-raised` field, so the layout ships before the
 * commissioned art does and a missing asset never shows a broken image.
 */
function MilestoneCard({
  milestone,
  onAction,
}: {
  milestone: Milestone;
  onAction: () => void;
}) {
  const complete = milestone.state === "complete";

  return (
    <li className="min-w-0">
      <button
        type="button"
        // A completed tile is a momentary confirmation, not an action — its
        // click is a no-op so it can't re-open the uploader / re-scroll.
        onClick={complete ? undefined : onAction}
        aria-disabled={complete || undefined}
        // `block w-full` so the button fills its grid cell — without it a
        // `<button>` is inline-block and the aspect-ratio + min-height combo
        // overflows the viewport on iOS Safari (same fix as `PrimaryTile`).
        // The image itself does not move on hover; only the chrome lifts.
        className="group relative block w-full overflow-hidden text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_0_0_1px_var(--color-accent)] focus-visible:-translate-y-px focus-visible:shadow-[0_0_0_2px_var(--color-accent)] focus-visible:outline-none"
        style={{
          aspectRatio: "3 / 4",
          minHeight: 300,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-surface-raised)",
        }}
      >
        {milestone.imageSrc ? (
          <Image
            src={milestone.imageSrc}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 25vw"
            style={{
              objectFit: "cover",
              filter: complete ? "grayscale(0.55) brightness(0.7)" : undefined,
            }}
          />
        ) : null}

        {/* Prominent glyph chip — semi-opaque over the art, top-left. */}
        <span
          aria-hidden
          className="absolute left-3 top-3 flex items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--radius-md)",
            color: "#fff",
            backgroundColor: complete
              ? "color-mix(in oklab, var(--color-success) 30%, #000)"
              : "color-mix(in oklab, #000 28%, transparent)",
          }}
        >
          <Icon name={milestone.icon} size={30} />
        </span>

        {/* Bottom scrim carrying the overlay text (slightly stronger than the
            emergency tile's, since we stack eyebrow + title + sub + CTA). */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0"
          style={{
            height: "62%",
            background:
              "linear-gradient(to top, color-mix(in oklab,#000 88%, transparent) 0%, color-mix(in oklab,#000 70%, transparent) 45%, transparent 100%)",
          }}
        />

        <div className="absolute inset-x-0 bottom-0 flex flex-col px-4 pb-4 pt-8">
          <div
            style={{
              color: "color-mix(in oklab, #fff 70%, transparent)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            {milestone.eyebrow}
          </div>
          <div
            style={{
              color: "#fff",
              fontSize: 17,
              fontWeight: 500,
              lineHeight: 1.3,
              marginTop: 4,
            }}
          >
            {milestone.lead}
          </div>
          <div
            style={{
              color: "color-mix(in oklab, #fff 72%, transparent)",
              fontSize: 13,
              lineHeight: 1.45,
              marginTop: 6,
            }}
          >
            {milestone.secondary}
          </div>
          {complete ? (
            <span
              className="mt-3 inline-flex items-center gap-1.5 self-start"
              style={{
                color: "var(--color-success)",
                backgroundColor:
                  "color-mix(in oklab, var(--color-success) 16%, transparent)",
                borderRadius: 999,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Icon name="circle-check" size={14} />
              {COMPLETED_VERB[milestone.id]}
            </span>
          ) : (
            <span
              className="mt-3 inline-flex items-center gap-1.5 self-start"
              style={{
                color: "var(--color-bg-base)",
                backgroundColor: "var(--color-accent)",
                borderRadius: 999,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {milestone.cta}
              <Icon name="arrow-right" size={14} />
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

/**
 * The go-deeper panel (issue #220) — the upgraded retire beat. A lit, bordered
 * card with a warm top-right glow, a state-aware header (celebration vs.
 * reopen), a recessed hairline divider, and three "ways to go deeper" cards.
 * Both modes share the divider + cards; only the header copy differs.
 */
function GoDeeperPanel({
  mode,
  onAction,
  onDismiss,
}: {
  mode: GoDeeperMode;
  onAction: (action: GoDeeperAction) => void;
  onDismiss: () => void;
}) {
  const header = GO_DEEPER_HEADER[mode];
  return (
    <section
      aria-label={
        mode === "celebration" ? "Foundation complete" : "Ways to go deeper"
      }
      className="relative p-5 sm:p-6"
      style={{
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in oklab, var(--color-accent) 28%, var(--color-border-subtle))",
        // Subtle warm radial glow from the top-right corner over the base
        // surface — the "lit, not flat" signal that makes the moment land.
        background:
          "radial-gradient(140% 120% at 85% -10%, color-mix(in oklab, var(--color-accent) 16%, transparent) 0%, transparent 55%), var(--color-bg-surface)",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="btn btn-ghost btn-icon absolute right-3 top-3"
      >
        <Icon name="x" size={16} />
      </button>

      {/* Header block — the only part that differs by mode. */}
      <div className="flex items-center gap-3" style={{ paddingRight: 40 }}>
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 42,
            height: 42,
            borderRadius: "var(--radius-md)",
            color: "var(--color-accent)",
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 18%, transparent)",
          }}
        >
          <Icon name="flame" size={22} />
        </span>
        <div
          style={{
            color: "var(--color-accent)",
            textTransform: "uppercase",
            fontSize: 11,
            letterSpacing: "0.09em",
            fontWeight: 500,
          }}
        >
          {header.eyebrow}
        </div>
      </div>
      {/* Styled as a headline but rendered as a div, not a heading: this panel
          sits above the hero's <h1>, so an <h2> here would invert the heading
          order. Matches the milestone tiles, which also avoid headings. */}
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 25,
          fontWeight: 500,
          lineHeight: 1.15,
          color: "var(--color-text-primary)",
          marginTop: 14,
        }}
      >
        {header.headline}
      </div>
      <p
        className="text-small"
        style={{
          color: "var(--color-text-secondary)",
          fontSize: 14.5,
          lineHeight: 1.5,
          marginTop: 8,
          maxWidth: "62ch",
        }}
      >
        {header.sub}
      </p>

      {/* Recessed hairline divider — a clean 1px rule, not a heavy one. */}
      <div
        aria-hidden
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          marginTop: 20,
          marginBottom: 18,
        }}
      />

      <div
        style={{
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          fontSize: 11,
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        {GO_DEEPER_NEXT_EYEBROW}
      </div>

      {/* Three cards across; collapse to one column under ~820px. */}
      <div className="grid grid-cols-1 gap-3 min-[820px]:grid-cols-3">
        {GO_DEEPER_CARDS.map((card) => (
          <GoDeeperCardItem
            key={card.id}
            card={card}
            onClick={() => onAction(card.action)}
          />
        ))}
      </div>
    </section>
  );
}

/** One "go deeper" suggestion card. The whole card is the click target. */
function GoDeeperCardItem({
  card,
  onClick,
}: {
  card: (typeof GO_DEEPER_CARDS)[number];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_0_0_1px_var(--color-accent)] focus-visible:-translate-y-px focus-visible:shadow-[0_0_0_2px_var(--color-accent)] focus-visible:outline-none"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: 14,
      }}
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center"
        style={{
          width: 30,
          height: 30,
          borderRadius: "var(--radius-md)",
          color: "var(--color-accent)",
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 16%, transparent)",
        }}
      >
        <Icon name={card.icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.3,
              color: "var(--color-text-primary)",
            }}
          >
            {card.title}
          </span>
          <span
            aria-hidden
            className="shrink-0"
            style={{ color: "var(--color-text-tertiary)", marginTop: 2 }}
          >
            <Icon name="arrow-right" size={13} />
          </span>
        </div>
        <div
          style={{
            color: "var(--color-text-secondary)",
            fontSize: 12.5,
            lineHeight: 1.45,
            marginTop: 4,
          }}
        >
          {card.description}
        </div>
      </div>
    </button>
  );
}
