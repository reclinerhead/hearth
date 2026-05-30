import type { IconName } from "@/components/icon";

/**
 * Pure milestone-derivation helpers for the dashboard onboarding-milestones
 * panel (issue #216).
 *
 * Extracted from the panel so the (state → row) mapping can be unit-tested
 * without React, mirroring the `onboarding-discovery-rows.ts` pattern.
 *
 * **Detect, don't track.** Each milestone's done-state is derived from data
 * that already exists rather than a separate completion table — so a user
 * who added an appliance before this panel shipped still gets credit, and a
 * milestone can never drift out of sync with reality. The page assembles
 * the four `MilestoneSignals` booleans server-side (three are count /
 * existence reads against tables that already exist; the fourth is the
 * `habitat_reviewed` key off the house's `onboarding_state` jsonb) and
 * hands them here.
 *
 * **Awareness framing, not a to-do list.** Each card's lead line leads with
 * what the user will *understand about their home*, not a chore they owe.
 * There is no per-card dismiss — cards leave only by completion, and the
 * whole panel retires once every milestone is complete.
 */

export type MilestoneId =
  | "home_photo"
  | "emergency_video"
  | "first_appliance"
  | "habitat_reviewed";

export type MilestoneState = "pending" | "complete";

/**
 * What the milestone CTA does when tapped. The panel switches on this to
 * wire each card to its action surface; kept as data (not a callback) so
 * the milestone list stays serialisable from the server component and the
 * mapping stays unit-testable.
 *
 *   - `open-uploader-appliance` — Smart Uploader on the path-picker.
 *   - `open-uploader-emergency` — Smart Uploader pre-routed to the
 *     emergency category-picker.
 *   - `scroll-to-hero` — the hero image surface owns the photo picker.
 *   - `scroll-to-habitat` — the habitat panel; opening any finding modal
 *     there is what stamps `habitat_reviewed`.
 */
export type MilestoneAction =
  | "open-uploader-appliance"
  | "open-uploader-emergency"
  | "scroll-to-hero"
  | "scroll-to-habitat";

export type Milestone = {
  id: MilestoneId;
  state: MilestoneState;
  /** All-caps area eyebrow rendered above the card ("YOUR HOME"). */
  eyebrow: string;
  /** Visceral, scene-based glyph (a fridge for inventory, not a checkmark). */
  icon: IconName;
  /**
   * Full-bleed category art for the image tile, in the painterly amber/sepia
   * style of the emergency tiles. Optional: when absent the tile falls back to
   * a flat warm field with the glyph chip, so the layout ships before the art
   * does and a missing asset never shows a broken image.
   */
  imageSrc?: string;
  /** Awareness-framed lead line — what the user will learn / gain. */
  lead: string;
  /** Optional supporting line in secondary text. */
  secondary: string;
  /** CTA label. */
  cta: string;
  /** What the CTA does. */
  action: MilestoneAction;
};

/**
 * The four completion booleans, computed server-side. Three are derived
 * from existing tables (self-healing); `habitatReviewed` is the only one
 * that reads persisted view-event state.
 */
export type MilestoneSignals = {
  /** `houses.user_image_url is not null`. */
  hasHomePhoto: boolean;
  /** ≥1 `documents` row, kind='emergency_procedure_video', this house. */
  hasEmergencyVideo: boolean;
  /** ≥1 `inventory` row, this house. */
  hasAppliance: boolean;
  /** `houses.onboarding_state->>'habitat_reviewed' = 'true'`. */
  habitatReviewed: boolean;
};

/**
 * Static presentational content per milestone, in the fixed display order
 * (home → emergency → inventory → habitat). The completion signal is the
 * only thing that varies per house; everything else is copy.
 */
