"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Icon } from "@/components/icon";
import { SmartUploader } from "@/components/smart-uploader/SmartUploader";
import {
  isAllComplete,
  pendingMilestones,
  resolvePanelView,
  RETIRE_BEAT_LINE,
  type Milestone,
  type MilestoneAction,
  type MilestoneId,
} from "./onboarding-milestones";

/**
 * Dashboard onboarding-milestones panel (issue #216).
 *
 * A small set of awareness-framed cards that appear after setup, nudging the
 * user toward the handful of high-value first actions (record an emergency
 * video, add a first appliance, add a home photo, review habitat findings).
 * Each card disappears as its milestone completes — derived server-side from
 * real data, never a tracked checklist — and the whole panel retires once
 * every milestone is done, leaving the dashboard in its normal shape with no
 * layout hole.
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
 */

function scrollToAnchor(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function OnboardingMilestonesPanel({
  houseId,
  milestones,
}: {
  houseId: string;
  milestones: Milestone[];
}) {
  const router = useRouter();

  // Which Smart Uploader flow (if any) is open. Hosting one instance and
  // switching its entry mode keeps a single modal mount.
  const [uploader, setUploader] = useState<null | "appliance" | "emergency">(
    null,
  );

  // The "foundation set" reward beat is a momentary, per-session thing. We
  // start assuming it's already been seen (so SSR + the first client render
  // agree — no hydration flash and no beat for a returning user), then the
  // effect below reveals it exactly once per tab on the final-flip load.
  const allComplete = isAllComplete(milestones);
  const [retireBeatShown, setRetireBeatShown] = useState(true);

  useEffect(() => {
    if (!allComplete) return;
    const key = `hearthMilestonesRetireBeat:${houseId}`;
    try {
      if (sessionStorage.getItem(key) === "1") return; // already shown this tab
      sessionStorage.setItem(key, "1");
      setRetireBeatShown(false); // reveal the beat for this load only
    } catch {
      // sessionStorage can throw in incognito with quota disabled; skipping
      // the beat is the safe degradation.
    }
  }, [allComplete, houseId]);

  // A milestone that just flipped to complete gets one "you did it" beat: it
  // renders with the completed treatment for this load, then drops on the next
  // one. The panel otherwise shows only the *pending* subset, so without this
  // a completion would simply vanish (the bug behind issue #218's completed
  // criterion).
  //
  // To tell a *just*-flipped milestone from one that was already complete when
  // the tab opened (e.g. a photo added last week — which must NOT get a false
  // beat), we persist the set of milestones that were pending as of the last
  // render/load, per house per tab. A complete milestone that was in that set
  // is one that flipped since; anything complete on a cold tab has no baseline
  // and so is never celebrated. The reveal is client-only (start empty so SSR
  // and the first client render agree on pending-only), mirroring the retire
  // beat. This also covers the no-live-refresh paths (photo / habitat), whose
  // completion only surfaces on the next page load.
  const [justFlipped, setJustFlipped] = useState<MilestoneId[]>([]);

  useEffect(() => {
    if (allComplete) return; // the all-complete grid is the retire beat's job
    const key = `hearthMilestonesLastPending:${houseId}`;
    const currentPending = milestones
      .filter((m) => m.state === "pending")
      .map((m) => m.id);
    const completeNow = milestones
      .filter((m) => m.state === "complete")
      .map((m) => m.id);
    try {
      const raw = sessionStorage.getItem(key);
      const prevPending: MilestoneId[] | null = raw ? JSON.parse(raw) : null;
      if (prevPending) {
        const flipped = completeNow.filter((id) => prevPending.includes(id));
        if (flipped.length > 0) setJustFlipped(flipped);
      }
      // Re-baseline so this load's beat drops on the next one.
      sessionStorage.setItem(key, JSON.stringify(currentPending));
    } catch {
      // sessionStorage parse/quota failure — skipping the beat is safe.
    }
  }, [allComplete, milestones, houseId]);

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

  const view = resolvePanelView(milestones, retireBeatShown);
  const pending = pendingMilestones(milestones);

  // What the grid renders this load: the pending milestones, plus any that
  // just flipped to complete (their one-load "you did it" beat). `milestones`
  // is already in fixed display order, so filtering it preserves that order.
  const visibleIds = new Set<MilestoneId>([
    ...pending.map((m) => m.id),
    ...justFlipped,
  ]);
  const visible = milestones.filter((m) => visibleIds.has(m.id));

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
            {visible.map((milestone) => (
              <MilestoneCard
                key={milestone.id}
                milestone={milestone}
                onAction={() => runAction(milestone.action)}
              />
            ))}
          </ul>
        </section>
      ) : view === "retire-beat" ? (
        <RetireBeat />
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
              // Pull the freshly-derived milestone states so the completed
              // card drops on the spot rather than waiting for a manual
              // reload.
              router.refresh();
            }
          }}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}

/**
 * The completed-state verb per milestone — the muted-green pill label shown
 * for the single card that just flipped on its final-flip load (the panel
 * only ever renders pending cards, so a complete card is a momentary "you did
 * it" beat before it leaves on the next load). Kept here as presentation, not
 * in the pure content map, since it only matters to this tile treatment.
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
 * The quiet, momentary reward line shown on the final-flip load — gratitude /
 * noticing, no badges or scores. Gone on the next load (see panel header).
 */
function RetireBeat() {
  return (
    <div
      className="surface-ai flex items-center gap-3 p-4 sm:p-5"
      role="status"
    >
      <span aria-hidden style={{ color: "var(--color-accent)" }}>
        <Icon name="sparkles" size={18} />
      </span>
      <p style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
        {RETIRE_BEAT_LINE}
      </p>
    </div>
  );
}
