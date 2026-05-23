import { describe, expect, it } from "vitest";
import { computeSuccessorDueDate } from "./successor-task";

describe("computeSuccessorDueDate", () => {
  it("returns the explicit override unchanged when present", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 6,
      completedOn: "2026-05-23",
      newExpirationOverride: "2027-08-15",
    });
    expect(result).toBe("2027-08-15");
  });

  it("returns the override even when cadence would normally produce null", () => {
    // Renewal tasks land with cadence_kind='interval' even when the user
    // picks an off-cadence date; the override takes precedence.
    const result = computeSuccessorDueDate({
      cadence_kind: "one_time",
      cadence_interval_months: null,
      completedOn: "2026-05-23",
      newExpirationOverride: "2028-01-01",
    });
    expect(result).toBe("2028-01-01");
  });

  it("returns null for one_time cadences without an override", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "one_time",
      cadence_interval_months: null,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBeNull();
  });

  it("returns null for per_use cadences without an override", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "per_use",
      cadence_interval_months: null,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when cadence_interval_months is missing", () => {
    // Defensive — shouldn't happen at runtime (the cadence-shape CHECK
    // constraint pairs interval/seasonal with a months value), but the
    // helper shouldn't crash if it does.
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: null,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBeNull();
  });

  it("adds 12 months for an annual cadence", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 12,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBe("2027-05-23");
  });

  it("adds 24 months for a two-year cadence", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 24,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBe("2028-05-23");
  });

  it("adds 6 months for a half-year cadence and crosses year boundaries", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 6,
      completedOn: "2026-09-15",
      newExpirationOverride: null,
    });
    expect(result).toBe("2027-03-15");
  });

  it("adds 1 month for a monthly cadence", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 1,
      completedOn: "2026-05-23",
      newExpirationOverride: null,
    });
    expect(result).toBe("2026-06-23");
  });

  it("handles a Feb 29 completion + 12 months by rolling to Mar 1", () => {
    // JavaScript's Date.UTC clamps an overflowed day forward — Feb 29
    // in a non-leap target year becomes Mar 1. This is the behavior the
    // mark-renewed sheet's projected-expiration preview uses, so the
    // user sees the rolled date before they confirm.
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 12,
      completedOn: "2028-02-29",
      newExpirationOverride: null,
    });
    expect(result).toBe("2029-03-01");
  });

  it("handles seasonal cadences the same as interval cadences", () => {
    // Seasonal cadences are still anchored to the user's completion date
    // for the successor — the season alignment is informational only at
    // the modal/UI level. The helper only does the date math.
    const result = computeSuccessorDueDate({
      cadence_kind: "seasonal",
      cadence_interval_months: 12,
      completedOn: "2026-10-15",
      newExpirationOverride: null,
    });
    expect(result).toBe("2027-10-15");
  });

  it("returns null when completedOn is malformed", () => {
    const result = computeSuccessorDueDate({
      cadence_kind: "interval",
      cadence_interval_months: 12,
      completedOn: "not-a-date",
      newExpirationOverride: null,
    });
    expect(result).toBeNull();
  });
});
