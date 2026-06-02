# Ingestion

How user-captured content enters Hearth: the documents table and its two storage buckets (`hearth-documents` for photos and PDFs, `hearth-emergency-videos` for emergency-procedure videos), the server actions and Grok 4.3 pipelines that classify and extract from those uploads, the reasoning-model serial-decode pipeline that runs alongside Research, and the Smart Uploader modal that is the user-facing trigger for all of it.

Read this spoke when working on document capture, photo / receipt / video ingestion, the AI extraction pipelines, or the model that gates what `storage_bucket` a row lives on.

---

## Documents and the `hearth-documents` bucket

`hearth.documents` is the table-of-record for every user-captured asset attached to a house. Photos, PDFs, and compressed videos all live as rows in this one table; the binary content sits in one of two storage buckets — `hearth-documents` for photos and PDFs, `hearth-emergency-videos` for the dedicated emergency-procedure-video corpus. The `storage_bucket` column on each row records which bucket the row's paths resolve against, so future bucket migrations only flip that column rather than rewriting every `storage_path`. Together they back the Smart Uploader and any future Documents UI.

The bucket is **private** — `public = false` on `storage.buckets`. There is no permanent URL for an object; the Smart Uploader and future Documents UI derive a signed URL at render time, same pattern as `house-images` and `house-photos`.

### Storage path layout

Objects within the bucket follow:

```
{house_id}/{document_id}/optimized.jpg        -- page 1: 1920px JPEG
{house_id}/{document_id}/thumb.jpg            -- page 1: 600px thumbnail
{house_id}/{document_id}/page-{N}-optimized.jpg -- pages 2+: 1920px JPEG (issue #117)
{house_id}/{document_id}/page-{N}-thumb.jpg     -- pages 2+: 600px thumbnail
```

The `{document_id}` directory makes cleanup-on-retake trivial — one `.list()` + `.remove()` against the directory wipes every file for the doc regardless of how many pages it has. The first path segment is the `{house_id}` uuid, which is what storage RLS keys on. The path-builder helpers (`pageOptimizedObjectPath` / `pageThumbnailObjectPath`) reject `pageNumber < 2` so callers can't accidentally collide a page row with the parent's storage_path.