const MILESTONE_CONTENT: Array<Omit<Milestone, "state">> = [
  {
    id: "home_photo",
    eyebrow: "YOUR HOME",
    icon: "camera",
    imageSrc: "/onboarding/house.jpg",
    lead: "See your own home every time you land here.",
    secondary:
      "Add a photo and your dashboard greets you with your house, not a placeholder.",
    cta: "Add a photo",
    action: "scroll-to-hero",
  },
  {
    id: "emergency_video",
    eyebrow: "EMERGENCIES",
    icon: "video",
    imageSrc: "/onboarding/emergency.jpg",
    lead: "Know how to shut off your water in a hurry.",
    secondary:
      "Record where your shutoffs and panels are now, while everything is calm.",
    cta: "Record a video",
    action: "open-uploader-emergency",
  },
  {
    id: "first_appliance",
    eyebrow: "INVENTORY",
    icon: "fridge",
    imageSrc: "/onboarding/inventory.jpg",
    lead: "Start the record of what keeps your home running.",
    secondary:
      "Snap an appliance label — Hearth reads the make, model, and age for you.",
    cta: "Add an appliance",
    action: "open-uploader-appliance",
  },
  {
    id: "habitat_reviewed",
    eyebrow: "HABITAT",
    icon: "leaf",
    imageSrc: "/onboarding/habitat.jpg",
    lead: "See what the world around your home holds.",
    secondary:
      "Radon, flood risk, and more — already gathered for your address.",
    cta: "Review findings",
    action: "scroll-to-habitat",
  },
];

const SIGNAL_BY_ID: Record<MilestoneId, (s: MilestoneSignals) => boolean> = {
  home_photo: (s) => s.hasHomePhoto,
  emergency_video: (s) => s.hasEmergencyVideo,
  first_appliance: (s) => s.hasAppliance,
  habitat_reviewed: (s) => s.habitatReviewed,
};

/**
 * Build the full milestone list with each card's `state` resolved from its
 * signal. Always returns all four in fixed order — the panel filters to the
 * pending subset for rendering and uses the full list to decide whether to
 * retire. Completion is one-way at the data level: once a signal is true the
 * card is simply not pending (we never re-surface a completed milestone, even
 * if the underlying data later changes — the learning moment already
 * happened).
 */
export function buildMilestones(signals: MilestoneSignals): Milestone[] {
  return MILESTONE_CONTENT.map((content) => ({
    ...content,
    state: SIGNAL_BY_ID[content.id](signals) ? "complete" : "pending",
  }));
}

/** The cards that still render — pending only, in fixed order. */
export function pendingMilestones(milestones: Milestone[]): Milestone[] {
  return milestones.filter((m) => m.state === "pending");
}

/** True once every milestone is complete (the panel retires). */
export function isAllComplete(milestones: Milestone[]): boolean {
  return milestones.every((m) => m.state === "complete");
}

/**
 * What the panel should render this load.
 *
 *   - `cards`       — at least one pending milestone; render the pending cards.
 *   - `retire-beat` — all complete AND the momentary "foundation set" reward
 *                     line hasn't been shown yet (the final-flip load).
 *   - `hidden`      — all complete and the reward beat has already been shown;
 *                     render nothing, no layout hole.
 *
 * `retireBeatShown` is a per-session client flag (sessionStorage), not
 * persisted server state — re-showing the beat in a brand-new session is an
 * accepted non-goal (it's a momentary reward, and guaranteeing exactly-once
 * display is more machinery than the moment warrants — issue #216 open Q4).
 */
export type MilestonePanelView = "cards" | "retire-beat" | "hidden";

export function resolvePanelView(
  milestones: Milestone[],
  retireBeatShown: boolean,
): MilestonePanelView {
  if (!isAllComplete(milestones)) return "cards";
  return retireBeatShown ? "hidden" : "retire-beat";
}

/**
 * The single quiet reward line shown on the final-flip load before the panel
 * retires. Gratitude / noticing, reinforcing homeowner identity — no tier, no
 * score, no confetti (issue #216 rewards principle).
 */
export const RETIRE_BEAT_LINE =
  "That's the foundation set. Hearth knows your home now.";
