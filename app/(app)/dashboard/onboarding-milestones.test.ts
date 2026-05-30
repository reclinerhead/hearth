import { describe, expect, it } from "vitest";
import {
  buildMilestones,
  isAllComplete,
  pendingMilestones,
  resolvePanelView,
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
  it("renders cards while any milestone is pending (retire flag irrelevant)", () => {
    const milestones = buildMilestones(NONE);
    expect(resolvePanelView(milestones, false)).toBe("cards");
    expect(resolvePanelView(milestones, true)).toBe("cards");
  });

  it("renders cards in a partial state too", () => {
    const milestones = buildMilestones({ ...NONE, hasHomePhoto: true });
    expect(resolvePanelView(milestones, false)).toBe("cards");
  });

  it("shows the retire beat on the final-flip load (all complete, beat unseen)", () => {
    const milestones = buildMilestones(ALL);
    expect(resolvePanelView(milestones, false)).toBe("retire-beat");
  });

  it("hides entirely once all complete and the retire beat has been seen", () => {
    const milestones = buildMilestones(ALL);
    expect(resolvePanelView(milestones, true)).toBe("hidden");
  });
});
