"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SmartUploader } from "@/components/smart-uploader/SmartUploader";
import {
  isAllComplete,
  pendingMilestones,
  resolvePanelView,
  RETIRE_BEAT_LINE,
  type Milestone,
  type MilestoneAction,
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
          <ul className="grid gap-3 sm:grid-cols-2">
            {pending.map((milestone) => (
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
 * One milestone card. Mirrors the discovery modal's bordered card-row idiom
 * (source eyebrow, outline glyph, lead + secondary) with a trailing CTA.
 */
function MilestoneCard({
  milestone,
  onAction,
}: {
  milestone: Milestone;
  onAction: () => void;
}) {
  return (
    <li
      className="flex flex-col gap-3"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "12px 14px 14px",
      }}
    >
      <div className="eyebrow">{milestone.eyebrow}</div>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center"
          style={{
            color: "var(--color-accent)",
            borderRadius: "var(--radius-md)",
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 12%, transparent)",
          }}
        >
          <Icon name={milestone.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.4,
              color: "var(--color-text-primary)",
            }}
          >
            {milestone.lead}
          </div>
          <div
            className="text-small"
            style={{
              color: "var(--color-text-secondary)",
              marginTop: 2,
              lineHeight: 1.45,
            }}
          >
            {milestone.secondary}
          </div>
        </div>
      </div>
      <div className="mt-auto">
        <button
          type="button"
          onClick={onAction}
          className="btn btn-ghost"
        >
          {milestone.cta}
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
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
