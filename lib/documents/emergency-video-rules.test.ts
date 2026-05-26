import { describe, it, expect } from "vitest";
import {
  shouldSaveAsPrimary,
  pickPromotedSecondaryId,
  type EmergencyVideoSummary,
} from "./emergency-video-rules";

function row(
  id: string,
  created_at: string,
  emergency_is_primary = false,
): EmergencyVideoSummary {
  return { id, created_at, emergency_is_primary };
}

describe("shouldSaveAsPrimary", () => {
  it("returns true when the category has zero existing rows", () => {
    expect(shouldSaveAsPrimary([])).toBe(true);
  });

  it("returns false when one row already exists", () => {
    expect(shouldSaveAsPrimary([row("a", "2026-05-26T10:00:00Z", true)])).toBe(
      false,
    );
  });

  it("returns false when many rows exist regardless of their primary flag", () => {
    expect(
      shouldSaveAsPrimary([
        row("a", "2026-05-26T10:00:00Z", true),
        row("b", "2026-05-26T11:00:00Z", false),
        row("c", "2026-05-26T12:00:00Z", false),
      ]),
    ).toBe(false);
  });

  it("does not look at the primary flag — even an all-secondary list keeps the rule at false", () => {
    // Edge case: data integrity bug somewhere left the category
    // without a primary. The save rule still treats it as "rows
    // exist," because the auto-promote path is what would fix it,
    // not the save path.
    expect(
      shouldSaveAsPrimary([
        row("a", "2026-05-26T10:00:00Z", false),
        row("b", "2026-05-26T11:00:00Z", false),
      ]),
    ).toBe(false);
  });
});

describe("pickPromotedSecondaryId", () => {
  it("returns null when no secondaries remain", () => {
    expect(pickPromotedSecondaryId([])).toBeNull();
  });

  it("returns the only id when one secondary remains", () => {
    expect(
      pickPromotedSecondaryId([row("a", "2026-05-26T10:00:00Z")]),
    ).toBe("a");
  });

  it("picks the most recently created when several remain", () => {
    expect(
      pickPromotedSecondaryId([
        row("a", "2026-05-26T10:00:00Z"),
        row("c", "2026-05-26T12:00:00Z"),
        row("b", "2026-05-26T11:00:00Z"),
      ]),
    ).toBe("c");
  });

  it("ignores input order — the most recent wins regardless of array position", () => {
    expect(
      pickPromotedSecondaryId([
        row("newest", "2026-05-26T12:00:00Z"),
        row("oldest", "2026-05-26T10:00:00Z"),
      ]),
    ).toBe("newest");
  });

  it("breaks ties deterministically on lexically larger id", () => {
    expect(
      pickPromotedSecondaryId([
        row("aaa", "2026-05-26T10:00:00Z"),
        row("zzz", "2026-05-26T10:00:00Z"),
        row("mmm", "2026-05-26T10:00:00Z"),
      ]),
    ).toBe("zzz");
  });

  it("returns the same answer for repeated calls (no nondeterminism)", () => {
    const rows = [
      row("a", "2026-05-26T11:00:00Z"),
      row("b", "2026-05-26T11:00:00Z"),
      row("c", "2026-05-26T11:00:00Z"),
    ];
    const first = pickPromotedSecondaryId(rows);
    const second = pickPromotedSecondaryId(rows);
    expect(first).toBe(second);
  });
});