**Directory-sweep cleanup is the standard for "remove the whole document".** Every server-side delete path that removes a document's bytes lists the `documentDirectoryPath` and removes everything inside, rather than enumerating the known `optimized.jpg` / `thumb.jpg` filenames. Filename enumeration silently orphaned the `page-{N}-*.jpg` images of multi-page receipts; the directory sweep is page-count-agnostic. `cleanupDocumentAction` (retake/cancel), `deleteInventoryItemAction` (cascade delete of an item's documents), and `deleteHouseAction` (property delete) all share this pattern (#264 brought the latter two in line). The page *rows* in `hearth.document_pages` are cleaned by their `document_id` FK's `ON DELETE CASCADE` when the parent `hearth.documents` row is deleted; the directory sweep handles the *bytes*, which storage doesn't tie to the DB rows. All three keep storage removal best-effort — a transient storage failure never blocks the authoritative row delete, and orphaned bytes are deferred to a future periodic sweep.

Future PDF documents will store the PDF at `optimized` and a page-1 raster at `thumb`, with the per-page rasters reusing the `page-{N}-*` shape. The two-path-per-page shape stays constant across photo and PDF kinds. Emergency-procedure videos use a different path layout in a separate bucket — see "Emergency procedure videos" below.

### Storage RLS

Four policies on `storage.objects` scoped to `bucket_id = 'hearth-documents'` — `SELECT`, `INSERT`, `UPDATE` (covers `upsert: true`), and `DELETE`. All four check that the first path segment cast to uuid matches a `hearth.houses` row the user owns, via the same `storage.foldername(name)[1]` → `houses.id::text` → `houses.owner_id = auth.uid()` join used by the `house-photos` policies. This is the **same ownership chain as the row-level RLS on `hearth.documents`** — a user can never write a storage object whose path their `hearth.documents` row could not also legally reference.

### No originals — deliberate trade-off

The bucket holds the 1920px display version and the 600px thumb. The user's original uncompressed bytes are read by the browser's Canvas (to produce the resized versions and to compute a SHA-256 `content_hash` for dedup) and then discarded. They are not uploaded and not retained anywhere.

The trade-off this implies is precise: **byte-identical re-uploads of the same source still collide** (the hash is computed on the same bytes, the dedup index still fires), but **re-compressed copies of the same photo via different transport apps do not** — iMessage's re-encoder, WhatsApp's re-encoder, and a direct camera-roll selection all produce different bytes for the same scene, so all three would land as distinct documents. Perceptual hashing (which would catch all three) is intentionally out of scope: it adds non-trivial code, runs slower, and we'd rather keep the dedup story simple than chase the long tail. If a future product surface (e.g. "you've already photographed this nameplate from another angle") wants visual similarity, that becomes its own focused project.

### Client-side library (`lib/documents/`)

The Smart Uploader composes four browser-only helpers that live in `lib/documents/`. They are pure(ish) — no React, no server actions, no UI — so they can be unit-tested in isolation and re-composed by the orchestrating hook.

- **`paths.ts`** — the single source of truth for the bucket name (`HEARTH_DOCUMENTS_BUCKET = "hearth-documents"`), the in-directory filenames (`OPTIMIZED_FILENAME = "optimized.jpg"`, `THUMBNAIL_FILENAME = "thumb.jpg"`), and the three path-builders: `documentDirectoryPath`, `optimizedObjectPath`, `thumbnailObjectPath`. Every server-side cleanup or signed-URL helper that lands in later phases imports from here rather than re-deriving paths. The builders throw on empty `houseId` or `documentId` to catch upstream bugs that pass falsy values.
- **`content-hash.ts`** — `computeContentHash(file: File | Blob)` returns the SHA-256 hex digest via `crypto.subtle.digest`. Always called on the user's *original* file bytes, before any Canvas resize — that's what makes the `(house_id, content_hash)` partial unique index on `hearth.documents` work for dedup.
- **`process-image.ts`** — `processImage(file)` produces `{ optimized, thumbnail }` via Canvas. The optimized output is 1920px max on the longest side at JPEG quality 0.88; the thumbnail is 600px max at 0.82 (constants exported as `OPTIMIZED_MAX_DIMENSION` etc.). The two resizes run in parallel. The function never upscales — a source smaller than the target dimension is encoded at its native size. The object URL created for the source `File` is revoked in a `finally` block so the underlying bytes don't hang around after the function returns.
- **`upload.ts`** — `uploadDocumentFiles({ supabase, houseId, documentId, optimized, thumbnail })` uploads both files to the `hearth-documents` bucket in parallel with `upsert: false` and `cacheControl: "31536000, immutable"`. On partial failure it best-effort-removes whichever upload succeeded so the bucket never accumulates orphaned bytes from a half-completed Smart Uploader flow, then re-throws the original error. Takes a browser Supabase client; storage RLS does the actual ownership enforcement. `uploadDocumentPageFiles` is the sibling for pages 2+ of multi-page receipts — same contract, different path layout (`page-{N}-optimized.jpg` / `page-{N}-thumb.jpg`).

These helpers don't insert the `hearth.documents` row — that's a server action handled separately so the row insert can be a single atomic write with the storage paths already known. The `{document_id}` segment is generated client-side via `crypto.randomUUID()` before any storage round-trip, which is what makes the upload-then-insert ordering possible; the same UUID becomes the row's primary key. The trade-off is that an upload can succeed without a row existing — the Smart Uploader's `useEffect` cleanup handles "user closed the modal mid-flow", and a periodic sweep of orphaned bytes is deferred to a later phase.

---

## Emergency procedure videos and the `hearth-emergency-videos` bucket

Emergency-procedure videos are the originating product thesis — a 20-second clip of past-you pointing at the water shutoff is dramatically more useful than text instructions at 2am with wet hands. The data model lives alongside photos in `hearth.documents` (so the table-of-record story stays single-tracked) but the binary content sits in a dedicated `hearth-emergency-videos` bucket and the per-row metadata splits along separate columns. Issue #139 ships the foundation; the Smart Uploader stages, dashboard panel, and custom player follow in the UX layer.

### Why a separate bucket

`hearth-emergency-videos` is a separate `storage.buckets` row from `hearth-documents` even though row-level metadata stays in the same `hearth.documents` table. The two corpora have different lifecycle expectations — videos are larger, fewer, and may pick up retention / migration policies (cold storage, regional pinning, format migration) that we'd never apply to the photo corpus. Splitting at the bucket boundary lets those policies diverge without partitioning the row table. The RLS chain is identical to `hearth-documents` — four policies on `storage.objects` keyed on `(storage.foldername(name))[1]` matching a `hearth.houses` row the user owns.

### Path layout

```
{house_id}/{document_id}/video.webm      -- compressed video, Chrome/Firefox/Edge
{house_id}/{document_id}/video.mp4       -- compressed video, Safari fallback
{house_id}/{document_id}/poster.jpg      -- extracted poster frame (1s mark)
```

`{document_id}` is generated client-side before any storage round-trip, same pattern as the photo bucket. The container choice (`webm` vs `mp4`) is decided per-recording by [`pickVideoMimeType`](../../lib/documents/process-video.ts) against `MediaRecorder.isTypeSupported` — only one of the two video files ever exists for a given document. The path builders `emergencyVideoObjectPath` and `emergencyVideoPosterObjectPath` in [`lib/documents/paths.ts`](../../lib/documents/paths.ts) own the construction so the picker doesn't leak into surrounding code.

### Schema additions on `hearth.documents`

Migration `20260526120100_add_emergency_video_columns_to_documents.sql` adds six columns plus four CHECK constraints and one partial index:

- **`duration_seconds integer`** — nullable; populated for video kinds, null on every other kind. Used by the dashboard tile to show clip length without re-reading the file.
- **`emergency_category text`** — nullable; constrained to `'water' | 'gas' | 'electrical' | 'other'`. Tied to `kind` via an iff CHECK: present exactly when `kind = 'emergency_procedure_video'`.
- **`emergency_label text`** — nullable; user-supplied disambiguator. Optional on the three named categories ("Main shutoff in basement", "Outside faucets"), required by the UI when `emergency_category = 'other'` so the row carries a useful name.
- **`emergency_is_primary boolean not null default false`** — the per-category primary/secondary flag. NOT NULL because every emergency-video row has a defined state; CHECK pins it to false on non-emergency rows so the column has meaning only for the kind it applies to.
- **`poster_storage_path text`** — nullable; path within `storage_bucket` to the extracted poster JPEG. Same bucket as the video, different filename.
- **`storage_bucket text not null default 'hearth-documents'`** — forward-looking. Constrained to `'hearth-documents' | 'hearth-emergency-videos'` plus a cross-column CHECK pinning emergency-video rows to the emergency bucket and everything else to `hearth-documents`. Existing rows backfill via the default; new emergency-video rows write the emergency bucket explicitly. A future bucket migration flips this column rather than rewriting every `storage_path`.

The check constraints are the load-bearing piece — they make the row's emergency-vs-non-emergency state internally consistent. A `kind='photo'` row physically cannot carry an `emergency_category`; a `kind='emergency_procedure_video'` row physically cannot omit one. The same applies to bucket placement.

**Index:** `documents_house_emergency_category_idx` is a partial index on `(house_id, kind, emergency_category, emergency_is_primary desc, created_at desc) where kind = 'emergency_procedure_video'`. Covers the dashboard panel's primary read path — "every emergency video for this house, grouped by category, primary first, newest first" — without a sort step or a full-table scan. The partial predicate keeps the index small (only emergency-video rows are indexed).

### Primary/secondary state and the pure rules

A house may have multiple emergency videos per category — the main water shutoff in the basement and the outside-faucet shutoff are different surfaces of "water," both genuinely useful in different situations. The data model handles this with `emergency_is_primary`: one primary per (house, category), zero or more secondaries.

[`lib/documents/emergency-video-rules.ts`](../../lib/documents/emergency-video-rules.ts) holds the pure rules so they can be unit-tested independently of any database round-trip and reused by future surfaces (admin tooling, migrations) without re-derivation:

- **`shouldSaveAsPrimary(existingInCategory)`** — returns true when the category has zero rows. A new save into an empty category becomes primary; a new save into a populated category becomes secondary. The rule doesn't look at the primary flag of the existing rows — even an all-secondary list (a data-integrity bug elsewhere) keeps a new save at secondary, because fixing the missing-primary state is the auto-promote path's job, not the save path's.
- **`pickPromotedSecondaryId(remaining)`** — when the primary is deleted, the most recently created surviving secondary auto-promotes to primary. Tie-breaks on lexically larger id when timestamps collide, so repeated calls are deterministic. Returns null when no secondaries remain (the category is now empty and no promotion is needed).

The "promote to primary" user action on the dashboard runs the same logical operation in the other direction — the chosen secondary flips to primary and the previous primary in the same category demotes, in a single transaction. That logic lives in a server action (UX-PR scope) but the rule is symmetric: at any moment, at most one row per (house, category) carries `emergency_is_primary = true`.

### Compression pipeline (`lib/documents/process-video.ts`)

The capture flow runs entirely in the user's browser. The pipeline is structured so the pure helpers are unit-testable in isolation; the orchestrating `processVideo(file)` is browser-only and gets exercised via manual testing in the Smart Uploader.

**Targets:** 1280px max longest side preserving aspect ratio (never upscaling); ~2 Mbps video bitrate; 96 kbps audio bitrate. Poster JPEG at quality 0.85, max dimension 1280px, sampled at the 1.0s mark for normal clips or 50% of duration for clips under 2 seconds (so a 1.5s clip doesn't sample frame-from-the-end).

**Codec priority:** VP9/Opus in WebM → VP8/Opus in WebM → H.264/AAC in MP4 → bare WebM → bare MP4. The first MIME from `VIDEO_MIME_PRIORITY` that `MediaRecorder.isTypeSupported` returns true for wins. Chrome/Firefox/Edge land on VP9; Safari lands on H.264 MP4; everything else falls through to whatever generic container the browser advertises. `pickVideoMimeType` is pure — it takes the predicate as an argument so tests can stub `isTypeSupported` without touching globals.

**Validators:** Two pure functions — `validateVideoSize(sizeBytes)` enforces the 200 MB raw-input cap and `validateVideoDuration(durationSeconds)` enforces the 2-minute cap. Both accept the boundary exactly (200 MB and 2:00 pass) and reject anything strictly over. Size is checked before any object URL is created so the browser doesn't allocate against a multi-gigabyte upload; duration is checked after the `loadedmetadata` event since it can't be known synchronously.

**The orchestration** in `processVideo` chains:
1. Size validation against the raw file.
2. MIME pick — if nothing in the priority list is supported, throw `ProcessVideoError("unsupported_codec", …)` and let the caller fall back to file-upload-only.
3. Load source into a hidden `<video>` element, await `loadedmetadata`, validate duration.
4. Compute target dimensions via `computeTargetDimensions` (rounds to even integers for codec friendliness — VP9 and H.264 both prefer even dimensions).
5. Build a `MediaStream` combining `canvas.captureStream()` (downscaled video frames pumped via `requestVideoFrameCallback` or `requestAnimationFrame`) with the source's audio tracks via `video.captureStream()`.
6. Start a `MediaRecorder` at the bitrate targets; play the source through; stop on `ended`.
7. Sample the poster frame at the computed timestamp into a JPEG Blob via `canvas.toBlob`.

The object URL on the source file is revoked in a `finally` block. The video element is detached (`removeAttribute("src")` + `load()`) so the source bytes don't hang around.

**Error surface:** `ProcessVideoError.reason` is one of `'too_large' | 'too_long' | 'unsupported_codec' | 'decode_failed' | 'no_capture_stream' | 'recorder_failed'`. The Smart Uploader maps each to a user-readable copy block and offers the upload-existing path as a fallback for the codec / capture-stream branches.

### What lives where

- **Migration files** — `supabase/migrations/20260526120000_create_emergency_videos_bucket.sql` (bucket + RLS) and `20260526120100_add_emergency_video_columns_to_documents.sql` (columns + checks + index).
- **Paths and bucket constants** — `lib/documents/paths.ts` exports `HEARTH_EMERGENCY_VIDEOS_BUCKET`, `EMERGENCY_VIDEO_WEBM_FILENAME`, `EMERGENCY_VIDEO_MP4_FILENAME`, `EMERGENCY_VIDEO_POSTER_FILENAME`, plus `emergencyVideoObjectPath` and `emergencyVideoPosterObjectPath` builders.
- **Pure logic** — `lib/documents/process-video.ts` (compression pipeline + validators + codec priority) and `lib/documents/emergency-video-rules.ts` (primary-flag + auto-promote rules). Both have sibling `*.test.ts` files covering the documented contract.
- **Row type** — `types/document.ts` extends `DocumentRow` with the six new columns plus the `EmergencyCategory` and `DocumentStorageBucket` unions. Same hand-typed-until-`supabase gen types`-replaces-it pattern as the rest of the type file.

### Smart Uploader flow

The emergency-video path of the Smart Uploader is a five-stage state machine that lives alongside the photo and receipt paths in [SmartUploader.tsx](../../components/smart-uploader/SmartUploader.tsx). Discovery-mode entry is the path-picker's "Emergency procedure video" option (red-toned chip to signal the emergency surface); pre-routed entry is the dashboard panel's "Add a {category} video" affordance, which passes an `initialEmergencyCategory` prop that bypasses both the path picker and the category stage and lands on the label stage with the category pinned.

Stages in order:

1. **Category** ([EmergencyCategoryStage.tsx](../../components/smart-uploader/stages/EmergencyCategoryStage.tsx)) — a 2×2 grid of icon-dominant cards (Water / Gas / Electrical / Other). Tapping advances to the label stage. Skipped when `initialEmergencyCategory` is set.
2. **Label** ([EmergencyLabelStage.tsx](../../components/smart-uploader/stages/EmergencyLabelStage.tsx)) — optional name field for the three named categories ("Main shutoff in basement", "Outside faucets"); required for `'other'`. Pre-fills from prior navigation so a user retaking doesn't re-type.
3. **Capture** ([EmergencyCaptureStage.tsx](../../components/smart-uploader/stages/EmergencyCaptureStage.tsx)) — two parallel affordances: "Record now" calls `getUserMedia({ video: { facingMode: 'environment' }, audio: true })` and runs a `MediaRecorder` against the live stream until the user taps Stop (or the 2-minute auto-cap fires); "Upload existing video" opens a `video/*` file picker. Either path resolves to a `File` and advances to compression. Camera permission denial surfaces the upload fallback inline.
4. **Compress** ([EmergencyCompressStage.tsx](../../components/smart-uploader/stages/EmergencyCompressStage.tsx)) — spinner while the orchestrating hook runs `processVideo`. On `ProcessVideoError` the stage renders the error message and offers Retake / Cancel; the upstream stages are still intact in component state so Retake just clears the result and bounces back to capture.
5. **Review** ([EmergencyReviewStage.tsx](../../components/smart-uploader/stages/EmergencyReviewStage.tsx)) — embedded `<VideoPlayer>` with the just-compressed Blob and poster, optional multi-line notes (soft warning at 2000 chars), and Save / Retake / Cancel. Save invokes the orchestrating hook's `save()`, which uploads + inserts the row in the same call.

The orchestrating hook is [use-emergency-video-upload.ts](../../components/smart-uploader/hooks/use-emergency-video-upload.ts). Phases: `idle → compressing → compressed → saving → done`, with `error` reachable from compressing or saving. The hook owns the in-memory blob URLs for the preview, revoking them in its `reset()` so a closed-mid-flow uploader doesn't leak bytes. Unlike the photo / receipt flows there is no `hearth.documents` row written until the final save step — emergency videos skip the early-INSERT pattern because there's no AI analyze step that benefits from it, and the up-front row would have to carry storage paths before the compression even finishes.

### Dashboard Emergency reference panel

The panel at [emergency-reference-panel.tsx](../../app/(app)/dashboard/emergency-reference-panel.tsx) replaces the hardcoded `EMERGENCIES` placeholder grid above habitat on the dashboard. Server component pattern: it fetches every `kind='emergency_procedure_video'` row for the active house in one query (sorted by `emergency_is_primary desc, created_at desc`, which is exactly what the partial index covers), groups them in memory by `emergency_category`, and hands the result to the [client panel](../../app/(app)/dashboard/emergency-reference-panel.client.tsx) which renders four category rows in the fixed Water / Gas / Electrical / Other order.

Per-category rendering:

- **Empty category** — a thin dashed-border affordance row with the category icon at left and "Add a {label} video" text. Tapping mounts a SmartUploader instance pre-routed to that category.
- **Populated category** — a primary tile in 16:10 aspect with the category icon as a full-bleed background, label and duration overlaid in the bottom scrim, plus a 52×52 white play affordance circle in the bottom-right. The icon-as-background treatment is deliberate per Todd's direction in issue #139: "make these images stand out so it's absolutely clear the user is seeing the emergency water icon." Secondary videos in the same category surface as a "+N more {label} videos" pill below the primary tile, which opens the modal with the primary playing first and a strip of all videos in the category.

The panel mounts its own SmartUploader and EmergencyVideoModal instances; top-nav's existing SmartUploader for the general "+ Add" entry stays untouched. Two simultaneous SmartUploader instances are fine because they're conditionally mounted and only one can be open at a time given the modal's scroll-lock.

### Custom video player

[video-player.tsx](../../components/video-player.tsx) is the gloves-friendly player shared between the Smart Uploader's review stage and the dashboard modal. Deliberately not `<video controls>` — the browser-default control bar offers volume / playback speed / forward / rewind / picture-in-picture, none of which serve the "2am with wet hands" reality. The custom controls are:

- Centre play/pause overlay button (88×88, fades during playback with `prefers-reduced-motion` honored).
- Full-width scrubber row (32pt minimum height) with native `<input type="range">` and `accent-color: white` for the thumb.
- Time display (current / total) in monospace tabular numerals.
- Fullscreen toggle (44×44 with a 20px maximize/minimize icon).
- Tap anywhere on the video surface toggles play.

No volume control, no rewind/forward, no playback-speed selector — by design. Controls auto-hide after 3 seconds of inactivity during playback and stay visible while paused. iOS Safari's `playsInline` is set so fullscreen on iPhone honors the system fullscreen pill.

### Server actions

Four actions under `app/actions/documents/`, all `"use server"` and returning the project's standard `{ data, error: null } | { data: null, error: string }` shape:

- **`saveEmergencyVideoAction`** ([save-emergency-video.ts](../../app/actions/documents/save-emergency-video.ts)) — final save. The Smart Uploader's hook has already uploaded the video + poster Blobs to the `hearth-emergency-videos` bucket. This action runs a head-count of existing rows in the same `(house_id, emergency_category)` to decide the primary flag (mirroring `shouldSaveAsPrimary`), inserts the row with `status='attached'` (no AI step → no analyzing phase), and calls `revalidatePath('/dashboard')` so the panel reflects the new video without a navigation. The cross-column CHECK constraints on the schema enforce that emergency-video rows write `storage_bucket='hearth-emergency-videos'` and carry a non-null `emergency_category` — this action sets both correctly, but a future writer that drifts will be caught at INSERT time rather than producing inconsistent rows.
- **`promoteEmergencyVideoAction`** ([promote-emergency-video.ts](../../app/actions/documents/promote-emergency-video.ts)) — promotes a secondary to primary. Two sequential UPDATEs (demote current primary by `(house_id, kind, category, is_primary=true)`; promote target by id), wrapped with defensive checks (target exists, is an emergency video, has a category). Already-primary input is a no-op success so callers don't need to special-case re-tap.
- **`updateEmergencyVideoAction`** ([update-emergency-video.ts](../../app/actions/documents/update-emergency-video.ts)) — edits label and/or notes. Server-side enforces the "label required when category is 'other'" rule before the UPDATE.
- **`deleteEmergencyVideoAction`** ([delete-emergency-video.ts](../../app/actions/documents/delete-emergency-video.ts)) — same best-effort-storage / authoritative-row pattern as `cleanupDocumentAction`. After the row delete, if the deleted row was the primary in its category, the action runs `pickPromotedSecondaryId` against the remaining rows and UPDATEs the winner to `emergency_is_primary=true`. The pure logic lives in [emergency-video-rules.ts](../../lib/documents/emergency-video-rules.ts); the action just translates the survivor list into a single UPDATE.

All four call `revalidatePath('/dashboard')` so dashboard surfaces (the panel and the SuggestedNext implicit-completion timestamp once that lands as a follow-up) re-render with the new state.

### Signed URL caching

The dashboard tiles use the static `/public/document_icons/*.jpg` images for the icon-as-background treatment — those are public assets, no signing needed. The video and poster bytes live in the private `hearth-emergency-videos` bucket and are accessed via [createCachedSignedUrl](../../lib/house-image/signed-url.ts), the same helper the photo flows use. The bucket was added to the helper's `CachedSignedUrlBucket` union so emergency video URLs participate in the existing sessionStorage caching layer.

---

## Server actions and the Grok analyze pipeline

The Smart Uploader's server-side surface is seven `"use server"` actions under `app/actions/documents/` plus the Grok 4.3 vision wrappers in `lib/documents/ai/`. The modal in phase 1.4 is the orchestrator — every action below is callable in isolation and returns the project's standard `{ data, error }` shape. None of them bypass RLS via the service-role client; ownership enforcement is the load-bearing job of `hearth.documents` and `hearth.inventory` policies, both of which delegate through `hearth.houses.owner_id = auth.uid()`.

The row type for `hearth.documents` is hand-typed in [types/document.ts](../../types/document.ts) (`DocumentRow`, plus the `DocumentKind` / `DocumentStatus` unions and the `AiExtraction` discriminated union used for the `ai_extraction` jsonb column). Same pattern as `types/house.ts` — kept in sync with the migration until `supabase gen types typescript` replaces it.

### The server actions

All under `app/actions/documents/`, all use `createClient` from [lib/supabase/server.ts](../../lib/supabase/server.ts), all return `Promise<{ data, error: null } | { data: null, error: string }>`.

Shared with the photo and receipt flows:

- **`checkDocumentDuplicateAction`** — looks up an existing `hearth.documents` row in the given house by SHA-256 `content_hash`. Used by the Smart Uploader before insert so a byte-identical re-upload jumps to the existing-row branch instead of tripping the partial unique index. Returns `{ exists: false, existingDocument: null }` or `{ exists: true, existingDocument: <row> }`.
- **`createPendingDocumentAction`** — inserts a `hearth.documents` row with `status='analyzing'`. The storage uploads have already completed by this point; the action takes the pre-allocated client-side UUID and the storage paths and writes the row. `uploaded_by` is set from `supabase.auth.getUser()`. An optional `inventoryId` parameter pre-attaches the document for the "open Smart Uploader from inventory detail" entry point.
- **`attachDocumentToInventoryAction`** — attaches a document to an *existing* inventory row, optionally merging accepted AI-extracted fields (`acceptedFields`) into that inventory row first. The merge runs before the document UPDATE so a merge failure leaves the document in its prior state — the user can retry rather than ending up with an attached document whose inventory row doesn't reflect their accepted edits.
- **`cleanupDocumentAction`** — used by the modal's retake / cancel paths. Lists the document's storage directory and removes every object in one sweep (handles both single-page documents and multi-page receipts without the caller needing to know which) followed by an authoritative `DELETE` of the row. The `hearth.document_pages` rows fall out via `ON DELETE CASCADE`. A failed storage removal does not block the row delete; orphaned bytes are deferred to a future periodic sweep.

Photo flow only:

- **`analyzeNameplateAction`** — the photo flow's analyzer. Loads the row, mints a 5-minute signed URL against the `hearth-documents` bucket via `createSignedUrl()`, calls either `classifyImage` (when no `existingInventoryData`) or `deltaImage` (when present), normalizes the result into the `AiExtraction` shape, writes back `ai_extraction` / `ai_model` / `ai_confidence` / `analyzed_at` and flips `status` to `analyzed`. On any throw from the Grok call the row flips to `status='failed'` and the action returns the error message.
- **`findMatchingInventoryAction`** — surfaces inventory rows in the house that look like the same physical item as the proposed classification, so the review stage can offer "add this photo to existing X" instead of forcing a duplicate row. Filters by `type` in Postgres (a "Microwave" appliance must never collide with a system row even when names normalize identically), then runs `inventoryNameMatches()` from [`lib/inventory/match-name.ts`](../../lib/inventory/match-name.ts) in-process against the candidate set. The matcher canonicalizes both sides (lowercase, punctuation-strip, whitespace-collapse) and applies a tight whole-string alias map — `microwave oven` → `microwave`, `washer`/`clothes washer` → `washing machine`, `clothes dryer` → `dryer`, `hot water heater` → `water heater`, `fridge` → `refrigerator`, `ac`/`air conditioning` → `air conditioner`, `gas furnace` → `furnace`. The alias map is whole-string only by design: "Pressure Washer" must not collapse to "Washing Machine", and "Dishwasher" must not match "Washer". N per house is small enough that filtering in TypeScript is simpler than fighting Postgres for fuzzy matching, and the alias rules stay testable without a database. The classify prompt pins seven canonical names ("Microwave", "Washing Machine", "Dryer", "Water Heater", "Refrigerator", "Air Conditioner", "Furnace") and tells Grok to use them verbatim — the matcher catches the residual drift when the model paraphrases anyway. New alias pairs land only when we've actually observed Grok returning them (issue #90).
- **`createInventoryFromDocumentAction`** — inserts a new `hearth.inventory` row using the user-confirmed values, then attaches the document to it (`inventory_id` set, `status='attached'`). Two sequential queries rather than a Postgres function — simple enough that a function isn't justified yet. Inventory columns are `manufacturer` / `model_number` / `serial_number` / `installed_on` / `notes` (the schema's actual column names, not the prompt-draft `model` / `serial`).

Receipt flow (issue #117):

- **`addDocumentPageAction`** — inserts a `hearth.document_pages` row for pages 2+ of a multi-page receipt. Page 1 still lives on the parent `hearth.documents` row, written by the existing `createPendingDocumentAction`. Storage uploads happen client-side first via `uploadDocumentPageFiles`; this action is a thin Supabase wrapper around the row insert.
- **`deleteDocumentPageAction`** — removes a single page row plus its two storage objects. Used by the multi-page capture stage when the user deletes a page mid-capture. Same best-effort storage / authoritative row-delete pattern as `cleanupDocumentAction`.
- **`analyzeReceiptAction`** — multi-page receipt analyzer. Loads the parent document, the ordered list of `document_pages` rows, signs every storage path in one `createSignedUrls` batch, hands the ordered URL list to `analyzeReceipt()` in `lib/documents/ai/analyze.ts` for a single `generateObject` call across all pages, persists the structured result into both `ai_extraction` (raw provenance) and `metadata` (application-curated shape), and flips status to `analyzed`. Same `status='failed'` write on AI throws as `analyzeNameplateAction`.
- **`findInventoryByReceiptAction`** — surfaces inventory items in the house whose serial numbers (or model numbers, as a weaker signal) match identifiers the receipt extracted. The pure-logic core is in [`lib/documents/receipt-inventory-match.ts`](../../lib/documents/receipt-inventory-match.ts) (`matchInventoryByReceipt`) so it can be unit-tested against fixture inventory sets; the server action is the Supabase wrapper. Two passes on serials — case-folded exact match wins first, punctuation-normalized match runs only against rows that didn't hit in pass 1 (receipts print VINs with separator characters that the user's nameplate-captured serial often doesn't have). Model-number matches surface as suggestions only, never strong — a model number alone isn't unique. The literal `"unknown"` sentinel from [`lib/inventory/model-number.ts`](../../lib/inventory/model-number.ts) is filtered out to avoid colliding every receipt with every sentinel row. A single serial hit becomes the strong match; multiple serial hits demote to suggestions so the user disambiguates.
- **`saveReceiptAction`** — final save. Attaches the document to the chosen inventory item, flips status from `analyzed` to `attached`, and optionally persists the user's edited notes. Extraction has already written `ai_extraction` / `metadata` in `analyzeReceiptAction`; this action does not rewrite either column.

### Grok 4.3 via the Vercel AI Gateway

[`lib/documents/ai/`](../../lib/documents/ai/) holds the model wiring. Three files:

- **`schema.ts`** — Zod schemas for `generateObject`. `classificationSchema` is a `z.discriminatedUnion("photo_kind", […])` of three branches (`nameplate`, `appliance_photo`, `not_useful`); the discriminator lets the model pick exactly one shape. `deltaSchema` is a `{ deltas: Record<string, { currentValue, proposedValue }>, confidence }` object. `receiptExtractionSchema` (issue #117) is a flat structured shape — vendor / address / phone / date / type / cents / currency / payment method / line items / referenced serials / referenced model numbers / notes / ai_confidence. All three are the contract between Grok and the rest of the system — the AI SDK rejects any model output that doesn't validate, so getting them right is load-bearing.
- **`prompt.ts`** — `buildClassifyPrompt()` returns the static classify-and-extract system prompt; `buildDeltaPrompt({ existingInventoryData })` returns the delta prompt with a JSON-serialized existing-data block appended; `buildReceiptPrompt()` returns the static multi-page receipt extraction prompt. Separated from `analyze.ts` so they're easy to iterate on and easy to unit-test against. The receipt prompt mirrors the nameplate prompt's anti-leak discipline (issue #81) — example values are angle-bracket placeholders rather than literal strings, and the test suite pins "no `Visa ending in 4242`-style literals" and the load-bearing rule lines so a future edit can't silently re-introduce the leak vector.
- **`analyze.ts`** — `classifyImage(input)` and `deltaImage(input)` for the photo pipeline, `analyzeReceipt({ pageUrls })` for the receipt pipeline. All three are thin wrappers around `generateObject({ model, schema, system, messages })` from the `ai` package. The image part of the user message is `{ type: "image", image: new URL(input.imageUrl) }` — the action passes a Supabase storage signed URL rather than loading bytes into the Node process. `analyzeReceipt` sends every page as ordered image parts in a single user message plus a short text instruction so the model treats the document as one logical thing (vendor on page 1, total on the final page, line items spanning) rather than per-page extractions that would need a downstream merge. Throws on missing `NAMEPLATE_PRIMARY_MODEL`; the calling server action catches and surfaces.

The photo modes correspond to the two ways a homeowner photographs an item. Mode A is "I don't know if you've seen this before, look at it fresh" — three `photo_kind` outcomes (`nameplate` with extracted fields, `appliance_photo` with classification only, `not_useful` to prompt a retake). Mode B is "you already know this item, here's another angle" — return only the fields where the photo adds or contradicts. The receipt mode is its own pipeline alongside the two photo modes — distinct prompt, distinct schema, single multi-image call.

### Receipt extraction and inventory matching (#117)

The receipt path lives parallel to the photo path. Pages 1-5 of a real-world printed receipt go in (HVAC tune-up invoice, vehicle service receipt, vet visit, plumber call, parts purchase, contractor invoice); a structured extraction comes out (vendor / date / totals / line items / serials seen on the receipt); a matched inventory item gets the document attached.

**Client-side capture** uses `useReceiptUpload` in [`components/smart-uploader/hooks/use-receipt-upload.ts`](../../components/smart-uploader/hooks/use-receipt-upload.ts) — a sibling to `useDocumentUpload` rather than an overload, because the receipt flow is incremental (the user adds pages one at a time) and tangling the two state machines would be a maintenance tax. Pipeline per added page: hash → resize → upload (parallel optimized + thumb) → row insert. Page 1 creates the `hearth.documents` row via `createPendingDocumentAction` with `kind='receipt'`; pages 2+ insert into `hearth.document_pages` via `addDocumentPageAction`. Per-session content_hash dedup catches a user re-photographing the same page twice. Cap is 5 pages (raised from the issue's 3-page lean to give longer service invoices headroom); the constant is `RECEIPT_MAX_PAGES` in the hook.

**Page-1 cross-document duplicate pre-check (#264).** Before resizing or uploading page 1, the hook runs the same `checkDocumentDuplicateAction({ houseId, contentHash })` the photo path uses. On a hit it transitions to a `duplicate` phase carrying the existing row and short-circuits — no storage write, no row insert. The Smart Uploader mirrors that phase to the shared `DuplicateStage` (parallel to the photo hook's `duplicate` wiring), so a byte-identical re-upload lands on "You've already uploaded this document" instead of surfacing the raw `documents_house_id_content_hash_unique` constraint error the page-1 insert would otherwise trip. This guards **page 1 only** — the parent `hearth.documents` row owns the `content_hash` under the house-scoped unique index. Pages 2+ live in `hearth.document_pages`, whose `content_hash` is used for in-session dedup only and is not under that index, so their path is unchanged. `DuplicateStage`'s copy reads the existing document's `kind` to pick the noun ("photo" for nameplate/photo, "document" otherwise) so it reads naturally for both paths. The target-mode "this document exists but isn't attached — attach it here?" recovery is explicitly deferred; v1 reuses the plain Close short-circuit.

**Finalize** runs `analyzeReceiptAction`, then in non-target mode also runs `findInventoryByReceiptAction` so the review stage can offer strong-match attach. In target mode (opened from an inventory item's "Add document" button) matching is skipped — the inventory item is already known.

**The review stage** ([`components/smart-uploader/stages/ReviewReceiptStage.tsx`](../../components/smart-uploader/stages/ReviewReceiptStage.tsx)) shows: a read-only thumbnail strip of every page; a "what we read" chip cluster of vendor / date / type / total / subtotal / tax / payment method; a read-only line-items list (editing line items is deferred per the issue's "out of scope" call); a chip cluster of identifiers the model found (serials and model numbers); a match banner (strong match → one-tap select, suggestions → buttons, none → manual searchable inventory picker); an editable notes field defaulting to the extracted notes; and a Save button. In target mode the picker collapses to a read-only "Attaching to <item>" banner.

**Confidence threshold for the low-confidence branch** is `RECEIPT_CONFIDENCE_THRESHOLD = 0.5` in the review stage — lower than the nameplate `0.6` because receipts vary more in quality (faded thermal paper, handwriting, glare). Documented contract; if we tighten it server-side we update the constant in lockstep.

**The matcher** in [`lib/documents/receipt-inventory-match.ts`](../../lib/documents/receipt-inventory-match.ts) is pure — the server action is a thin Supabase wrapper. Two passes: case-folded exact match on `inventory.serial_number`, then punctuation-normalized match for rows that didn't hit. Model-number matches surface as suggestions only. The `"unknown"` model_number sentinel is filtered out. A single serial hit becomes the strong match; multiple hits demote to suggestions so the user disambiguates.

**Serial normalization** in [`lib/documents/serial-normalize.ts`](../../lib/documents/serial-normalize.ts) has two passes: `caseFoldSerial` (uppercase + trim, light touch) and `normalizeSerial` (strip whitespace + hyphens + dots + slashes + colons, then uppercase). The character class is whitelisted rather than catch-all-non-alphanumeric so unusual-but-legitimate identifier characters survive. Empty-after-strip becomes null — the matcher can short-circuit before joining everything to everything.

**Receipt metadata** lives in `hearth.documents.metadata` parsed by `receiptMetadataSchema` in [`lib/documents/metadata-schemas.ts`](../../lib/documents/metadata-schemas.ts). Same column-vs-jsonb philosophy as `hearth.inventory.metadata` — a field gets its own column only when a cross-row query pattern earns it; receipt vendor / date / totals all live in jsonb today. The parser uses `safeParse` with an empty-fallback so renderers never crash on schema drift.

**`metadata.expiration_date`** (issue #124) is the renewal-document handle: nullable ISO date populated only when the document represents a time-bounded grant the user will need to renew — vehicle registration, insurance policy, warranty certificate, permit, professional license. Distinct from `transaction_date`: a registration card's `transaction_date` is when the user paid the SOS, but `expiration_date` is when the registration lapses (the date the maintenance module cares about). Service receipts, purchase receipts, and inspection reports leave it null — the prompt's positive/negative examples and "wrong date is worse than a null" framing exist to keep Grok from inventing expirations on those. The field lands silently in `metadata` today; the direct-event maintenance pipeline (follow-on issue) reads it to seed renewal tasks.

**Receipt detail surface** is a lightweight page-flip modal — [`app/(app)/inventory/[id]/receipt-page-flip-modal.tsx`](../../app/(app)/inventory/[id]/receipt-page-flip-modal.tsx). Same `yet-another-react-lightbox` chrome as the photo lightbox, themed to match Hearth's surfaces. Lazy-loads the page-1 `storage_path` plus every `document_pages` row in ascending order, signs each via `createCachedSignedUrl`, and hands the slides to the library. A dedicated `/documents/[id]` route is deferred per the issue's open-question lean — modal first, then revive the route once the documents corpus is large enough to need a browse surface.

**Inventory detail entry points** — the inventory detail page exposes two target-mode triggers: an existing "Add photo" button and the new "Add document" button (issue #117 follow-on request). Both open the Smart Uploader pre-locked to the current inventory item; the new `targetKind: 'photo' | 'receipt'` prop selects the path. Single uploader instance, two trigger refs for focus-return.

### Kind demotion

A row inserted with `kind='nameplate'` can be demoted to `kind='photo'` when the AI classifies the image as `appliance_photo`. The demotion is one-directional: rows inserted as `photo` from the dashboard's generic entry point stay where they are even if the AI judges them to be label shots. The `not_useful` path leaves `kind` untouched — the caller's next move is almost always `cleanupDocumentAction`, so the column's value stops mattering immediately.

### Environment variables

Both read at call time so the model can be swapped without redeploying:

- **`NAMEPLATE_PRIMARY_MODEL`** — required. The model string passed to `generateObject`. Routes through the Vercel AI Gateway; the gateway forwards to xAI using the project's BYOK Grok credentials. Default in development: `xai/grok-4.3`. Missing → `analyzeNameplateAction` returns the configuration error.
- **`NAMEPLATE_CONFIDENCE_THRESHOLD`** — float in `[0, 1]`. The Smart Uploader's review stage shows a low-confidence branch when `ai_confidence < threshold`. Default `0.6`. Consumed server-side in 1.3 only as a documented contract; the modal in 1.4 reads it via the analysis result, so neither value needs `NEXT_PUBLIC_` exposure.

These are populated in `.env.local` via `vercel env pull` and configured in the Vercel dashboard for preview / production environments.

---

## Serial-number decode pipeline

The Research-this-model pipeline (see [inventory-and-reports.md](inventory-and-reports.md)) is intentionally non-reasoning for latency reasons (10-ish seconds first-token to last-token on the fast models). That choice was right for the broad summary work but wrong for the one task where determinism matters: decoding the manufacture date encoded in the serial number. Live testing showed the non-reasoning model would fabricate a plausible-sounding encoding rule per call and apply it confidently to itself, producing different dates for the same Whirlpool serial across consecutive runs (2014 / 2022 / 2022-via-a-different-rule / 2023 — all internally consistent, all wrong). Internal-consistency prompting can't catch the hallucination because the *rule itself* is the hallucinated part.

The fix: lift just the decode work into a separate parallel call on a reasoning model.

**Two calls, one click.** Clicking "Research this item" fires both endpoints in parallel from `inventory-detail-view.tsx`:

1. `POST /api/inventory/[id]/research` — the existing streaming insights call, untouched in latency or model choice.
2. `POST /api/inventory/[id]/decode-serial` — the new reasoning-model call. Not streamed; `generateObject` returns the structured response whole. Longer wall-clock than research, but because the two run in parallel the user only feels the longer of the two.

The user-visible click surface, copy, and gating are unchanged. The research stream populates the panel as it always did; the decode call resolves quietly in the background and either lands a toast or doesn't.

**The decode endpoint** at [`app/api/inventory/[id]/decode-serial/route.ts`](../../app/api/inventory/[id]/decode-serial/route.ts):
- Returns a `{ skipped: "no-serial" }` 200 immediately when `serial_number` is null or whitespace — there is nothing to decode and no reason to burn Gateway credits.
- Returns a 500 with a clear message when `INVENTORY_SERIAL_DECODER_MODEL` is unset. This is an explicit configuration error, not a fallback — there is no default model.
- Loads the inventory row (RLS-scoped, same pattern as research), composes the prompts, calls `generateObject({ model, schema: decodeSerialSchema, system, messages })`, and returns `{ result: <DecodeSerialResult> }` to the client.
- **Persists to `hearth.inventory` only when `confidence === "high"` and `manufacture_date !== null`.** Medium and low confidence decodes are returned to the client (so the route stays useful for surfacing what was attempted) and written to the debug log, but never overwrite the row. A confidently-wrong manufacture date on a user-visible tile is materially worse than no date at all.
- Always appends a debug block to `logs/serial-decode-prompts.log` in the same format as the AI Insights log (timestamp / model / duration / status / input / prompts / response or error). Errors are swallowed in try/catch so a logging failure can never break the user request.

**The `lib/serial-decode/` module** keeps the prompt and schema testable in isolation:
- `prompt.ts` — `buildSerialDecodeSystemPrompt()` and `buildSerialDecodeUserMessage(input)`. The system prompt encodes the strict protocol — name the encoding rule for this manufacturer/era, apply it character-by-character to the actual serial, verify internal consistency, set confidence to high only when all three steps succeed cleanly, otherwise return `manufacture_date: null` with confidence: low and an honest reason. The user message is minimal: manufacturer, model, serial.
- `prompt.test.ts` — covers builder shape, presence of the strict-protocol language (rule citation, character-by-character, internal-consistency check, return-null-when-uncertain), and graceful handling of null manufacturer / null model.
- `schema.ts` — `decodeSerialSchema` is a Zod object with five required fields. `manufacture_date` (string or null), `precision` (enum `year|month|week` or null), `encoding_rule_cited` (string or null), `confidence` (enum `high|medium|low`, required — even low-confidence runs report their reasoning), `reasoning` (string, required — the model's show-your-work). `getSerialDecoderModel()` reads `INVENTORY_SERIAL_DECODER_MODEL`. There is no fallback model — the env var is the only knob.

**Env var:** `INVENTORY_SERIAL_DECODER_MODEL` is required and has no default. It's set in the Vercel dashboard for preview / production and pulled into `.env.local` via `vercel env pull`. The model string routes through the Vercel AI Gateway like every other AI call.

**Tile fallback.** The detail page's first stat tile (`StatTiles` in [`inventory-detail-view.tsx`](../../app/(app)/inventory/[id]/inventory-detail-view.tsx)) used to be just "Installed". After the decode pipeline landed, it picks between three states via [`pickFirstDateTile()`](../../lib/inventory/first-date-tile.ts):
- `installed_on` non-null → eyebrow stays **Installed**, value is the formatted install date (existing behaviour).
- `installed_on` null AND `manufacture_date` non-null with `manufacture_date_confidence === "high"` → eyebrow flips to **Manufactured**, value is the decoded date formatted by precision (`YYYY` → "2014", `YYYY-MM` → "Oct 2014", `YYYY-Www` → the month containing that ISO week's Thursday). The relative-time meta line is suppressed for the manufactured branch — unit age is a different conceptual axis from install age, and mixing them would mislead.
- Otherwise → eyebrow is **Installed**, value is the existing "Unknown" placeholder.

`installed_on` always wins when present. The fallback only fires when the user has no install date for the item. The helper is pure logic and is unit-covered in [`first-date-tile.test.ts`](../../lib/inventory/first-date-tile.test.ts) across all four cases — both-null, installed-only, high-confidence-manufactured, and low/medium-confidence-becomes-unknown (defensive; we never persist those, but the helper defends against a future schema change that decouples confidence from persistence).

**The toast.** When the decode call resolves with `confidence === "high"` and a non-null `manufacture_date`, the client formats the date through the same `formatManufactureDate()` helper the tile uses and surfaces a small one-line toast: *"We decoded your manufacture date: Oct 2014"*. The toast is the minimal Hearth-styled primitive at [`components/toast.tsx`](../../components/toast.tsx) — bottom-centered, surface-raised, accent leading edge, sparkles icon, hover-paused auto-dismiss at 6s with an explicit X. After the toast mounts, `router.refresh()` pulls the new row state into the page so the StatTiles tile flips from Installed/Unknown to Manufactured in the same paint window.

**No retry surface in this issue.** Re-running decode is implicit: clicking "Research this item" again fires both calls again. There is no dedicated decode-only button. A request-id ref on the client guards against a fast double-click producing two toasts — only the most recent call can land one.

**Serial-decode debug log.** Every call appends one block to `logs/serial-decode-prompts.log`, same format and same gitignore as `ai-insights-prompts.log`. The two files are independent so Todd can iterate on the decode prompt without churning the research log and vice versa.

---

## Smart Uploader modal and dashboard wiring

The Smart Uploader is the user-visible composition of phase 1's plumbing — the modal that homeowners actually interact with when they tap **+ Add** in the top nav. It owns the path-picker → capture → process → analyze → review → save flow end-to-end, calls the seven server actions in [app/actions/documents/](../../app/actions/documents/), and writes nothing to storage or to `hearth.documents` that the client-side library helpers and server actions didn't already own.

### Entry point

The top-nav `+ Add` button (`components/top-nav.tsx`) opens the modal in **discovery mode**. The same button is rendered twice — once as a labeled button on `md+` viewports, once as an icon-only button on small viewports — so it survives the mobile breakpoint without a separate mount. Both invocations share state. The button is disabled until the user has a house (`(app)/layout.tsx` passes the house row through `AppShell`); during onboarding the user can't open the uploader because there's no `houseId` to attach to.

The **Add photo** button on `/inventory/[id]` opens the modal in **target mode**: it passes `targetInventoryId={item.id}` and `targetInventoryName={item.name}` so the Smart Uploader knows up front which physical item this photo belongs to. The two modes share the same path-picker → capture → analyze prefix; they diverge after analyze — discovery mode runs matching and lands on a review form, while target mode attaches directly to the known item and lands on the success stage. See the post-processing branches and the `useDocumentUpload` orchestration sections below for the exact fork. The detail-page mount follows the same conditional-mount pattern the edit modal uses — every open is a fresh React mount, so the stage machine and upload hook re-initialize cleanly without a reset-in-effect.

### Component layout

```
components/smart-uploader/
├── SmartUploader.tsx          # modal shell, owns the stage state machine
├── match-room.ts              # pure default-room picker (suggestion → fallback)
├── match-room.test.ts         # Vitest coverage
├── hooks/
│   └── use-document-upload.ts # orchestration of the upload pipeline
└── stages/
    ├── PathPickerStage.tsx    # photo active; document/video greyed "Soon"
    ├── CaptureStage.tsx       # dropzone + file input, preview, retake/analyze
    ├── ProcessingStage.tsx    # spinner with phase-specific status copy
    ├── DuplicateStage.tsx     # short-circuit when content_hash already exists
    ├── ReviewNewStage.tsx     # nameplate / appliance_photo / manual-entry form
    ├── NotUsefulStage.tsx     # AI said the photo doesn't show an appliance
    └── AnalysisFailedStage.tsx # any thrown error → retake or enter manually
```

### Mobile page-sheet shape

Below the `sm` breakpoint (640px) the dialog renders as a **page-sheet**: bottom-anchored, full viewport width, fixed at `95dvh` tall, top corners rounded, bottom flush with the viewport edge, with a small drag handle at the top centre. Above `sm` it stays a centred modal capped at `92dvh` that sizes to its content — the laptop/desktop layout the dialog was originally built for is unchanged.

The fixed-height piece is the load-bearing part of the pattern. The Smart Uploader is multi-step (path-picker → capture → processing → review/duplicate/not-useful/failed → success) and the steps' natural heights vary by hundreds of pixels. Letting the sheet size to content the way a desktop modal does makes the surface visibly jump on every transition, loses the user's spatial reference, and turns the dimmed backdrop above the sheet into a constantly-resizing distraction. `95dvh` reserves a constant 5dvh strip of backdrop at the top across every step — the height of the sheet itself never changes, only what scrolls inside it.

The mechanics:

- **`.page-sheet` utility class** lives in [`app/globals.css`](../../app/globals.css), scoped inside `@media (max-width: 639.98px)`. It sets `height: 95dvh`, `width: 100%`, and `border-radius: var(--radius-lg) var(--radius-lg) 0 0`. The class deliberately sits in the same unlayered space as `.surface-ai` because Tailwind v4 puts its utilities in the `utilities` cascade layer — unlayered CSS outranks layered, so a Tailwind `sm:rounded-t-*` would lose to `.surface-ai`'s shorthand `border-radius` declaration. Keeping the override in raw CSS is the only way the top-rounded shape actually paints.
- **`.surface-ai::before` pseudo-element** uses `border-radius: inherit`, so the accent gradient hugs the same top-rounded shape on mobile with no extra rules.
- **Drag handle** is a 1px × 40px rounded pill rendered above the header, styled in `--color-border-emphasis`. It is `sm:hidden` so desktop never paints it, and it doubles as the start of the dismissal touch target.
- **Swipe-to-dismiss** is implemented inline in `SmartUploader.tsx`: `onTouchStart` / `onTouchMove` / `onTouchEnd` are bound to the drag-handle div *and* the header — not to the scrollable content area below, so vertical content scroll never collides with a dismissal gesture. The handler tracks a single `dragOffset` in component state, applies `transform: translateY(...)` while the gesture is active, snaps back via a 200ms CSS transition on release, and dismisses through the existing `handleClose()` (which keeps the mid-flow cleanup contract intact) when the cumulative downward delta crosses `SWIPE_DISMISS_THRESHOLD_PX` (120). A `matchMedia("(max-width: 639.98px)")` guard in `onDragStart` makes the gesture a no-op on touch-screen laptops where the dialog is the centred desktop modal.
- **Sheet height vs. inner scroll** — the outer dialog is `flex flex-col overflow-hidden` and its content region is `flex-1 overflow-y-auto`, so the sheet's outer dimensions stay locked at 95dvh while the active stage scrolls within whatever space remains under the header. This is the same flex shape the dialog already used; the only change is dropping `max-h-[100dvh]` for a hard `height` so the surface no longer shrinks to fit short stages.

The pattern is the page-sheet half of a deliberate split documented in issue #56: page-sheet for **multi-step / content-heavy** flows (this one; future siblings for documents and emergency-procedure videos when those paths come online), and a smaller fixed-height bottom-sheet for **single-action** prompts (confirms, quick pickers) that hasn't been built yet. New multi-step capture flows should reuse `.page-sheet` plus the same drag-handle + touch-handler shape rather than rolling their own; once a second consumer lands it's worth extracting the shell into a `<PageSheet>` primitive, but two callers is the bar.

### CaptureStage dropzone

The empty state of [`CaptureStage`](../../components/smart-uploader/stages/CaptureStage.tsx) is a bounded drag-and-drop region on desktop and a tap-to-open target on touch — both paths funnel through the same `onPickFile` prop, so the rest of the pipeline never sees which gesture initiated the upload. The container is a plain `div` (clickable, but not focusable) wrapping a single focusable "Choose from your computer" button — no nested-interactive-elements anti-pattern, but tapping anywhere in the dashed region still opens the picker so mobile keeps its one-tap behaviour. Drag handlers `preventDefault` on `dragover`/`drop` (the browser otherwise navigates to the file's local URL), use a `currentTarget.contains(relatedTarget)` check on `dragleave` to keep the active-border highlight from flickering as the cursor moves across child elements, and a window-level `dragend` listener resets state if the user releases outside the modal. Non-image drops are validated against `file.type.startsWith("image/")` before `onPickFile` fires — same gate the dashboard photo upload uses, with the same inline "Please choose an image file." message under the dropzone. Multi-drops are deliberately truncated to `dataTransfer.files[0]` since the Smart Uploader is one-photo-at-a-time.

### Stage state machine

`SmartUploader.tsx` holds a discriminated union over `stage.name` in a single `useState`. Transitions are driven by two sources: user action (advance from path-picker → capture → analyze) and the `useDocumentUpload` hook's published state (the modal `useEffect`-watches `uploadState.phase`/`.duplicate`/`.analysis` and translates them into the corresponding user-facing stage). Keeping the user-facing state machine separate from the pipeline phases lets each evolve independently — the hook can grow new sub-phases (e.g. for video uploads) without churning the modal's branches.

The reachable post-processing branches are:

- **Duplicate** — `checkDocumentDuplicateAction` returned `exists: true`. No new row is created, no storage is uploaded, no cleanup is needed. Same shape in both discovery and target mode.
- **Review-new (nameplate)** — AI classified the photo as a nameplate and extracted manufacturer/model/serial/installed. Discovery mode only.
- **Review-new (appliance_photo)** — AI classified the photo as a generic equipment shot. Same review form, no extracted-fields panel. Discovery mode only.
- **Success** — target mode only. The hook reaches its terminal `attached` phase and the modal renders the existing brief "Saved!" confirmation before auto-dismissing on the same cadence as a discovery-mode save.
- **Not-useful** — AI returned `not_useful`. **Discovery mode only** — target mode skips the analyze stage entirely so this branch is unreachable when `targetInventoryId` is set. Both buttons (Cancel / Try a different photo) call `cleanupDocumentAction` before transitioning.
- **Analysis-failed** — any pipeline step returned an error. Reachable in both modes but for different failures: in discovery mode this includes Grok analyze errors; in target mode it only fires on hash / upload / create-row / attach errors (since analyze never runs). Retake calls cleanup and returns to capture. The secondary button is mode-dependent: in discovery mode it's "Enter manually" (opens a `manual-entry` variant of `ReviewNewStage`); in target mode it's "Save photo anyway" (calls `attachDocumentToInventoryAction` directly so the user keeps the photo even when an earlier step failed).

The low-confidence variant of review-new fires when `ai_confidence < NAMEPLATE_CONFIDENCE_THRESHOLD` (currently `0.6`). The threshold is mirrored as a constant in `ReviewNewStage.tsx` and the technical-guide contract is that the server-side env var and the client-side constant move together — bumping one without the other will silently mis-classify a band of photos.

The "you already have a Furnace" banner is `ReviewNewStage`'s opt-in to the link-to-existing path: when `findMatchingInventoryAction` returns one or more matches, a banner appears above the form with one button per match (capped at 3) that calls `attachDocumentToInventoryAction` and short-circuits the create path entirely. The "Create new" button dismisses the banner and falls through to the regular form. The first call wins — `saving` disables both paths during the round trip.

### `useDocumentUpload` orchestration

`hooks/use-document-upload.ts` is the client-side pipeline. It exposes `start(file)`, `state`, and `reset()`. Subtle ordering inside `start` is load-bearing and worth describing in one place:

1. `crypto.randomUUID()` mints the document id client-side. The same id becomes the row PK *and* the `{documentId}` storage directory segment, which is what makes upload-before-row-insert safe.
2. `phase = "hashing"` — `computeContentHash(file)` runs on the original bytes. This is intentionally before any Canvas resize so the dedup index fires on byte-identical re-uploads even when the user has already tried once.
3. `checkDocumentDuplicateAction` short-circuits the pipeline. The modal's `duplicate` branch renders without ever touching storage.
4. `phase = "uploading"` — `processImage(file)` resizes to optimized + thumbnail; `uploadDocumentFiles(...)` writes both in parallel via the RLS-bound browser client.
5. `phase = "creating-row"` — `createPendingDocumentAction(...)` writes the row with `status='analyzing'`. `kind` is **`'photo'` in target mode** (the user is adding another photo of a known item — by definition not a nameplate, so we skip the analyze-then-demote dance) and `'nameplate'` in discovery mode, where it may be demoted to `'photo'` by the analyze step.
6. **Target-mode short-circuit (load-bearing).** When `targetInventoryId` is set, the pipeline skips analysis entirely: `phase = "attaching"` → `attachDocumentToInventoryAction({ documentId, inventoryId: targetInventoryId })` flips `status: 'attached'` → `phase = "attached"`. The modal jumps directly to the success stage. The user already told us which item this photo belongs to from the entry point on `/inventory/[id]`; running the Grok vision classify call here would burn ~30-45s of latency + Gateway credits for zero user benefit, and would route legitimate non-appliance photos (a car body, a pet) into the "couldn't identify" failure stage. An earlier revision of this code ran analyze first and the route into target-mode attach lived *after* the `not_useful` short-circuit — the Audi-photo bug from issue #23's first round of testing was the result. `acceptedFields` is intentionally omitted on the attach call — a second photo of the same item might contradict existing inventory fields and we don't want a silent overwrite from this entry point.
7. **Discovery mode** (no `targetInventoryId`) continues with the analyze stage: `phase = "analyzing"` — `analyzeNameplateAction(...)` either returns the persisted row (with `ai_extraction` populated and `status='analyzed'`) or sets `status='failed'` and returns an error.
8. After analyze (discovery mode only), the pipeline forks on the classification:
   - **`not_useful`** → `phase = "done"`, modal renders the not-useful stage. No matching.
   - **`delta`** mode (not reachable today; reserved for a future inventory-detail "compare this new photo to the existing record" entry) → `phase = "done"`, no matching.
   - Otherwise → `phase = "matching"` → `findMatchingInventoryAction(...)` looks for existing inventory in the house with a matching name → `phase = "done"`. The modal then moves into duplicate / review-new based on what the hook surfaced.

Any throw lands in the catch and sets `phase = "error"` with the message. A `runningRef` prevents double-fire from React strict-mode effect re-runs or a rapid double-tap on Analyze. The hook owns no cleanup logic — the modal calls `cleanupDocumentAction` directly when the user retakes, cancels, or closes mid-flow, with the document id the hook published in state.

### Save and close paths

Two save paths exist:

- **Create new** — `createInventoryFromDocumentAction(...)` inserts a `hearth.inventory` row and attaches the document. Used by the "Save furnace" button in review-new (including the manual-entry variant).
- **Attach to existing** — `attachDocumentToInventoryAction(...)` attaches the document to an existing inventory row without creating a new one. Two callers today: the discovery-mode match-banner's per-match buttons (user explicitly picked "Add to my Furnace"), and the target-mode hook path (the user came in from the inventory detail, so the target is implicit). Neither path passes `acceptedFields` — the payload stays plumbed for a future "we noticed this photo says serial=X, update the inventory record?" delta-confirm affordance that hasn't shipped yet.

Both fire `onSaved({ inventoryId })`. The modal then drops into the `success` stage for `SUCCESS_DISMISS_MS` (600ms — long enough to read "Saved!" and short enough not to feel like waiting) before calling `onOpenChange(false)`.

Close-mid-flow cleanup: the modal tracks the currently-displayed stage and the current document id in a ref. On close, if the stage is one where a row was created but not attached (`review-new`, `manual-entry`, `not-useful`, `analysis-failed`), it fires `cleanupDocumentAction` so the row and its storage objects don't linger. Duplicate doesn't need cleanup — the row we'd be removing belongs to the previous, legitimate upload. Path-picker / capture / processing close paths don't have a document id yet (or the in-flight upload's id never reached the database before close) — the hook's own `runningRef` and the modal's `reset()` on next open handle the in-memory cleanup, and any orphaned storage bytes from a half-completed upload land in the same future periodic sweep documented elsewhere.

### Refresh on save

`onSaved` calls `router.refresh()` from inside `TopNav` — the same pattern the home-details edit modal uses. `router.refresh()` re-runs server components without a full page reload, which means the dashboard's `InventoryPreview` server component re-queries `hearth.inventory` and the new item appears in the tile list automatically.

The home-details modal *also* dispatches the `HOUSE_UPDATED_EVENT` because `useHouseRealtime` is unreliable in some browsers (see "Cross-tree refresh signal" in the hub's Frontend design system section). Smart Uploader does *not* dispatch a custom event because the dashboard's inventory tiles are server-rendered, not driven by a Realtime hook — a server-component re-render is the only signal the surface listens for, so `router.refresh()` is sufficient.

### Dashboard inventory tiles

`app/(app)/dashboard/inventory-preview.tsx` is the server component that renders the dashboard's inventory tile list. It replaces the dashboard's earlier hardcoded mock APPLIANCES array. Queries `hearth.inventory` filtered by `house_id` with a `PREVIEW_LIMIT` of 6 items in created-date-descending order. The accompanying tile renderer is co-located inline; it's only used here and pulling it into `components/ui.tsx` would be premature.

Hero photos: a follow-up query fetches every `hearth.documents` row with `status='attached'` and `inventory_id IN (...)` ordered by `analyzed_at desc`, then picks the most-recent per inventory id server-side. The thumbnail **path** (not a signed URL) is handed to `<InventoryThumbnail>` (`components/inventory-thumbnail.tsx`), a small client component that resolves the signed URL via `useCachedSignedUrl` against the `hearth-documents` bucket — the same `sessionStorage`-cached URL pattern the house image uses. Caching the URL string is what lets the browser's HTTP cache actually hit the immutable bucket bytes across navigations and reloads; the earlier server-side `createSignedUrls` batch generated a fresh URL on every render and busted the cache. Items with no attached document get a type-based fallback icon (appliance → fridge, system → flame-burner, exterior → home), which also fills the slot for one effect tick while the URL resolves on a cache miss. The component now has two consumers (the dashboard preview and the full inventory list page), so it lives in `components/` rather than co-located with the dashboard preview.

The component handles the empty-inventory case inline with a soft hint pointing the user at the `+ Add` button. Tiles link to `/inventory/[id]`; the dashboard's "See all" trailing link points to the full list page at `/inventory`.

### Home inventory list page (`/inventory`)

`app/(app)/inventory/page.tsx` is the server component for the full inventory surface — every appliance, system, and exterior item the user has captured, grouped by type. It is the destination for the dashboard's "See all" trailing link, the primary navigation entry ("Home inventory" in the desktop sidebar and bottom-nav), and the post-delete redirect from the detail page.

**Data shape.** The page reuses the dashboard preview's query shape so behavior stays predictable across both surfaces: query `hearth.inventory` filtered by `house_id` (no limit), then a follow-up query against `hearth.documents` for each item's most-recent attached photo (`status='attached'`, `kind in ('nameplate', 'photo')`, ordered by `analyzed_at desc nullsLast` then `created_at desc`). The thumbnail path is handed to `<InventoryThumbnail>` — server-side signing is explicitly avoided because a fresh signed URL on every render busts the browser HTTP cache against the immutable `hearth-documents` bytes. The same caching contract documented in "Signed URL caching" applies unchanged.

**Three sections, always rendered.** Items are grouped into Appliances (`type='appliance'`), Systems (`type='system'`), and Exterior (`type='exterior'`) in that order. Each section uses `SectionHeader` for its eyebrow + title and always renders — empty sections show a soft hint pointing the user at the `+ Add` button so the page structure stays discoverable. Within a section, items sort alphabetically by name via `Intl.Collator` with `sensitivity: "base"` so case and accents don't trip the ordering — this differs from the dashboard preview's `created_at desc` because the preview is a "most recently added" surface and the full list is a browse surface where alphabetical is easier to scan.

**Tile design (issue #174).** Photo-as-tile cards modeled on the dashboard's Emergencies `PrimaryTile`. Each card is a 4:3 surface where the user's attached photo fills the entire frame and a bottom gradient scrim carries the overlay text: the room name as an uppercase eyebrow (`KITCHEN`, `BASEMENT`), the item name in white at 18px/500, and the same contextual detail line `buildDetailLine()` produces (`manufacturer · model_number`, `Installed Mar 2018`, or for vehicles the `model_year · license_plate` pair) at 65% white. The scrim uses a slightly stronger top stop than the emergency tile (`#000 82%` vs. `78%`) because inventory carries the sub-line in addition to the title — that small text needs the extra contrast to stay readable against bright photos. Grid is `grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4`: 2-up on phones, 3-up on desktop. The previous row layout (96×96 thumbnail on the left, text stack on the right, one item per row) had the user's photos sitting in a 20% slice of the row — the new layout puts the photos on the canvas they earn. Items without an attached photo fall back to the same radial-gradient wash `PlaceholderImage` uses, plus a centered type icon at size 56, so an empty-state tile still reads as a tile rather than as a row-shaped odd-one-out. Hover/focus stays subtle: 1px accent ring on hover via `box-shadow`, 1px lift via `translateY`, 2px accent outline on `:focus-visible`. Once a maintenance-log table lands, "Last serviced" / "Next due" can layer into the overlay or into a hover-revealed second line — the nullable `last_serviced_on` / `next_service_due_on` columns are not surfaced today because no flow populates them and "Unknown" everywhere would just be noise.

Out of scope for this surface: search, per-type sort toggles, filtering, bulk operations. The list isn't long enough to need them yet.
