import { describe, expect, it } from "vitest";
import { hashAdvisoryContent, planAdvisoryRun } from "./plan";
import type { ClassifiedAdvisory, StoredAdvisory } from "./types";

const NOW = "2026-09-22T18:00:00.000Z";
const EARLIER = "2026-09-20T12:00:00.000Z";

function classified(
  overrides: Partial<ClassifiedAdvisory> & { source_url: string },
): ClassifiedAdvisory {
  return {
    title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
    summary: "E. coli found.",
    published_on: null,
    on_emergency_banner: false,
    raw: {},
    status: "active",
    scope: "system_wide",
    ...overrides,
  };
}

function stored(
  overrides: Partial<StoredAdvisory> & { source_url: string },
): StoredAdvisory {
  const title = overrides.title ?? "Boil Water Advisory: LOW and HIGH Pressure Districts";
  const summary = overrides.summary ?? "E. coli found.";
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title,
    summary,
    status: "active",
    scope: "system_wide",
    content_hash: hashAdvisoryContent(title, summary),
    published_on: "2026-09-19",
    on_emergency_banner: false,
    ...overrides,
  };
}

const URL_A = "https://city.gov/advisories/a";
const URL_B = "https://city.gov/advisories/b";

describe("hashAdvisoryContent", () => {
  it("is stable across whitespace and case differences", () => {
    expect(hashAdvisoryContent("Boil  Water", " e. coli ")).toBe(
      hashAdvisoryContent("boil water", "E. COLI"),
    );
    expect(hashAdvisoryContent("a", "b")).not.toBe(hashAdvisoryContent("a", "c"));
  });
});

describe("planAdvisoryRun — seeding", () => {
  it("inserts everything and fires no events when the store is empty", () => {
    const plan = planAdvisoryRun({
      stored: [],
      parsed: [
        classified({ source_url: URL_A }),
        classified({ source_url: URL_B, status: "lifted", scope: "localized" }),
      ],
      nowIso: NOW,
    });
    expect(plan.seedOnly).toBe(true);
    expect(plan.events).toEqual([]);
    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts[0]).toMatchObject({
      source_url: URL_A,
      first_seen_at: NOW,
      last_seen_at: NOW,
      last_changed_at: NOW,
    });
    expect(plan.counts).toEqual({ parsed: 2, new: 2, changed: 0, unchanged: 0 });
  });
});

describe("planAdvisoryRun — events", () => {
  it("a new active URL is an issued event, notifiable when district-wide", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [classified({ source_url: URL_A }), classified({ source_url: URL_B })],
      nowIso: NOW,
    });
    expect(plan.seedOnly).toBe(false);
    expect(plan.events).toEqual([
      expect.objectContaining({ kind: "issued", source_url: URL_B, notifiable: true }),
    ]);
  });

  it("a new localized URL is recorded but not notifiable", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [
        classified({ source_url: URL_A }),
        classified({ source_url: URL_B, status: "scheduled", scope: "localized" }),
      ],
      nowIso: NOW,
    });
    expect(plan.events).toEqual([
      expect.objectContaining({ kind: "issued", source_url: URL_B, notifiable: false }),
    ]);
    expect(plan.upserts.find((u) => u.source_url === URL_B)?.first_seen_at).toBe(NOW);
  });

  it("a new URL with unknown status still counts as issued (over-notify bias)", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [
        classified({ source_url: URL_A }),
        classified({ source_url: URL_B, status: "unknown", scope: "unknown" }),
      ],
      nowIso: NOW,
    });
    expect(plan.events[0]).toMatchObject({ kind: "issued", notifiable: true });
  });

  it("a new URL with lifted status is a lifted event", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [
        classified({ source_url: URL_A }),
        classified({ source_url: URL_B, status: "lifted", title: "Boil Water Advisory Lifted: Districts" }),
      ],
      nowIso: NOW,
    });
    expect(plan.events).toEqual([
      expect.objectContaining({ kind: "lifted", source_url: URL_B, notifiable: true }),
    ]);
  });

  it("an existing row whose status flips to lifted is a lifted event, not an update", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [
        classified({
          source_url: URL_A,
          title: "Boil Water Advisory LIFTED: LOW and HIGH Pressure Districts",
          status: "lifted",
        }),
      ],
      nowIso: NOW,
    });
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ kind: "lifted", source_url: URL_A });
    expect(plan.upserts[0]).toMatchObject({ status: "lifted", last_changed_at: NOW });
    expect(plan.upserts[0].first_seen_at).toBeUndefined();
  });

  it("a changed summary on an existing row is an updated event", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [classified({ source_url: URL_A, summary: "Second round of samples pending." })],
      nowIso: NOW,
    });
    expect(plan.events).toEqual([
      expect.objectContaining({ kind: "updated", source_url: URL_A, notifiable: true }),
    ]);
    expect(plan.counts.changed).toBe(1);
  });

  it("an unchanged row only advances last_seen_at and fires nothing", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A, published_on: null })],
      parsed: [classified({ source_url: URL_A })],
      nowIso: NOW,
    });
    expect(plan.events).toEqual([]);
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.upserts[0].last_seen_at).toBe(NOW);
    expect(plan.upserts[0].last_changed_at).toBeUndefined();
  });

  it("a row that disappeared from the page is left alone", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A }), stored({ source_url: URL_B, id: "x" })],
      parsed: [classified({ source_url: URL_A })],
      nowIso: NOW,
    });
    expect(plan.upserts.map((u) => u.source_url)).toEqual([URL_A]);
    expect(plan.events).toEqual([]);
  });

  it("the same event cannot fire twice for the same content (idempotency key)", () => {
    const first = planAdvisoryRun({
      stored: [stored({ source_url: URL_A })],
      parsed: [classified({ source_url: URL_A, summary: "changed" })],
      nowIso: EARLIER,
    });
    const afterApply = stored({
      source_url: URL_A,
      summary: "changed",
    });
    const second = planAdvisoryRun({
      stored: [afterApply],
      parsed: [classified({ source_url: URL_A, summary: "changed" })],
      nowIso: NOW,
    });
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(0);
    expect(first.events[0].content_hash).toBe(afterApply.content_hash);
  });
});

describe("planAdvisoryRun — scope handling", () => {
  it("keeps a district-wide scope once earned even if the banner is gone", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A, scope: "system_wide", on_emergency_banner: true })],
      parsed: [classified({ source_url: URL_A, scope: "unknown", on_emergency_banner: false })],
      nowIso: NOW,
    });
    expect(plan.upserts[0].scope).toBe("system_wide");
  });

  it("keeps a stored published_on when the parse has none", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_A, published_on: "2026-09-19" })],
      parsed: [classified({ source_url: URL_A, published_on: null })],
      nowIso: NOW,
    });
    expect(plan.upserts[0].published_on).toBe("2026-09-19");
    expect(plan.counts.unchanged).toBe(1);
  });

  it("merges a banner appearance into a list entry with the same URL", () => {
    const plan = planAdvisoryRun({
      stored: [stored({ source_url: URL_B, id: "y" })],
      parsed: [
        classified({ source_url: URL_A, scope: "localized", title: "Boil Water Advisory: Elm St" }),
        classified({
          source_url: URL_A,
          scope: "system_wide",
          on_emergency_banner: true,
          title: "Boil Water Advisory: Elm St",
        }),
      ],
      nowIso: NOW,
    });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({ on_emergency_banner: true, scope: "system_wide" });
    expect(plan.events).toEqual([
      expect.objectContaining({ kind: "issued", notifiable: true }),
    ]);
  });
});
