# Storage reconciliation

How Hearth keeps Supabase Storage from leaking orphaned objects: the scheduled sweep that reconciles each private bucket against its owning rows and removes objects whose row no longer exists (or never did).

Read this spoke when working on the storage sweep, a storage-backed delete path, the first/only cron in the repo, or anything that uploads to a private bucket and relies on a row to "own" the bytes.

---

## The problem it solves

Every storage-backed delete path in Hearth makes the same trade-off: delete the owning **row authoritatively**, remove the **bytes best-effort**, and let a transient storage failure fall through to "a future periodic sweep." `cleanupDocumentAction`, `deleteInventoryItemAction`, `deleteHouseAction`, and `deleteEmergencyVideoAction` all take this shape — the row is the source of truth, the bytes are cleaned up on a best effort, and a hiccup never blocks the delete.

That trade-off is only honest if the sweep exists. This spoke is the sweep. It also covers a second leak the delete paths can't: the **upload-then-insert window**, where a client writes an object to a bucket but the row INSERT never lands (hard tab close, crash, mobile-Safari tab kill, the client `useEffect` cleanup that never runs). No delete path is involved there — the row simply never existed — so only a reconciliation pass against the live row set can catch it.

This is the storage analog of the habitat orchestrator's terminal-error philosophy: make the deterministic leak self-heal rather than trusting every call site to be perfect forever.

## Buckets and ownership chains

| Bucket | Path layout | Owning row | Sweep descent |
|---|---|---|---|
| `hearth-documents` | `{house_id}/{document_id}/...` | `hearth.documents` (id = `{document_id}`) | 2 (house → doc) |
| `hearth-emergency-videos` | `{house_id}/{document_id}/...` | `hearth.documents` (`kind='emergency_procedure_video'`) | 2 (house → doc) |
| `house-photos` | `{house_id}/photo` | `hearth.houses` (id = `{house_id}`), `user_image_url` non-null | 1 (house → leaf) |

`house-images` (the vestigial generated-image bucket) is **out of scope** — nothing reads or writes it, and its removal is a separate planned drop migration. The sweep does not touch it.

Bucket-name constants live in [`lib/documents/paths.ts`](../../lib/documents/paths.ts) (`HEARTH_DOCUMENTS_BUCKET`, `HEARTH_EMERGENCY_VIDEOS_BUCKET`, `HOUSE_PHOTOS_BUCKET`, `USER_PHOTO_FILENAME`) — the one place every cleanup/reconciliation path imports them from.

## Two-layer design

The work is split so the get-it-wrong-and-you-delete-a-real-photo decision is pure and unit-tested, and the bytes-touching I/O is a thin shell.

- **[`lib/storage/reconcile.ts`](../../lib/storage/reconcile.ts)** — `planStorageRemovals(input)`, the pure orphan-detection diff. No Supabase, no clock; the route hands it the object listing, the row id sets, and `nowMs`, and it returns the remove plan. Covered by [`reconcile.test.ts`](../../lib/storage/reconcile.test.ts).
- **[`app/api/cron/storage-sweep/route.ts`](../../app/api/cron/storage-sweep/route.ts)** — the protected cron handler. Auth, storage listing, row reads, logging, and the actual `.remove()` calls. Keeps the destructive surface area small and unbranched.

### Three orphan classes

`planStorageRemovals` classifies each leaf object (house-id absence is checked first, so a deleted house is caught wholesale regardless of what's underneath):

1. **house-directory** — a `{house_id}/` folder (in *any* bucket) whose house has no `hearth.houses` row. Catches the deleted-house case entirely; this is what `deleteHouseAction`'s best-effort sweeps fall back on.
2. **document** — a `{house_id}/{document_id}/...` object in a document bucket whose `{document_id}` has no `hearth.documents` row. Covers both best-effort delete failures and the upload-then-insert window.
3. **house-photo** — a `house-photos/{house_id}/photo` object whose house row still exists but no longer points at a photo (`user_image_url IS NULL`).

## Safety rails (load-bearing — this job deletes bytes with RLS bypassed)

The sweep uses the **service-role client** (`createServiceClient()`), which bypasses RLS so it can see every owner's rows and objects. That power is fenced by four rails:

- **Rows first, objects second.** The route snapshots the owning rows before listing storage, so a house/document created in the gap has only brand-new objects — which the age guard then protects. Ordering + guard together close the TOCTOU window.
- **Age guard.** An object is only ever a removal candidate once it's older than the grace window (`STORAGE_SWEEP_GRACE_HOURS`, default 24h). A legitimately-orphaned object is still orphaned tomorrow; a just-uploaded one whose row INSERT is still in flight is protected. Missing or unparseable timestamps are treated as too-new and protected — the sweep never deletes bytes it can't prove are old. The guard applies at the leaf-object level, which is where storage exposes `created_at`/`updated_at` (folder prefixes come back without metadata) and where removal happens anyway.
- **Dry-run by default.** Destructive removal is gated behind `STORAGE_SWEEP_DELETE_ENABLED` (default `false`). Until it's flipped to `"true"`, the route lists, diffs, and logs the full remove plan but deletes nothing. This is the single most important rail — it's flipped live only after a logged dry-run plan has been reviewed against real data and confirmed to flag only true orphans.
- **Per-run cap.** If a run's post-age-guard removal count exceeds `STORAGE_SWEEP_MAX_DELETIONS` (default 100), the pure diff empties the plan and sets `capExceeded`; the route logs the would-be count and bails without deleting. A logic regression can't nuke a bucket in one pass.

Every orphan is logged (bucket, path, reason class) at info level whether or not it's deleted, so there's an audit trail in either mode.

## Scheduling and auth

The first cron in the repo, so the scaffolding is net-new:

- **[`vercel.json`](../../vercel.json)** declares the cron: `/api/cron/storage-sweep` daily at `0 4 * * *` (04:00 UTC — low traffic, after any backfill churn). Daily is generous at beta scale; cadence is tunable without code changes.
- **Vercel Cron sends no session cookie.** The proxy (`lib/supabase/proxy.ts`) therefore allowlists `/api/cron/*` as a public route — otherwise the auth gate would 307 the cron to `/login` and the handler would never run. The handler is the real gate: it requires `Authorization: Bearer ${CRON_SECRET}` (the header Vercel attaches when `CRON_SECRET` is set on the project), returning 500 if the secret is unconfigured and 401 on any wrong/absent header. See the route-protection note in [data-and-auth.md](data-and-auth.md#route-protection-proxyts--libsupabaseproxyts).

## Environment variables

Documented in [`.env.example`](../../.env.example):

| Var | Default | Role |
|---|---|---|
| `CRON_SECRET` | — (required) | Bearer token the handler gates on. Missing → 500; mismatch → 401. |
| `STORAGE_SWEEP_DELETE_ENABLED` | `false` | Master switch. Anything other than `"true"` = dry-run (log plan, delete nothing). |
| `STORAGE_SWEEP_GRACE_HOURS` | `24` | Objects younger than this are never removed. |
| `STORAGE_SWEEP_MAX_DELETIONS` | `100` | Per-run cap; above it the run logs-and-bails. |
