import { describe, expect, it } from "vitest";
import {
  applyTier,
  maxSeverity,
  nplStatusLabel,
  severityWeight,
  tierAndStatusToSeverity,
} from "./severity";

describe("applyTier", () => {
  it("returns Tier 1 for any NPL status when distance ≤ 0.5", () => {
    expect(applyTier(0.1, "F")).toBe(1);
    expect(applyTier(0.5, "P")).toBe(1);
    expect(applyTier(0.3, "A")).toBe(1);
    expect(applyTier(0.4, "D")).toBe(1);
  });

  it("returns Tier 2 for F and P when 0.5 < distance ≤ 2", () => {
    expect(applyTier(0.6, "F")).toBe(2);
    expect(applyTier(1.5, "P")).toBe(2);
    expect(applyTier(2.0, "F")).toBe(2);
  });

  it("returns null for A and D in the Tier 2 distance band", () => {
    expect(applyTier(1.0, "A")).toBeNull();
    expect(applyTier(1.5, "D")).toBeNull();
  });

  it("returns Tier 3 only for F when 2 < distance ≤ 5", () => {
    expect(applyTier(2.5, "F")).toBe(3);
    expect(applyTier(4.9, "F")).toBe(3);
    expect(applyTier(5.0, "F")).toBe(3);
    expect(applyTier(3.0, "P")).toBeNull();
    expect(applyTier(3.0, "A")).toBeNull();
    expect(applyTier(3.0, "D")).toBeNull();
  });

  it("returns null beyond 5 miles regardless of status", () => {
    expect(applyTier(5.01, "F")).toBeNull();
    expect(applyTier(10, "F")).toBeNull();
    expect(applyTier(100, "P")).toBeNull();
  });
});

describe("tierAndStatusToSeverity", () => {
  it("Tier 1 + F/P → concern", () => {
    expect(tierAndStatusToSeverity(1, "F")).toBe("concern");
    expect(tierAndStatusToSeverity(1, "P")).toBe("concern");
  });

  it("Tier 1 + A/D → caution", () => {
    expect(tierAndStatusToSeverity(1, "A")).toBe("caution");
    expect(tierAndStatusToSeverity(1, "D")).toBe("caution");
  });

  it("Tier 2 + F/P → caution", () => {
    expect(tierAndStatusToSeverity(2, "F")).toBe("caution");
    expect(tierAndStatusToSeverity(2, "P")).toBe("caution");
  });

  it("Tier 3 + F → neutral", () => {
    expect(tierAndStatusToSeverity(3, "F")).toBe("neutral");
  });
});

describe("maxSeverity", () => {
  it("returns the worst severity in a list", () => {
    expect(maxSeverity(["favorable", "concern", "caution"])).toBe("concern");
    expect(maxSeverity(["neutral", "favorable"])).toBe("neutral");
    expect(maxSeverity(["caution", "caution", "caution"])).toBe("caution");
  });

  it("returns 'favorable' for an empty list (defensive default)", () => {
    expect(maxSeverity([])).toBe("favorable");
  });

  it("orders critical above concern", () => {
    expect(maxSeverity(["concern", "critical"])).toBe("critical");
  });
});

describe("severityWeight", () => {
  it("orders the six-stop scale concerns-first", () => {
    expect(severityWeight("critical")).toBeGreaterThan(severityWeight("concern"));
    expect(severityWeight("concern")).toBeGreaterThan(severityWeight("caution"));
    expect(severityWeight("caution")).toBeGreaterThan(severityWeight("neutral"));
    expect(severityWeight("neutral")).toBeGreaterThan(severityWeight("favorable"));
    expect(severityWeight("favorable")).toBeGreaterThan(severityWeight("beneficial"));
  });
});

describe("nplStatusLabel", () => {
  it("returns a human-readable label for each NPL code", () => {
    expect(nplStatusLabel("F")).toBe("Final NPL");
    expect(nplStatusLabel("P")).toBe("Proposed NPL");
    expect(nplStatusLabel("A")).toBe("Part of NPL site");
    expect(nplStatusLabel("D")).toBe("Deleted from NPL");
  });
});
