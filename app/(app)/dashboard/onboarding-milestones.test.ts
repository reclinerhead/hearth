import { describe, expect, it } from "vitest";
import {
  buildMilestones,
  GO_DEEPER_CARDS,
  isAllComplete,
  pendingMilestones,
  resolvePanelView,
  type GoDeeperAction,
  type MilestoneId,
  type MilestoneSignals,
} from "./onboarding-milestones";

/**
 * Signal presets. `none` = brand-new house (everything pending); `all` =
 * every signal satisfied (panel retires). Partial cases tweak one field.
 */
const NONE: MilestoneSignals = {
  hasHomePhoto: false,
  hasEmergencyVideo: false,
  hasAppliance: false,
  habitatReviewed: false,
};

const ALL: MilestoneSignals = {
  hasHomePhoto: true,
  hasEmergencyVideo: true,
  hasAppliance: true,
  habitatReviewed: true,
};

const EXPECTED_ORDER: MilestoneId[] = [
  "home_photo",
  "emergency_video",
  "first_appliance",
  "habitat_reviewed",
];

describe("buildMilestones", () => {
  it("returns all four milestones in fixed order regardless of signals", () => {
    for (const signals of [NONE, ALL]) {
      const milestones = buildMilestones(signals);
      expect(milestones.map((m) => m.id)).toEqual(EXPECTED_ORDER);
    }
  });

  it("marks every milestone pending for a brand-new house (all-pending)", () => {
    const milestones = buildMilestones(NONE);
    expect(milestones.every((m) => m.state === "pending")).toBe(true);
    expect(pendingMilestones(milestones)).toHaveLength(4);
    expect(isAllComplete(milestones)).toBe(false);
  });

  it("marks every milestone complete when all signals are satisfied (all-complete)", () => {
    const milestones = buildMilestones(ALL);
    expect(milestones.every((m) => m.state === "complete")).toBe(true);
    expect(pendingMilestones(milestones)).toHaveLength(0);
    expect(isAllComplete(milestones)).toBe(true);
  });

  it("resolves each card's state from its own signal (partial)", () => {
    // Photo + appliance done; emergency video + habitat still pending.
    const milestones = buildMilestones({
      hasHomePhoto: true,
      hasEmergencyVideo: false,
      hasAppliance: true,
      habitatReviewed: false,
    });
    const stateById = Object.fromEntries(
      milestones.map((m) => [m.id, m.state]),
    );
    expect(stateById).toEqual({
      home_photo: "complete",
      emergency_video: "pending",
      first_appliance: "complete",
      habitat_reviewed: "pending",
    });
    expect(pendingMilestones(milestones).map((m) => m.id)).toEqual([
      "emergency_video",
      "habitat_reviewed",
    ]);
    expect(isAllComplete(milestones)).toBe(false);
  });

  it("derives the habitat milestone from habitatReviewed alone", () => {
    const reviewedOnly = buildMilestones({ ...NONE, habitatReviewed: true });
    const habitat = reviewedOnly.find((m) => m.id === "habitat_reviewed");
    expect(habitat?.state).toBe("complete");
    // The other three stay pending — habitatReviewed doesn't leak across.
    expect(pendingMilestones(reviewedOnly).map((m) => m.id)).toEqual([
      "home_photo",
      "emergency_video",
      "first_appliance",
    ]);
  });

  it("gives every milestone an eyebrow, lead, secondary, cta and icon", () => {
    for (const m of buildMilestones(NONE)) {
      expect(m.eyebrow, m.id).toBeTruthy();
      expect(m.lead, m.id).toBeTruthy();
      expect(m.secondary, m.id).toBeTruthy();
      expect(m.cta, m.id).toBeTruthy();
      expect(m.icon, m.id).toBeTruthy();
    }
  });
});

describe("resolvePanelView", () => {
  // The second arg is the durable `celebrationSeen` flag (issue #269), read
  // server-side from `houses.onboarding_state.foundation_celebration_seen`.
  it("renders cards while any milestone is pending (celebration flag irrelevant)", () => {
    const milestones = buildMilestones(NONE);
    expect(resolvePanelView(milestones, false)).toBe("cards");
    expect(resolvePanelView(milestones, true)).toBe("cards");
  });

  it("renders cards in a partial state too", () => {
    const milestones = buildMilestones({ ...NONE, hasHomePhoto: true });
    expect(resolvePanelView(milestones, false)).toBe("cards");
  });

  it("shows the celebration on the final-flip load (all complete, not yet seen)", () => {
    const milestones = buildMilestones(ALL);
    expect(resolvePanelView(milestones, false)).toBe("retire-beat");
  });

  it("hides entirely once all complete and the celebration has been seen", () => {
    const milestones = buildMilestones(ALL);
    // Durable: a returning user (new session) reads `seen === true` and gets
    // no auto-beat — the regression this issue fixes.
    expect(resolvePanelView(milestones, true)).toBe("hidden");
  });
});

describe("GO_DEEPER_CARDS", () => {
  // Static go-deeper suggestions (issue #220). These are presentation data,
  // decoupled from milestone logic — assert only the shape and that each card
  // routes to a known action.
  const VALID_ACTIONS = new Set<GoDeeperAction>([
    "open-uploader-appliance",
    "open-uploader-emergency",
    "open-home-details",
  ]);

  it("ships three cards, each with id/icon/title/description/action", () => {
    expect(GO_DEEPER_CARDS).toHaveLength(3);
    for (const card of GO_DEEPER_CARDS) {
      expect(card.id, card.id).toBeTruthy();
      expect(card.icon, card.id).toBeTruthy();
      expect(card.title, card.id).toBeTruthy();
      expect(card.description, card.id).toBeTruthy();
      expect(VALID_ACTIONS.has(card.action), card.action).toBe(true);
    }
  });

  it("uses a distinct id and action per card", () => {
    const ids = GO_DEEPER_CARDS.map((c) => c.id);
    const actions = GO_DEEPER_CARDS.map((c) => c.action);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
