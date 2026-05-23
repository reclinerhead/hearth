import { describe, expect, it } from "vitest";
import { groupTasksByTier } from "./tier-grouping";

// Anchor the reference clock at UTC midnight so the helper's
// normalizeToDateOnly is a no-op and the assertions stay readable.
const TODAY = new Date(Date.UTC(2026, 4, 23)); // 2026-05-23

function dateOffset(days: number): string {
  const d = new Date(TODAY.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function task(id: string, next_due_at: string) {
  return { id, next_due_at };
}

describe("groupTasksByTier", () => {
  it("returns empty groups for an empty input", () => {
    const result = groupTasksByTier([], TODAY);
    expect(result).toEqual({ overdue: [], next30: [], later: [] });
  });

  it("buckets a task due yesterday as overdue", () => {
    const t = task("a", dateOffset(-1));
    const result = groupTasksByTier([t], TODAY);
    expect(result.overdue).toEqual([t]);
    expect(result.next30).toEqual([]);
    expect(result.later).toEqual([]);
  });

  it("buckets a task due today as next30 (today is due, not overdue)", () => {
    const t = task("a", dateOffset(0));
    const result = groupTasksByTier([t], TODAY);
    expect(result.overdue).toEqual([]);
    expect(result.next30).toEqual([t]);
    expect(result.later).toEqual([]);
  });

  it("buckets a task due 30 days from today as next30 (upper bound inclusive)", () => {
    const t = task("a", dateOffset(30));
    const result = groupTasksByTier([t], TODAY);
    expect(result.next30).toEqual([t]);
    expect(result.later).toEqual([]);
  });

  it("buckets a task due 31 days from today as later", () => {
    const t = task("a", dateOffset(31));
    const result = groupTasksByTier([t], TODAY);
    expect(result.next30).toEqual([]);
    expect(result.later).toEqual([t]);
  });

  it("sorts overdue tasks with the most-overdue first", () => {
    const recent = task("recent", dateOffset(-2));
    const ancient = task("ancient", dateOffset(-90));
    const middle = task("middle", dateOffset(-30));
    const result = groupTasksByTier([recent, ancient, middle], TODAY);
    expect(result.overdue.map((t) => t.id)).toEqual([
      "ancient",
      "middle",
      "recent",
    ]);
  });

  it("sorts next30 and later ascending (soonest first)", () => {
    const a = task("a", dateOffset(5));
    const b = task("b", dateOffset(1));
    const c = task("c", dateOffset(20));
    const later1 = task("later1", dateOffset(60));
    const later2 = task("later2", dateOffset(45));
    const result = groupTasksByTier([a, b, c, later1, later2], TODAY);
    expect(result.next30.map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(result.later.map((t) => t.id)).toEqual(["later2", "later1"]);
  });

  it("silently drops a task with a malformed next_due_at", () => {
    const valid = task("valid", dateOffset(2));
    const malformed = task("malformed", "not-a-date");
    const result = groupTasksByTier([valid, malformed], TODAY);
    expect(result.next30).toEqual([valid]);
    expect(result.overdue).toEqual([]);
    expect(result.later).toEqual([]);
  });

  it("tiers correctly when the reference Date is just past UTC midnight", () => {
    // 00:00:01 UTC on the same calendar day — normalizeToDateOnly should
    // collapse to the same comparison base as a midnight reference, so a
    // task due "today" still lands in next30.
    const justAfterMidnight = new Date(Date.UTC(2026, 4, 23, 0, 0, 1));
    const t = task("a", "2026-05-23");
    const result = groupTasksByTier([t], justAfterMidnight);
    expect(result.next30).toEqual([t]);
    expect(result.overdue).toEqual([]);
  });

  it("tiers correctly when the reference Date is just before UTC midnight", () => {
    // 23:59:59 UTC on the prior day — still belongs to the prior calendar
    // day after normalization, so a task due "tomorrow" should land in
    // next30 (cutoff is +30 from the prior day, well past tomorrow).
    const justBeforeMidnight = new Date(Date.UTC(2026, 4, 22, 23, 59, 59));
    const t = task("a", "2026-05-23");
    const result = groupTasksByTier([t], justBeforeMidnight);
    expect(result.next30).toEqual([t]);
    expect(result.overdue).toEqual([]);
  });
});
