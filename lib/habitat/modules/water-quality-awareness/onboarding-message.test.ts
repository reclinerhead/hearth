import { describe, expect, it } from "vitest";
import {
  buildCwsOnboardingMessage,
  type CwsOnboardingMessageInput,
} from "./onboarding-message";
import type { LcrAxisClassification } from "./lcr";

/**
 * Every row in issue #186's target-copy table has a test below. The
 * structure asserts the exact sentence we want users to read so future
 * edits surface as test-failures rather than silent voice drift.
 */

const NAME = "Kalamazoo Public Water Supply";

function lcr(
  partial: Partial<{ lead: "above" | "approaching" | "below" | "absent"; copper: "above" | "approaching" | "below" | "absent" }> = {},
): LcrAxisClassification {
  return {
    kind: "available",
    lead: partial.lead ?? "absent",
    copper: partial.copper ?? "absent",
  };
}

function withInput(
  overrides: Partial<CwsOnboardingMessageInput> = {},
): CwsOnboardingMessageInput {
  return {
    severity: "neutral",
    pwsName: NAME,
    complianceStatus: "no_active_violations",
    hasActiveNonHealthBased: false,
    lcrAxis: { kind: "unknown" },
    ...overrides,
  };
}

describe("buildCwsOnboardingMessage", () => {
  describe("favorable — clean compliance + LCR below action level", () => {
    it("mentions lead and copper when both metals were sampled below action", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            lcrAxis: lcr({ lead: "below", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations and recent lead and copper samples are below the action level.`,
      );
    });

    it("mentions only lead when copper has no samples on file", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            lcrAxis: lcr({ lead: "below", copper: "absent" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations and recent lead samples are below the action level.`,
      );
    });

    it("mentions only copper when lead has no samples on file", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            lcrAxis: lcr({ lead: "absent", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations and recent copper samples are below the action level.`,
      );
    });
  });

  describe("caution — clean compliance + LCR approaching action level", () => {
    it("names lead when only lead is approaching", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "approaching", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent lead samples are approaching the action level. We'll flag this for follow-up.`,
      );
    });

    it("names copper when only copper is approaching", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "below", copper: "approaching" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent copper samples are approaching the action level. We'll flag this for follow-up.`,
      );
    });

    it("says 'lead and copper' when both are approaching", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "approaching", copper: "approaching" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent lead and copper samples are approaching the action level. We'll flag this for follow-up.`,
      );
    });
  });

  describe("caution — non-health-based violation", () => {
    // `compliance_status_short` is health-based-only by design — it stays
    // 'no_active_violations' even when has_active_non_health_based is
    // true. The builder reads the separate flag for this branch.
    it("uses monitoring-flavoured copy with no LCR clause when LCR is clean", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            complianceStatus: "no_active_violations",
            hasActiveNonHealthBased: true,
            lcrAxis: lcr({ lead: "below", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows a non-health monitoring issue on file. We'll flag this for follow-up.`,
      );
    });

    it("uses monitoring-flavoured copy with no LCR clause when LCR is unavailable", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            complianceStatus: "no_active_violations",
            hasActiveNonHealthBased: true,
            lcrAxis: { kind: "unknown" },
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows a non-health monitoring issue on file. We'll flag this for follow-up.`,
      );
    });

    it("appends the LCR-approaching clause when both non-health and LCR axes flag caution", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            complianceStatus: "no_active_violations",
            hasActiveNonHealthBased: true,
            lcrAxis: lcr({ lead: "approaching", copper: "absent" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows a non-health monitoring issue on file and recent lead samples are approaching the action level. We'll flag this for follow-up.`,
      );
    });

    it("falls back to neutral copy on legacy rows where hasActiveNonHealthBased is undefined (pre-#186 payloads)", () => {
      // Old payloads don't carry the flag. We can't fabricate a
      // monitoring issue we can't confirm, so the row degrades to the
      // neutral fallback until the WQA cadence rewrites it.
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            complianceStatus: "no_active_violations",
            hasActiveNonHealthBased: undefined,
            lcrAxis: { kind: "unknown" },
          }),
        ),
      ).toBe(`Found your water utility — ${NAME}.`);
    });
  });

  describe("concern — health-based compliance violation", () => {
    it("uses the active-health-based-issue phrasing regardless of LCR state", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "concern",
            complianceStatus: "active_violations",
            lcrAxis: lcr({ lead: "below", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows an active health-based compliance issue worth a closer look.`,
      );
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "concern",
            complianceStatus: "active_violations",
            lcrAxis: lcr({ lead: "above", copper: "absent" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows an active health-based compliance issue worth a closer look.`,
      );
    });
  });

  describe("concern — clean compliance + LCR at or above action level", () => {
    it("names lead when only lead is above", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "concern",
            lcrAxis: lcr({ lead: "above", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent lead samples are at or above the action level. Worth a closer look.`,
      );
    });

    it("names copper when only copper is above", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "concern",
            lcrAxis: lcr({ lead: "below", copper: "above" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent copper samples are at or above the action level. Worth a closer look.`,
      );
    });

    it("says 'lead and copper' when both are above", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "concern",
            lcrAxis: lcr({ lead: "above", copper: "above" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — EPA shows no active violations, but recent lead and copper samples are at or above the action level. Worth a closer look.`,
      );
    });
  });

  describe("neutral — degraded / no LCR data on file", () => {
    it("drops the LCR clause entirely and stops at the utility name", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "neutral",
            lcrAxis: { kind: "unknown" },
          }),
        ),
      ).toBe(`Found your water utility — ${NAME}.`);
    });

    it("drops the LCR clause when compliance is also unknown (full degraded mode)", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "neutral",
            complianceStatus: "unknown",
            lcrAxis: { kind: "unknown" },
          }),
        ),
      ).toBe(`Found your water utility — ${NAME}.`);
    });
  });

  describe("name-less fallback", () => {
    it("pivots to 'Found your water utility on file with EPA' when pwsName is missing", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            pwsName: undefined,
            lcrAxis: lcr({ lead: "below", copper: "below" }),
          }),
        ),
      ).toBe(
        "Found your water utility on file with EPA — EPA shows no active violations and recent lead and copper samples are below the action level.",
      );
    });

    it("uses the same fallback on the neutral path with a period instead of an em-dash", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "neutral",
            pwsName: undefined,
            lcrAxis: { kind: "unknown" },
          }),
        ),
      ).toBe("Found your water utility on file with EPA.");
    });

    it("handles an empty string pwsName the same as undefined", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            pwsName: "",
            lcrAxis: lcr({ lead: "below" }),
          }),
        ),
      ).toBe(
        "Found your water utility on file with EPA — EPA shows no active violations and recent lead samples are below the action level.",
      );
    });
  });

  describe("regression — the issue's motivating case", () => {
    it("Kalamazoo (clean compliance + lead approaching) reads as caution, not the old contradictory copy", () => {
      const line = buildCwsOnboardingMessage(
        withInput({
          severity: "caution",
          complianceStatus: "no_active_violations",
          lcrAxis: lcr({ lead: "approaching", copper: "absent" }),
        }),
      );
      expect(line).toContain("no active violations");
      expect(line).toContain("approaching the action level");
      expect(line).toContain("We'll flag this for follow-up");
      // The pre-#186 wording must NOT appear.
      expect(line).not.toContain("no active compliance issues");
    });
  });
});
