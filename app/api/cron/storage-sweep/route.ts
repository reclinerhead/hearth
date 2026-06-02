/**
 * Storage/row reconciliation sweep (issue #266) — the backstop that makes
 * every "delete the row, remove the bytes best-effort, defer failures to a
 * future periodic sweep" trade-off in Hearth an honest one.
 *
 * Runs on a Vercel Cron schedule (see vercel.json). For each private bucket
 * it lists the objects, diffs them against the owning rows, and removes the
 * orphans — failed best-effort deletes *and* the upload-then-insert window
 * where a client wrote an object but the row INSERT never landed.
 *
 * The orphan-detection diff lives in `lib/storage/reconcile.ts` (pure,
 * unit-tested). This route is the thin I/O shell: auth, listing, row reads,
 * logging, and the actual `.remove()` calls.
 *
 * SAFETY (this job deletes bytes with RLS bypassed — handle with care):
 *   - Rows are read BEFORE objects are listed, and the pure diff applies a
 *     24h age guard, so a just-uploaded object whose row INSERT is still in
 *     flight is never mistaken for an orphan.
 *   - Destructive removal is gated behind STORAGE_SWEEP_DELETE_ENABLED
 *     (default false). Until it's flipped on, the route only logs the plan.
 *   - A per-run deletion cap (STORAGE_SWEEP_MAX_DELETIONS, default 100)
 *     makes the run log-and-bail rather than mass-delete if the diff ever
 *     goes wrong.
 *
 * AUTH: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` and no
 * session cookie. The proxy allowlists `/api/cron/*` as public (otherwise
 * the auth gate would 307 the cron to /login); this handler is the actual
 * gate — it rejects any request without the matching bearer token with 401.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  DOCUMENT_BUCKETS,
  planStorageRemovals,
  SWEEP_BUCKETS,
  type StorageLeaf,
  type SweepBucket,
} from "@/lib/storage/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_GRACE_HOURS = 24;
const DEFAULT_MAX_DELETIONS = 100;
// Supabase storage `.list()` pages; 1000 is the documented max page size.
const LIST_PAGE_SIZE = 1000;

type ServiceClient = ReturnType<typeof createServiceClient>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * List one page-prefix's immediate children, paging through until exhausted.
 * Folder "prefixes" come back with a null `id` and no metadata; leaf files
 * carry `id`, `created_at`, and `updated_at`.
 */
async function listChildren(
  supabase: ServiceClient,
  bucket: SweepBucket,
  prefix: string,
) {
  const out: {
    name: string;
    id: string | null;
    created_at: string | null;
    updated_at: string | null;
  }[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const entry of data) {
      out.push({
        name: entry.name,
        id: entry.id ?? null,
        created_at: entry.created_at ?? null,
        updated_at: entry.updated_at ?? null,
      });
    }
    if (data.length < LIST_PAGE_SIZE) break;
  }
  return out;
}

/**
 * Walk a bucket and collect its leaf objects (real files, not folders) with
 * their full path + timestamp. `descendDepth` bounds how deep folders are
 * followed: house-photos is `{house}/photo` (descend 1 — into the house
 * folder), document buckets are `{house}/{doc}/file` (descend 2).
 */
async function collectLeaves(
  supabase: ServiceClient,
  bucket: SweepBucket,
  descendDepth: number,
): Promise<StorageLeaf[]> {
  const out: StorageLeaf[] = [];

  async function walk(prefix: string, depth: number): Promise<void> {
    const entries = await listChildren(supabase, bucket, prefix);
    for (const entry of entries) {
      if (!entry.name) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder = entry.id === null;
      if (isFolder) {
        if (depth < descendDepth) await walk(path, depth + 1);
        continue;
      }
      out.push({
        bucket,
        path,
        createdAt: entry.created_at ?? entry.updated_at ?? null,
      });
    }
  }

  await walk("", 0);
  return out;
}

