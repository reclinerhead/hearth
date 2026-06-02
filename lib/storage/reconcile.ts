/**
 * Storage/row reconciliation — the pure orphan-detection core behind the
 * scheduled sweep at `app/api/cron/storage-sweep/route.ts` (issue #266).
 *
 * Every storage-backed delete path in Hearth deletes the row
 * authoritatively and removes the bytes best-effort, deferring failures
 * "to a future periodic sweep." This is that sweep. It also covers the
 * upload-then-insert orphan window — a client uploaded an object but the
 * row INSERT never landed (hard tab close, crash, mobile-Safari tab kill).
 *
 * This file is deliberately I/O-free: the route gathers the storage object
 * listing and the owning-row id sets, then hands them here to compute the
 * remove plan. That keeps the "which paths are orphaned given these objects
 * and these rows" decision — the load-bearing, get-it-wrong-and-you-delete-
 * a-real-photo part — unit-testable without touching Supabase.
 *
 * Three orphan classes (see `OrphanReason`):
 *   - house-directory: a top-level `{house_id}/` folder (in any bucket)
 *     whose house has no `hearth.houses` row. Catches deleted houses
 *     wholesale, regardless of what's underneath.
 *   - document: a `{house_id}/{document_id}/...` object in a document
 *     bucket whose `{document_id}` has no `hearth.documents` row.
 *   - house-photo: a `house-photos/{house_id}/photo` object whose house
 *     row still exists but no longer points at a photo
 *     (`user_image_url IS NULL`).
 *
 * Two safety rails are baked in here (the rest live in the route):
 *   - Age guard: an object is only ever a removal candidate once it's older
 *     than `graceMs`. A legitimately-orphaned object is still orphaned
 *     tomorrow; a just-uploaded one (row INSERT possibly still in flight) is
 *     protected. Unknown/unparseable timestamps are treated as too-new and
 *     protected — we never delete bytes we can't prove are old.
 *   - Per-run cap: if the candidate count exceeds `perRunCap`, the whole
 *     plan is emptied and `capExceeded` is set so the route logs-and-bails.
 *     A logic regression can't nuke a bucket in one pass.
 */

import {
  HEARTH_DOCUMENTS_BUCKET,
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
  HOUSE_PHOTOS_BUCKET,
} from "@/lib/documents/paths";

export type SweepBucket =
  | typeof HEARTH_DOCUMENTS_BUCKET
  | typeof HEARTH_EMERGENCY_VIDEOS_BUCKET
  | typeof HOUSE_PHOTOS_BUCKET;

/**
 * Buckets whose object path is `{house_id}/{document_id}/...` and whose
 * owning row is `hearth.documents`. `house-photos` is handled separately.
 */
export const DOCUMENT_BUCKETS: ReadonlySet<SweepBucket> = new Set([
  HEARTH_DOCUMENTS_BUCKET,
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
]);

/** Every private bucket the sweep walks. */
export const SWEEP_BUCKETS: readonly SweepBucket[] = [
  HEARTH_DOCUMENTS_BUCKET,
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
  HOUSE_PHOTOS_BUCKET,
];

export type OrphanReason = "house-directory" | "document" | "house-photo";

/**
 * A single leaf object (a real file, never a folder prefix) discovered by
 * the route's storage listing. `createdAt` is the storage `created_at` /
 * `updated_at` metadata, which only leaf objects carry — exactly where the
 * age guard needs to apply, since leaves are what get removed.
 */
export type StorageLeaf = {
  bucket: SweepBucket;
  /** Bucket-relative path, no leading slash, e.g. `{house}/{doc}/optimized.jpg`. */
  path: string;
  /** ISO timestamp from storage metadata, or null when unavailable. */
  createdAt: string | null;
};

export type RemovalCandidate = {
  bucket: SweepBucket;
  path: string;
  reason: OrphanReason;
};

export type ReconcileInput = {
  /** Leaf objects gathered across every swept bucket. */
  objects: readonly StorageLeaf[];
  /** Ids of every `hearth.houses` row. */
  knownHouseIds: ReadonlySet<string>;
  /** Ids of every `hearth.documents` row. */
  knownDocumentIds: ReadonlySet<string>;
  /** House ids whose `user_image_url` is non-null (a photo is expected). */
  housesWithUserPhoto: ReadonlySet<string>;
  /** Grace window in ms; objects younger than this are protected. */
  graceMs: number;
  /** "Now" in ms since epoch (passed in so the function stays pure). */
  nowMs: number;
  /** Max removals allowed in one run before the plan log-and-bails. */
  perRunCap: number;
};

export type ReconcilePlan = {
  /** Objects to remove. Empty when `capExceeded` is true. */
  removals: RemovalCandidate[];
  /** Orphans detected before the age guard — for logging visibility. */
  candidateCount: number;
  /** Orphans excluded solely because they fall inside the grace window. */
  protectedByAgeCount: number;
  /**
   * True when the post-age-guard removal count would exceed `perRunCap`.
   * `removals` is emptied; the route must log the count and delete nothing.
   */
  capExceeded: boolean;
};

/**
 * Classify a single leaf. Returns the orphan reason, or null when the leaf
 * is accounted for (its house / document / photo row exists). House-id
 * absence is checked first so a deleted house's objects are caught wholesale
 * regardless of bucket or what's underneath.
 */
function classifyLeaf(
  leaf: StorageLeaf,
  input: ReconcileInput,
): OrphanReason | null {
  const segments = leaf.path.split("/").filter(Boolean);
  const houseId = segments[0];
  if (!houseId) return null;

  if (!input.knownHouseIds.has(houseId)) return "house-directory";

  if (leaf.bucket === HOUSE_PHOTOS_BUCKET) {
    // `{house_id}/photo` under an existing house — orphan only when the row
    // no longer points at a photo. (A populated row is the authoritative
    // "this object is in use" signal.)
    return input.housesWithUserPhoto.has(houseId) ? null : "house-photo";
  }

  if (DOCUMENT_BUCKETS.has(leaf.bucket)) {
    const documentId = segments[1];
    if (!documentId) return null;
    // Document ids are globally-unique uuids, so a global id set is a sound
    // (and conservative) membership test — a real document never reads as an
    // orphan even if it somehow sat under the wrong house folder.
    return input.knownDocumentIds.has(documentId) ? null : "document";
  }

  return null;
}

/**
 * An object is removable only once it's at least `graceMs` old. Missing or
 * unparseable timestamps are treated as too-new (protected) — we never
 * delete bytes we can't prove are old enough.
 */
function isOlderThanGrace(
  createdAt: string | null,
  nowMs: number,
  graceMs: number,
): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t >= graceMs;
}

/**
 * Compute the remove plan for one sweep run. Pure: same inputs → same plan.
 */
export function planStorageRemovals(input: ReconcileInput): ReconcilePlan {
  let candidateCount = 0;
  let protectedByAgeCount = 0;
  const removals: RemovalCandidate[] = [];

  for (const leaf of input.objects) {
    const reason = classifyLeaf(leaf, input);
    if (!reason) continue;
    candidateCount++;

    if (!isOlderThanGrace(leaf.createdAt, input.nowMs, input.graceMs)) {
      protectedByAgeCount++;
      continue;
    }

    removals.push({ bucket: leaf.bucket, path: leaf.path, reason });
  }

  if (removals.length > input.perRunCap) {
    return {
      removals: [],
      candidateCount,
      protectedByAgeCount,
      capExceeded: true,
    };
  }

  return { removals, candidateCount, protectedByAgeCount, capExceeded: false };
}
