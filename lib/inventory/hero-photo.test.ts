import { describe, expect, it } from "vitest";
import {
  orderPhotosHeroFirst,
  selectHeroPhoto,
  type HeroPhoto,
} from "./hero-photo";

function photo(id: string, created_at: string): HeroPhoto {
  return { id, created_at };
}

describe("orderPhotosHeroFirst", () => {
  it("returns an empty array unchanged", () => {
    expect(orderPhotosHeroFirst([], null)).toEqual([]);
  });

  it("orders the most-recently-uploaded photo first when no hero is pinned", () => {
    const photos = [
      photo("a", "2026-01-01T00:00:00Z"),
      photo("c", "2026-03-01T00:00:00Z"),
      photo("b", "2026-02-01T00:00:00Z"),
    ];
    expect(orderPhotosHeroFirst(photos, null).map((p) => p.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("floats a present pinned hero to the front, rest stay newest-first", () => {
    const photos = [
      photo("new", "2026-03-01T00:00:00Z"),
      photo("pinned", "2026-01-01T00:00:00Z"),
      photo("mid", "2026-02-01T00:00:00Z"),
    ];
    expect(orderPhotosHeroFirst(photos, "pinned").map((p) => p.id)).toEqual([
      "pinned",
      "new",
      "mid",
    ]);
  });

  it("ignores a pin whose document is absent (deleted hero falls through)", () => {
    const photos = [
      photo("a", "2026-01-01T00:00:00Z"),
      photo("b", "2026-02-01T00:00:00Z"),
    ];
    // hero_document_id points at a doc no longer in the list (e.g. deleted,
    // FK SET NULL hasn't reached this read yet) — newest wins.
    expect(orderPhotosHeroFirst(photos, "gone").map((p) => p.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("does not mutate the input array", () => {
    const photos = [
      photo("a", "2026-01-01T00:00:00Z"),
      photo("b", "2026-02-01T00:00:00Z"),
    ];
    const snapshot = photos.map((p) => p.id);
    orderPhotosHeroFirst(photos, null);
    expect(photos.map((p) => p.id)).toEqual(snapshot);
  });

  it("breaks ties on equal timestamps deterministically by id", () => {
    const ts = "2026-01-01T00:00:00Z";
    const photos = [photo("m", ts), photo("a", ts), photo("z", ts)];
    expect(orderPhotosHeroFirst(photos, null).map((p) => p.id)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });
});

describe("selectHeroPhoto", () => {
  it("returns null for an empty list", () => {
    expect(selectHeroPhoto([], null)).toBeNull();
    expect(selectHeroPhoto([], "anything")).toBeNull();
  });

  it("returns the pinned hero when present", () => {
    const photos = [
      photo("new", "2026-03-01T00:00:00Z"),
      photo("pinned", "2026-01-01T00:00:00Z"),
    ];
    expect(selectHeroPhoto(photos, "pinned")?.id).toBe("pinned");
  });

  it("returns the newest upload when nothing is pinned", () => {
    const photos = [
      photo("old", "2026-01-01T00:00:00Z"),
      photo("new", "2026-03-01T00:00:00Z"),
    ];
    expect(selectHeroPhoto(photos, null)?.id).toBe("new");
  });

  it("returns the newest upload when the pin is absent", () => {
    const photos = [
      photo("old", "2026-01-01T00:00:00Z"),
      photo("new", "2026-03-01T00:00:00Z"),
    ];
    expect(selectHeroPhoto(photos, "deleted")?.id).toBe("new");
  });
});
