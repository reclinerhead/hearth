import { describe, expect, it } from "vitest";
import {
  HEARTH_DOCUMENTS_BUCKET,
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
  HOUSE_PHOTOS_BUCKET,
} from "@/lib/documents/paths";
import {
  planStorageRemovals,
  type ReconcileInput,
  type StorageLeaf,
} from "./reconcile";

// --------------------------------------------------------------------------
// Fixtures
//
// `nowMs` is a fixed clock so the age guard is deterministic. `OLD` is well
// outside any grace window; `FRESH` is moments ago. The pure function takes
// `nowMs` precisely so tests don't depend on the wall clock.
// --------------------------------------------------------------------------

const NOW_MS = Date.parse("2026-06-02T12:00:00.000Z");
const GRACE_MS = 24 * 60 * 60 * 1000; // 24h
const OLD = "2026-05-01T12:00:00.000Z"; // ~32 days old → past grace
const FRESH = "2026-06-02T11:59:00.000Z"; // 1 min old → inside grace

const HOUSE_A = "11111111-1111-1111-1111-111111111111";
const HOUSE_GONE = "99999999-9999-9999-9999-999999999999";
const DOC_LIVE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_GONE = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function baseInput(
  objects: StorageLeaf[],
  overrides: Partial<ReconcileInput> = {},
): ReconcileInput {
  return {
    objects,
    knownHouseIds: new Set([HOUSE_A]),
    knownDocumentIds: new Set([DOC_LIVE]),
    housesWithUserPhoto: new Set([HOUSE_A]),
    graceMs: GRACE_MS,
    nowMs: NOW_MS,
    perRunCap: 100,
    ...overrides,
  };
}

describe("planStorageRemovals", () => {
  it("produces an empty plan for a fully-consistent bucket set", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_LIVE}/optimized.jpg`,
        createdAt: OLD,
      },
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_LIVE}/thumb.jpg`,
        createdAt: OLD,
      },
      {
        bucket: HOUSE_PHOTOS_BUCKET,
        path: `${HOUSE_A}/photo`,
        createdAt: OLD,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.removals).toEqual([]);
    expect(plan.candidateCount).toBe(0);
    expect(plan.capExceeded).toBe(false);
  });

  it("flags a document orphan (document_id with no documents row)", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/optimized.jpg`,
        createdAt: OLD,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.removals).toEqual([
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/optimized.jpg`,
        reason: "document",
      },
    ]);
  });

  it("flags document orphans in the emergency-videos bucket too", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_EMERGENCY_VIDEOS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/video.mp4`,
        createdAt: OLD,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.removals).toHaveLength(1);
    expect(plan.removals[0].reason).toBe("document");
  });

  it("flags a house-photo orphan (house exists but user_image_url is null)", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HOUSE_PHOTOS_BUCKET,
        path: `${HOUSE_A}/photo`,
        createdAt: OLD,
      },
    ];

    // House A is known, but no longer has a photo on its row.
    const plan = planStorageRemovals(
      baseInput(objects, { housesWithUserPhoto: new Set() }),
    );

    expect(plan.removals).toEqual([
      {
        bucket: HOUSE_PHOTOS_BUCKET,
        path: `${HOUSE_A}/photo`,
        reason: "house-photo",
      },
    ]);
  });

  it("flags a house-directory orphan wholesale across buckets", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        // DOC_LIVE exists as a row, but its house is gone — house-id check
        // wins, so this is a house-directory orphan, not a document one.
        path: `${HOUSE_GONE}/${DOC_LIVE}/optimized.jpg`,
        createdAt: OLD,
      },
      {
        bucket: HOUSE_PHOTOS_BUCKET,
        path: `${HOUSE_GONE}/photo`,
        createdAt: OLD,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.removals).toHaveLength(2);
    expect(plan.removals.every((r) => r.reason === "house-directory")).toBe(
      true,
    );
  });

  it("excludes objects newer than the grace window (age guard)", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/optimized.jpg`,
        createdAt: FRESH,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    // Detected as an orphan, but protected because it's inside the window.
    expect(plan.candidateCount).toBe(1);
    expect(plan.protectedByAgeCount).toBe(1);
    expect(plan.removals).toEqual([]);
  });

  it("protects objects with a missing or unparseable timestamp", () => {
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/null-ts.jpg`,
        createdAt: null,
      },
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/bad-ts.jpg`,
        createdAt: "not-a-date",
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.candidateCount).toBe(2);
    expect(plan.protectedByAgeCount).toBe(2);
    expect(plan.removals).toEqual([]);
  });

  it("removes an object exactly at the grace boundary", () => {
    const boundary = new Date(NOW_MS - GRACE_MS).toISOString();
    const objects: StorageLeaf[] = [
      {
        bucket: HEARTH_DOCUMENTS_BUCKET,
        path: `${HOUSE_A}/${DOC_GONE}/optimized.jpg`,
        createdAt: boundary,
      },
    ];

    const plan = planStorageRemovals(baseInput(objects));

    expect(plan.removals).toHaveLength(1);
  });

  it("bails (empty plan, capExceeded) when removals exceed the per-run cap", () => {
    const objects: StorageLeaf[] = Array.from({ length: 5 }, (_, i) => ({
      bucket: HEARTH_DOCUMENTS_BUCKET,
      path: `${HOUSE_A}/${DOC_GONE}/file-${i}.jpg`,
      createdAt: OLD,
    }));

    const plan = planStorageRemovals(baseInput(objects, { perRunCap: 4 }));

    expect(plan.capExceeded).toBe(true);
    expect(plan.removals).toEqual([]);
    // Candidate count still reflects what *would* have been removed, so the
    // route can log the real number it bailed on.
    expect(plan.candidateCount).toBe(5);
  });

  it("does not bail when removals are exactly at the cap", () => {
    const objects: StorageLeaf[] = Array.from({ length: 4 }, (_, i) => ({
      bucket: HEARTH_DOCUMENTS_BUCKET,
      path: `${HOUSE_A}/${DOC_GONE}/file-${i}.jpg`,
      createdAt: OLD,
    }));

    const plan = planStorageRemovals(baseInput(objects, { perRunCap: 4 }));

    expect(plan.capExceeded).toBe(false);
    expect(plan.removals).toHaveLength(4);
  });
});
