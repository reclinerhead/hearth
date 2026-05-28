import { describe, expect, it } from "vitest";
import {
  buildCwsOnboardingMessage,
  type CwsOnboardingMessageInput,
} from "./onboarding-message";
import type { LcrAxisClassification, LcrMetalState } from "./lcr";

/**
 * Every row in issue #188's target-copy table has a test below. The
 * structure asserts the exact sentence we want users to read so future
 * edits surface as test-failures rather than silent voice drift.
 */

const NAME = "Kalamazoo Public Water Supply";

function lcr(
  partial: Partial<{ lead: LcrMetalState; copper: LcrMetalState }> = {},
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
    lcrAxis: { kind: "unknown" },
    ...overrides,
  };
}

describe("buildCwsOnboardingMessage", () => {
  describe("favorable — clean compliance + every LCR sample below the detection limit", () => {
    it("mentions lead and copper when both metals are below detection", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "favorable",
            lcrAxis: lcr({ lead: "below", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA and recent samples show no detectable lead and copper.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA and recent samples show no detectable lead.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA and recent samples show no detectable copper.`,
      );
    });
  });

  describe("caution — clean compliance + LCR approaching the action level", () => {
    it("names lead when only lead is approaching", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "approaching", copper: "below" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent lead samples are approaching the action level. We'll flag this for follow-up.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent copper samples are approaching the action level. We'll flag this for follow-up.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent lead and copper samples are approaching the action level. We'll flag this for follow-up.`,
      );
    });
  });

  describe("caution — clean compliance + any detected lead/copper below approaching (issue #188)", () => {
    it("names lead when only lead is detected at sub-approaching levels", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "detected", copper: "absent" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent samples have detected lead. Any presence is worth knowing about.`,
      );
    });

    it("names copper when only copper is detected at sub-approaching levels", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "below", copper: "detected" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent samples have detected copper. Any presence is worth knowing about.`,
      );
    });

    it("says 'lead and copper' when both are detected at sub-approaching levels", () => {
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "detected", copper: "detected" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent samples have detected lead and copper. Any presence is worth knowing about.`,
      );
    });

    it("prefers the 'approaching' wording over 'detected' when one metal is at the higher tier", () => {
      // Approaching is more specific than detected; the more-specific
      // copy wins when applicable.
      expect(
        buildCwsOnboardingMessage(
          withInput({
            severity: "caution",
            lcrAxis: lcr({ lead: "approaching", copper: "detected" }),
          }),
        ),
      ).toBe(
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent lead samples are approaching the action level. We'll flag this for follow-up.`,
      );
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent lead samples are at or above the action level. Worth a closer look.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent copper samples are at or above the action level. Worth a closer look.`,
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
        `Found your water utility — ${NAME} — they're in active compliance with EPA, but recent lead and copper samples are at or above the action level. Worth a closer look.`,
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
        "Found your water utility on file with EPA — they're in active compliance with EPA and recent samples show no detectable lead and copper.",
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
        "Found your water utility on file with EPA — they're in active compliance with EPA and recent samples show no detectable lead.",
      );
    });
  });

  describe("regression — the Kalamazoo motivating case (issue #188)", () => {
    it("reads as caution-via-detected with both clauses landing in one sentence", () => {
      // Kalamazoo: clean compliance, lead at 0.0053 mg/L (~35% of
      // action level — well below approaching). Pre-#188 this row
      // landed in either neutral (legacy onboarding-line) or in the
      // awkward "non-health monitoring issue" branch (#186 fix).
      // #188 routes it through the detected branch with the voice
      // Todd asked for: positive on compliance + lead-detected caveat.
      const line = buildCwsOnboardingMessage(
        withInput({
          severity: "caution",
          complianceStatus: "no_active_violations",
          lcrAxis: lcr({ lead: "detected", copper: "absent" }),
        }),
      );
      expect(line).toContain("in active compliance with EPA");
      expect(line).toContain("detected lead");
      expect(line).toContain("Any presence is worth knowing about");
      // Old wording must NOT appear.
      expect(line).not.toContain("no active compliance issues");
      expect(line).not.toContain("non-health monitoring issue");
      expect(line).not.toContain("approaching the action level");
    });
  });
});
