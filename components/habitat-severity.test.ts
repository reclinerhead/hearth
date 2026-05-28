import { describe, expect, it } from "vitest";
import type { HabitatSeverity } from "@/lib/habitat/types";
import {
  discoveryRowGlyph,
  isFlaggedSeverity,
  pillLabelForSeverity,
  pillTooltipForSeverity,
} from "./habitat-severity";

const ALL_SEVERITIES: HabitatSeverity[] = [
  "critical",
  "concern",
  "caution",
  "neutral",
  "favorable",
  "beneficial",
];

const FLAGGED: HabitatSeverity[] = ["critical", "concern", "caution"];
const NON_FLAGGED: HabitatSeverity[] = ["neutral", "favorable", "beneficial"];

describe("isFlaggedSeverity", () => {
  it("flags critical, concern, and caution", () => {
    for (const s of FLAGGED) {
      expect(isFlaggedSeverity(s), s).toBe(true);
    }
  });

  it("does not flag neutral, favorable, or beneficial", () => {
    for (const s of NON_FLAGGED) {
      expect(isFlaggedSeverity(s), s).toBe(false);
    }
  });

  it("does not flag null or undefined", () => {
    expect(isFlaggedSeverity(null)).toBe(false);
    expect(isFlaggedSeverity(undefined)).toBe(false);
  });
});

describe("discoveryRowGlyph", () => {
  it("returns alert-triangle for every flagged severity", () => {
    for (const s of FLAGGED) {
      expect(discoveryRowGlyph(s), s).toBe("alert-triangle");
    }
  });

  it("returns circle-check for non-flagged severities and absent severity", () => {
    for (const s of NON_FLAGGED) {
      expect(discoveryRowGlyph(s), s).toBe("circle-check");
    }
    expect(discoveryRowGlyph(null)).toBe("circle-check");
    expect(discoveryRowGlyph(undefined)).toBe("circle-check");
  });
});

describe("pillLabelForSeverity", () => {
  it("escalates label for concern and critical", () => {
    expect(pillLabelForSeverity("concern")).toBe("Worth a closer look");
    expect(pillLabelForSeverity("critical")).toBe("Worth a closer look");
  });

  it("uses lighter label for caution", () => {
    expect(pillLabelForSeverity("caution")).toBe("Worth knowing");
  });

  it("returns null for non-flagged severities and absent severity", () => {
    for (const s of NON_FLAGGED) {
      expect(pillLabelForSeverity(s), s).toBeNull();
    }
    expect(pillLabelForSeverity(null)).toBeNull();
    expect(pillLabelForSeverity(undefined)).toBeNull();
  });
});

describe("pillTooltipForSeverity", () => {
  it("returns the heavier tooltip for concern and critical", () => {
    const heavy =
      "We'll surface this on your dashboard with our findings and suggested follow-ups.";
    expect(pillTooltipForSeverity("concern")).toBe(heavy);
    expect(pillTooltipForSeverity("critical")).toBe(heavy);
  });

  it("returns the lighter tooltip for caution", () => {
    expect(pillTooltipForSeverity("caution")).toBe(
      "Worth being aware of. You'll find this on your dashboard with the full details.",
    );
  });

  it("returns null for non-flagged severities and absent severity", () => {
    for (const s of NON_FLAGGED) {
      expect(pillTooltipForSeverity(s), s).toBeNull();
    }
    expect(pillTooltipForSeverity(null)).toBeNull();
    expect(pillTooltipForSeverity(undefined)).toBeNull();
  });
});

describe("label / tooltip coverage parity", () => {
  it("renders a pill iff a tooltip exists for every severity", () => {
    for (const s of ALL_SEVERITIES) {
      const hasLabel = pillLabelForSeverity(s) !== null;
      const hasTooltip = pillTooltipForSeverity(s) !== null;
      expect(hasLabel, s).toBe(hasTooltip);
      expect(hasLabel, s).toBe(isFlaggedSeverity(s));
    }
  });
});
