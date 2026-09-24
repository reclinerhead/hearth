import { describe, expect, it } from "vitest";
import { carryForwardDetail, detailFromRaw, selectRefreshUrls } from "./detail";
import type { ParsedAdvisory, StoredAdvisory } from "./types";

const NOW = "2026-09-24T18:00:00.000Z";

function stored(overrides: Partial<StoredAdvisory> & { source_url: string }): StoredAdvisory {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
    summary: "E. coli found.",
    status: "active",
    scope: "system_wide",
    content_hash: "h",
    published_on: "2026-09-19",
    on_emergency_banner: false,
    first_seen_at: "2026-09-24T14:13:10.426Z",
    raw: {},
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedAdvisory> & { source_url: string }): ParsedAdvisory {
  return {
    title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
    summary: "E. coli found.",
    published_on: null,
    on_emergency_banner: false,
    raw: {},
    ...overrides,
  };
}

const PAGE = { title: "Boil Water Advisory LIFTED: LOW and HIGH Pressure Districts", lead: "This advisory has been lifted." };

describe("selectRefreshUrls", () => {
  it("names open rows: active / scheduled / unknown, dated within the window", () => {
    const urls = selectRefreshUrls(
      [
        stored({ source_url: "a", status: "active" }),
        stored({ source_url: "b", status: "scheduled", published_on: null }), // falls back to first_seen_at
        stored({ source_url: "c", status: "unknown" }),
        stored({ source_url: "d", status: "lifted" }),
      ],
      NOW,
    );
    expect([...urls]).toEqual(["a", "b", "c"]);
  });

  it("leaves rows outside the open window alone", () => {
    const urls = selectRefreshUrls(
      [
        stored({ source_url: "old", published_on: "2026-09-01" }),
        stored({ source_url: "out", published_on: "2026-09-10" }), // 14.75 days: past the window, like the timeline
        stored({ source_url: "edge", published_on: "2026-09-11" }), // 13.75 days
        stored({ source_url: "fresh", published_on: "2026-09-20" }),
      ],
      NOW,
    );
    expect([...urls]).toEqual(["edge", "fresh"]);
    expect([...selectRefreshUrls([stored({ source_url: "fresh", published_on: "2026-09-20" })], NOW, 3)]).toEqual([]);
  });
});

describe("detailFromRaw", () => {
  it("reads the persisted fields and returns null when there are none", () => {
    expect(detailFromRaw({ detail_title: PAGE.title, detail_lead: PAGE.lead })).toEqual(PAGE);
    expect(detailFromRaw({ detail_title: PAGE.title })).toEqual({ title: PAGE.title, lead: null });
    expect(detailFromRaw({ list_title: "x", detail_error: "504" })).toBeNull();
    expect(detailFromRaw({ detail_title: 42 })).toBeNull();
  });
});

describe("carryForwardDetail", () => {
  const rows = [stored({ source_url: "a", raw: { detail_title: PAGE.title, detail_lead: PAGE.lead } }), stored({ source_url: "b" })];

  it("fills detail from the stored capture for an entry the adapter did not read", () => {
    const [a] = carryForwardDetail([parsed({ source_url: "a" })], rows);
    expect(a.detail).toEqual(PAGE);
  });

  it("keeps the adapter's fresh read over the stored capture", () => {
    const fresh = { title: PAGE.title, lead: "Sunday update." };
    const [a] = carryForwardDetail([parsed({ source_url: "a", detail: fresh })], rows);
    expect(a.detail).toBe(fresh);
  });

  it("leaves an entry without any detail untouched (unknown URL, or a stored row that never had a page read)", () => {
    const out = carryForwardDetail([parsed({ source_url: "b" }), parsed({ source_url: "new" })], rows);
    expect(out.map((p) => p.detail)).toEqual([undefined, undefined]);
  });

  it("a failed re-read (detail_error, no detail) still carries the stored capture forward", () => {
    const [a] = carryForwardDetail([parsed({ source_url: "a", raw: { detail_error: "GET … → 504" } })], rows);
    expect(a.detail).toEqual(PAGE);
    expect(a.raw).toEqual({ detail_error: "GET … → 504" });
  });
});