export async function GET(request: Request): Promise<Response> {
  // --- Auth -------------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[storage-sweep] CRON_SECRET is not set — refusing to run");
    return json({ error: "Sweep is not configured." }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  const graceMs = envInt("STORAGE_SWEEP_GRACE_HOURS", DEFAULT_GRACE_HOURS) * 3_600_000;
  const perRunCap = envInt("STORAGE_SWEEP_MAX_DELETIONS", DEFAULT_MAX_DELETIONS);
  const deleteEnabled = process.env.STORAGE_SWEEP_DELETE_ENABLED === "true";
  const nowMs = Date.now();

  const supabase = createServiceClient();

  // --- Rows first, objects second --------------------------------------
  // Snapshot the owning rows before listing storage. A house/document
  // created in the gap would have brand-new objects, which the age guard
  // protects — so this ordering plus the guard closes the TOCTOU window.
  let knownHouseIds: Set<string>;
  let housesWithUserPhoto: Set<string>;
  let knownDocumentIds: Set<string>;
  try {
    const [housesRes, docsRes] = await Promise.all([
      supabase.from("houses").select("id, user_image_url"),
      supabase.from("documents").select("id"),
    ]);
    if (housesRes.error) throw new Error(`houses read: ${housesRes.error.message}`);
    if (docsRes.error) throw new Error(`documents read: ${docsRes.error.message}`);

    knownHouseIds = new Set((housesRes.data ?? []).map((h) => h.id as string));
    housesWithUserPhoto = new Set(
      (housesRes.data ?? [])
        .filter((h) => (h.user_image_url as string | null) != null)
        .map((h) => h.id as string),
    );
    knownDocumentIds = new Set((docsRes.data ?? []).map((d) => d.id as string));
  } catch (err) {
    console.error("[storage-sweep] row read failed:", err);
    return json({ error: "Could not read owning rows." }, 500);
  }

  // --- List objects across every swept bucket --------------------------
  let objects: StorageLeaf[];
  try {
    const perBucket = await Promise.all(
      SWEEP_BUCKETS.map((bucket) =>
        collectLeaves(supabase, bucket, DOCUMENT_BUCKETS.has(bucket) ? 2 : 1),
      ),
    );
    objects = perBucket.flat();
  } catch (err) {
    console.error("[storage-sweep] object listing failed:", err);
    return json({ error: "Could not list storage objects." }, 500);
  }

  // --- Diff (pure) -----------------------------------------------------
  const plan = planStorageRemovals({
    objects,
    knownHouseIds,
    knownDocumentIds,
    housesWithUserPhoto,
    graceMs,
    nowMs,
    perRunCap,
  });

  const summary = {
    buckets: SWEEP_BUCKETS,
    objectsScanned: objects.length,
    houses: knownHouseIds.size,
    documents: knownDocumentIds.size,
    orphanCandidates: plan.candidateCount,
    protectedByAge: plan.protectedByAgeCount,
    toRemove: plan.removals.length,
    deleteEnabled,
    graceHours: graceMs / 3_600_000,
    perRunCap,
  };
  console.info("[storage-sweep] plan", summary);

  // --- Per-run cap: log and bail, delete nothing -----------------------
  if (plan.capExceeded) {
    console.error(
      `[storage-sweep] ${plan.candidateCount} removal candidates exceed the per-run cap of ${perRunCap} — bailing without deleting anything. Investigate before raising STORAGE_SWEEP_MAX_DELETIONS.`,
    );
    return json({ status: "bailed", reason: "per-run-cap-exceeded", ...summary }, 200);
  }

  // Audit trail — one line per orphan, whether or not we delete it.
  for (const r of plan.removals) {
    console.info(`[storage-sweep] orphan[${r.reason}] ${r.bucket}/${r.path}`);
  }

  // --- Dry-run (default) -----------------------------------------------
  if (!deleteEnabled) {
    return json(
      { status: "dry-run", note: "STORAGE_SWEEP_DELETE_ENABLED is not 'true'; logged plan only.", ...summary },
      200,
    );
  }

  // --- Execute removals, batched per bucket ----------------------------
  const byBucket = new Map<SweepBucket, string[]>();
  for (const r of plan.removals) {
    const list = byBucket.get(r.bucket) ?? [];
    list.push(r.path);
    byBucket.set(r.bucket, list);
  }

  let removed = 0;
  const failures: { bucket: SweepBucket; error: string }[] = [];
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.error(`[storage-sweep] remove failed for ${bucket}:`, error.message);
      failures.push({ bucket, error: error.message });
    } else {
      removed += paths.length;
      console.info(`[storage-sweep] removed ${paths.length} object(s) from ${bucket}`);
    }
  }

  return json({ status: "swept", removed, failures, ...summary }, 200);
}
