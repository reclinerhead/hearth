# Hearth — Technical Guide

A living description of what Hearth is built on and how the pieces fit together. CLAUDE.md describes *how we work*; this document describes *what we've built and why*. Chronology lives in `git log` and GitHub issues — not here.

---

## Stack at a glance

| Layer | Tech |
|---|---|
| Framework | Next.js 16 App Router on Turbopack (React 19, React Compiler enabled) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + design tokens in `app/globals.css` |
| Auth + DB | Supabase (Postgres + GoTrue + RLS + Realtime) |
| Maps / geocoding | Mapbox Address Autofill via `@mapbox/search-js-react` |
| AI | Vercel AI SDK v6 + Vercel AI Gateway (BYOK Anthropic / OpenAI / xAI) |
| Background jobs | Vercel Workflow SDK (`workflow` + `@workflow/ai`) |
| Hosting | Vercel |
| Tests | Vitest (selective coverage on pure logic) |
| Package manager | pnpm |

The repo is a flat layout — `app/`, `lib/`, `components/`, `types/`, `supabase/`, `docs/` at the root. There is no `src/` directory.

---

## Repository layout

```
app/                       # Next.js App Router
  (app)/                   # Authenticated app group, wrapped in AppShell
    layout.tsx             # Mounts AppShell (top/bottom nav + sidebar)
    dashboard/             # Live house facts + placeholder lower sections
    onboarding/            # First-run address capture
    inventory/             # Home inventory list (server component)
    inventory/[id]/        # Inventory item detail view
    reports/               # Hearth Reporting hub (UI mockup, no generation)
    documents/[id]/        # Document detail view (legacy placeholder)
    entities/[id]/         # Older detail-page placeholder (kept, unused)
  auth/                    # Supabase auth route handlers
    callback/              # OAuth callback exchange
    confirm/               # Magic-link verification
    signout/               # Server-side sign-out POST
  login/                   # Public sign-in page (OTP + Google)
  layout.tsx               # Root html/body shell, font wiring
  page.tsx                 # Public landing (full-bleed annotated house sketch + sign-in card);
                           # redirects authed users to /dashboard
  .well-known/workflow/    # Auto-generated Workflow SDK endpoints (gitignored)
components/                # Shared UI primitives (see "Design system")
lib/
  briefing/
    zillow.ts              # AI Gateway lookup + pure validation
    zillow.test.ts         # Vitest coverage of validation helper
  house-image/
    prompt.ts              # Pure builder for the generated-sketch prompt
    prompt.test.ts         # Vitest coverage of era/style/stories derivation
    signed-url.ts          # createSignedUrl helper for the house-images bucket
  hooks/
    use-house-realtime.ts  # Supabase Realtime subscription for one house row
  supabase/
    client.ts              # Browser Supabase client (hearth schema)
    server.ts              # Server component / action client (hearth schema)
    service.ts             # Service-role client for background work (workflow steps)
    proxy.ts               # Edge-style session refresh + route guards
workflows/
  briefing.ts              # Day One Briefing workflow (use workflow + use step)
  house-image.ts           # Generated architectural-sketch workflow (use workflow + use step)
proxy.ts                   # Next entry that calls lib/supabase/proxy.ts
next.config.ts             # Wrapped with withWorkflow() to enable directives
supabase/
  config.toml              # Local Supabase project config
  migrations/              # Forward-only migrations, schema-qualified
docs/
  TechnicalGuide.md        # This file
types/
  house.ts                 # Hand-typed House row, mirrors hearth.houses
```

Next.js' middleware file is named **`proxy.ts`** in this repo. We have not renamed it back to `middleware.ts` — do not introduce one alongside it.

---

## Supabase: shared project, isolated schema

Hearth shares a Supabase project with another app (Echoes). To keep the two from colliding, all Hearth domain tables live in a dedicated **`hearth`** schema. Only auth (`auth.users`) and the user profile stub (`public.profiles`) are shared.

### Schema map

```
auth.users                    (Supabase-managed)
public.profiles               (1:1 with auth.users; carries Hearth user state —
                               plan_tier, role, is_admin, active_house_id)
  └─ hearth.houses            (1 user → many houses)
       ├─ hearth.rooms        (default 9 seeded by trigger on house insert)
       ├─ hearth.inventory    (room_id NOT NULL; Exterior holds outdoor items;
       │                       type ∈ {appliance, system, exterior, property})
       │    └─ hearth.documents  (inventory_id nullable; many-to-one)
       └─ hearth.documents    (house_id required; can exist unattached)
```

Key facts about each table:

- **`public.profiles`** — 1:1 with `auth.users`, auto-populated by the `handle_new_user()` trigger on signup. Carries the user-scoped state Hearth needs across requests: `plan_tier` (`free | premium`, billing gate), `role` (`homeowner | contractor | admin`, affects future UX surfaces), `is_admin` (boolean god-mode bypass for capability gates, distinct from `plan_tier` — see "Capability gate" below), and `active_house_id` (uuid FK to `hearth.houses` with `ON DELETE SET NULL`; the user's currently-viewed house, durable across devices). RLS is owner-scoped: a user can read and update **only** their own row, and the UPDATE policy's `with check` pins `plan_tier` / `role` / `is_admin` to their existing values so a browser client cannot self-escalate — admin/billing writes go through the service-role client. `active_house_id` is the only column a user can actually mutate from the browser today.
- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `lot_size_acres`, `bedrooms`, `bathrooms`, `heating_summary`, `cooling_summary`, `parcel_id`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. Two property-situation columns landed in issue #142 — `water_source` (text with a CHECK constraint enforcing `well | municipal | shared | unknown`) and `basement_present` (nullable boolean) — both captured as an interstitial phase inside the OnboardingDiscoveryModal (see "Property-situation prompt" below) and editable from the home-details modal; the application treats null and `unknown` as "we can't reason about this — suppress findings rather than guess." `water_source` uses a CHECK-constrained text column rather than a Postgres ENUM so the value set can evolve via migration without `alter type` rewrites. `lot_size_sqft` and `lot_size_acres` are intentionally redundant: Zillow displays one or the other depending on lot size, and downstream queries want sqft for sorting while UI rendering prefers acres for large lots; the briefing validator derives whichever isn't returned. `heating_summary` / `cooling_summary` are short free-form strings ("Forced air, Gas", "Central") — untyped because Zillow's vocabulary isn't constrained enough to justify an enum yet. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. Generated-image columns (`generated_image_url`, `generated_image_prompt`, `generated_image_created_at`) hold the storage path + prompt + timestamp for the architectural-sketch placeholder (see "Generated house illustration" below). RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
- **`hearth.rooms`** — physical spaces inside a house. `kind` is `indoor | outdoor | utility`. The **`houses_seed_default_rooms`** trigger fires `after insert on hearth.houses` and inserts a 9-room default set (Kitchen, Living Room, Primary Bedroom, Primary Bathroom, Basement, Attic, Garage, Laundry, Exterior). The Exterior room exists so outdoor inventory has a non-null home.
- **`hearth.inventory`** — every appliance, system, exterior element, and **property** item the homeowner owns. `type` is `appliance | system | exterior | property` and drives UI grouping. The conveyance line maps cleanly: the first three convey at sale; `property` (vehicles, electronics, instruments, art, pets) leaves with the owner — same line the insurance industry draws between dwelling and contents. `subtype` is a nullable discriminator within `type`; v1 recognizes `vehicle` and `pet` as concrete property subtypes (other property stays `subtype=null`), and other top-level types always carry `subtype=null`. `room_id` is NOT NULL with `ON DELETE RESTRICT`. Identification fields (manufacturer/model/serial), install/service dates, and status round it out. Two property-friendly columns added with the property type — `purchased_on date` (broadly meaningful across all inventory types but populated primarily for property) and `estimated_value_cents bigint` (user-entered, in cents to avoid float drift; `bigint` not `integer` so high-value art / jewelry don't overflow). `metadata jsonb not null default '{}'::jsonb` is the open-shape bucket for subtype-specific fields — for `vehicle` it carries `license_plate`, `license_plate_state`, `model_year`, `purchase_price_cents`, `purchased_from`, and any `vin_decode` payload; for `pet` it carries `species`, `breed`, `microchip_number`, `vet_name`, etc. New subtypes extend through `metadata` rather than new columns; promotion-to-column happens only when a real cross-row query pattern emerges. Validation lives in [`lib/inventory/metadata-schemas.ts`](../lib/inventory/metadata-schemas.ts) as per-subtype Zod schemas with a `parseVehicleMetadata` / `parsePetMetadata` resolver that returns `{}` for any input the schema rejects — old or future shapes never crash the renderer. `hero_document_id` is a nullable FK into `hearth.documents` with `ON DELETE SET NULL`; when set, the detail page, dashboard inventory tile, and home inventory list all promote that document's thumbnail to the hero slot, falling back to the existing "most-recently-attached photo" rule when null. Two AI surfaces hang off this table — `ai_pills` / `ai_insights` from the Research pipeline (see "Research this model pipeline" below), and the manufacture-date columns (`manufacture_date`, `manufacture_date_precision`, `manufacture_date_confidence`, `manufacture_date_decoded_at`, `manufacture_date_model`, `manufacture_date_reasoning`) from the parallel serial-decode pipeline. The two precision and confidence columns are check-constrained to their enum values (`year|month|week` and `high|medium|low`); only high-confidence decodes ever populate these columns, since the user-visible tile fallback shouldn't surface a confidently-wrong date. The edit modal also writes user-entered manufacture dates through the same six columns with `model='user-entered'` and `confidence='high'`, so the detail page's "Manufactured" tile fallback flows through unchanged for both decoded and user-asserted values.
- **`hearth.documents`** — every user-captured asset attached to a house: photos and multi-page receipts today, PDFs and compressed videos in later phases. `kind` is the discriminator that drives extraction routing and UI treatment (`nameplate`, `photo`, `receipt`, `manual`, `permit`, `warranty`, `invoice`, `inspection`, `emergency_procedure_video`, `other`); current code writes `nameplate`, `photo`, and `receipt`, with the rest reserved so future phases don't need a schema change. `status` is the lifecycle column — `analyzing → analyzed → attached`, with `failed` as the terminal-error state — driven by the Smart Uploader's early-INSERT pattern (the row exists from the moment storage uploads succeed). `storage_path` holds the 1920px display version and `thumbnail_path` holds the 600px thumb; **the original uncompressed file is intentionally not stored** — only the resized versions land in the bucket. For multi-page receipts, `storage_path` / `thumbnail_path` hold page 1 only; pages 2+ live in `hearth.document_pages` (see below) so every existing single-page reader keeps working unchanged. `content_hash` is the SHA-256 of the pre-resize bytes for per-house dedup (partial unique index on `(house_id, content_hash)`), but the bytes themselves are discarded after the Canvas reads them. `house_id` is `NOT NULL` with `ON DELETE CASCADE` — deleting a house removes its documents. `inventory_id` is nullable with `ON DELETE SET NULL` — documents exist before the user attaches them in the review stage, and deleting an inventory item later reverts its documents to unattached rather than destroying them. `uploaded_by` references `auth.users` with `ON DELETE SET NULL` so documents survive user deletion. AI provenance lives in `ai_extraction` (jsonb, kind-specific schema in app code), `ai_model`, `ai_confidence` (0..1), and `analyzed_at`. `metadata` (jsonb, default `'{}'`) is the open-shape bucket for kind-specific structured fields — currently populated for receipts (vendor / date / totals / line items / referenced serials, parsed via `receiptMetadataSchema` in [`lib/documents/metadata-schemas.ts`](../lib/documents/metadata-schemas.ts)), reserved for future kinds. Same column-vs-jsonb philosophy as `hearth.inventory.metadata`: promote to a column only when a cross-row query pattern earns it. RLS scopes through house ownership identical to `hearth.inventory` — four policies (SELECT/INSERT/UPDATE/DELETE) all delegating to `hearth.houses.owner_id = auth.uid()`.
- **`hearth.document_pages`** — pages 2+ of multi-page documents (issue #117). Page 1 stays on `hearth.documents.storage_path` / `thumbnail_path` so every existing single-page reader (signed-URL helpers, dashboards, detail-page galleries) keeps working unchanged; only multi-page documents need the child table. Columns: `document_id` (FK with `ON DELETE CASCADE` so a parent delete atomically removes every page), `page_number` (CHECK `>= 2` — page 1 is implicit on the parent), `storage_path` / `thumbnail_path` (same 1920px + 600px shape as the parent), `content_hash` for in-session per-page dedup, plus the usual size / MIME / filename fields. Unique on `(document_id, page_number)`. Three policies (SELECT/INSERT/DELETE) all delegating through the parent document's house ownership; no UPDATE policy — pages are immutable, the user retake flow deletes the row + storage objects and inserts a fresh row instead of mutating in place. Cleanup-on-cancel uses `documentDirectoryPath` and `.list()` against the bucket so a single sweep removes both single-page and multi-page documents without the caller knowing which.

All four tables (houses, rooms, inventory, documents) use a shared `hearth.set_updated_at()` trigger function defined in the houses migration. `hearth.document_pages` is intentionally not in that set — pages are immutable, so the trigger has nothing to write.

`hearth.water_systems` (issue #166) is a per-utility shared cache keyed by `pwsid`, not tied to any single house — multiple houses on Kalamazoo PWS resolve to the same row. RLS is globally readable to authenticated users with no write policies (writes happen exclusively through the service-role workflow path). `raw_payload jsonb not null` preserves the full Envirofacts response so future column additions can be backfilled from existing rows. See "Water Quality Awareness module" under the Habitat surface section for the full pattern.

`hearth.water_system_violations` and `hearth.water_system_lcr_samples` (issue #169) are the SDWIS sibling caches — per-(PWSID, violation_id) and per-(PWSID, sample_id) respectively, both FKing back to `water_systems(pwsid)`. The accompanying `hearth.water_system_data_fetches` table tracks per-(PWSID, dataset) freshness for both, decoupling "fetched and EPA returned zero rows" from "never fetched". All three tables share the same RLS pattern as `water_systems` — globally readable, service-role writes only — and the same app-code-enforced TTL discipline (currently 30 days vs. 90 days for inventory).

### Schema-qualification rules (load-bearing)

- Every `CREATE TABLE`, `CREATE FUNCTION`, `CREATE INDEX`, `CREATE POLICY` in a migration **must** be schema-qualified: `hearth.houses`, not `houses`. Bare names default to `public` and would leak into the shared schema.
- Both Supabase clients (`lib/supabase/client.ts` and `lib/supabase/server.ts`) are constructed with `db: { schema: "hearth" }`, so `.from("houses")` resolves to `hearth.houses` by default.
- Accessing shared tables (e.g. `public.profiles`) from the client requires an explicit `.schema("public")` call.

### Migration discipline

- Migrations flow **Hearth → remote only**. Never run `supabase db pull` — it would dump the other app's schema into Hearth's migration history.
- `supabase migration list` will show the other app's migrations in the Remote column with empty Local. This is expected visual noise.
- Authoring loop: `supabase migration new <name>` → edit SQL → commit on a feature branch → PR review. Verification before push is by **SQL inspection in PR review** — there is no local stack to apply migrations against, and we do not use a staging branch DB. Once the PR is approved, `supabase db push` applies the new files to the remote project. Because that remote is what `next dev`, preview, and production all read, every push is effectively production; treat irreversible operations (drops, rewrites, data backfills) with extra care, and prefer additive forward-only changes.

### `public.profiles` defensive guard

The hearth schema migration includes `create table if not exists public.profiles`. On the shared remote project that table is owned by the other app, so the `if not exists` is always a no-op — the clause exists defensively rather than as a real bootstrap. Don't rely on this migration to create `profiles`; assume the table is already there.

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

`{document_id}` is generated client-side before any storage round-trip, same pattern as the photo bucket. The container choice (`webm` vs `mp4`) is decided per-recording by [`pickVideoMimeType`](../lib/documents/process-video.ts) against `MediaRecorder.isTypeSupported` — only one of the two video files ever exists for a given document. The path builders `emergencyVideoObjectPath` and `emergencyVideoPosterObjectPath` in [`lib/documents/paths.ts`](../lib/documents/paths.ts) own the construction so the picker doesn't leak into surrounding code.

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

[`lib/documents/emergency-video-rules.ts`](../lib/documents/emergency-video-rules.ts) holds the pure rules so they can be unit-tested independently of any database round-trip and reused by future surfaces (admin tooling, migrations) without re-derivation:

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

The emergency-video path of the Smart Uploader is a five-stage state machine that lives alongside the photo and receipt paths in [SmartUploader.tsx](../components/smart-uploader/SmartUploader.tsx). Discovery-mode entry is the path-picker's "Emergency procedure video" option (red-toned chip to signal the emergency surface); pre-routed entry is the dashboard panel's "Add a {category} video" affordance, which passes an `initialEmergencyCategory` prop that bypasses both the path picker and the category stage and lands on the label stage with the category pinned.

Stages in order:

1. **Category** ([EmergencyCategoryStage.tsx](../components/smart-uploader/stages/EmergencyCategoryStage.tsx)) — a 2×2 grid of icon-dominant cards (Water / Gas / Electrical / Other). Tapping advances to the label stage. Skipped when `initialEmergencyCategory` is set.
2. **Label** ([EmergencyLabelStage.tsx](../components/smart-uploader/stages/EmergencyLabelStage.tsx)) — optional name field for the three named categories ("Main shutoff in basement", "Outside faucets"); required for `'other'`. Pre-fills from prior navigation so a user retaking doesn't re-type.
3. **Capture** ([EmergencyCaptureStage.tsx](../components/smart-uploader/stages/EmergencyCaptureStage.tsx)) — two parallel affordances: "Record now" calls `getUserMedia({ video: { facingMode: 'environment' }, audio: true })` and runs a `MediaRecorder` against the live stream until the user taps Stop (or the 2-minute auto-cap fires); "Upload existing video" opens a `video/*` file picker. Either path resolves to a `File` and advances to compression. Camera permission denial surfaces the upload fallback inline.
4. **Compress** ([EmergencyCompressStage.tsx](../components/smart-uploader/stages/EmergencyCompressStage.tsx)) — spinner while the orchestrating hook runs `processVideo`. On `ProcessVideoError` the stage renders the error message and offers Retake / Cancel; the upstream stages are still intact in component state so Retake just clears the result and bounces back to capture.
5. **Review** ([EmergencyReviewStage.tsx](../components/smart-uploader/stages/EmergencyReviewStage.tsx)) — embedded `<VideoPlayer>` with the just-compressed Blob and poster, optional multi-line notes (soft warning at 2000 chars), and Save / Retake / Cancel. Save invokes the orchestrating hook's `save()`, which uploads + inserts the row in the same call.

The orchestrating hook is [use-emergency-video-upload.ts](../components/smart-uploader/hooks/use-emergency-video-upload.ts). Phases: `idle → compressing → compressed → saving → done`, with `error` reachable from compressing or saving. The hook owns the in-memory blob URLs for the preview, revoking them in its `reset()` so a closed-mid-flow uploader doesn't leak bytes. Unlike the photo / receipt flows there is no `hearth.documents` row written until the final save step — emergency videos skip the early-INSERT pattern because there's no AI analyze step that benefits from it, and the up-front row would have to carry storage paths before the compression even finishes.

### Dashboard Emergency reference panel

The panel at [emergency-reference-panel.tsx](../app/(app)/dashboard/emergency-reference-panel.tsx) replaces the hardcoded `EMERGENCIES` placeholder grid above habitat on the dashboard. Server component pattern: it fetches every `kind='emergency_procedure_video'` row for the active house in one query (sorted by `emergency_is_primary desc, created_at desc`, which is exactly what the partial index covers), groups them in memory by `emergency_category`, and hands the result to the [client panel](../app/(app)/dashboard/emergency-reference-panel.client.tsx) which renders four category rows in the fixed Water / Gas / Electrical / Other order.

Per-category rendering:

- **Empty category** — a thin dashed-border affordance row with the category icon at left and "Add a {label} video" text. Tapping mounts a SmartUploader instance pre-routed to that category.
- **Populated category** — a primary tile in 16:10 aspect with the category icon as a full-bleed background, label and duration overlaid in the bottom scrim, plus a 52×52 white play affordance circle in the bottom-right. The icon-as-background treatment is deliberate per Todd's direction in issue #139: "make these images stand out so it's absolutely clear the user is seeing the emergency water icon." Secondary videos in the same category surface as a "+N more {label} videos" pill below the primary tile, which opens the modal with the primary playing first and a strip of all videos in the category.

The panel mounts its own SmartUploader and EmergencyVideoModal instances; top-nav's existing SmartUploader for the general "+ Add" entry stays untouched. Two simultaneous SmartUploader instances are fine because they're conditionally mounted and only one can be open at a time given the modal's scroll-lock.

### Custom video player

[video-player.tsx](../components/video-player.tsx) is the gloves-friendly player shared between the Smart Uploader's review stage and the dashboard modal. Deliberately not `<video controls>` — the browser-default control bar offers volume / playback speed / forward / rewind / picture-in-picture, none of which serve the "2am with wet hands" reality. The custom controls are:

- Centre play/pause overlay button (88×88, fades during playback with `prefers-reduced-motion` honored).
- Full-width scrubber row (32pt minimum height) with native `<input type="range">` and `accent-color: white` for the thumb.
- Time display (current / total) in monospace tabular numerals.
- Fullscreen toggle (44×44 with a 20px maximize/minimize icon).
- Tap anywhere on the video surface toggles play.

No volume control, no rewind/forward, no playback-speed selector — by design. Controls auto-hide after 3 seconds of inactivity during playback and stay visible while paused. iOS Safari's `playsInline` is set so fullscreen on iPhone honors the system fullscreen pill.

### Server actions

Four actions under `app/actions/documents/`, all `"use server"` and returning the project's standard `{ data, error: null } | { data: null, error: string }` shape:

- **`saveEmergencyVideoAction`** ([save-emergency-video.ts](../app/actions/documents/save-emergency-video.ts)) — final save. The Smart Uploader's hook has already uploaded the video + poster Blobs to the `hearth-emergency-videos` bucket. This action runs a head-count of existing rows in the same `(house_id, emergency_category)` to decide the primary flag (mirroring `shouldSaveAsPrimary`), inserts the row with `status='attached'` (no AI step → no analyzing phase), and calls `revalidatePath('/dashboard')` so the panel reflects the new video without a navigation. The cross-column CHECK constraints on the schema enforce that emergency-video rows write `storage_bucket='hearth-emergency-videos'` and carry a non-null `emergency_category` — this action sets both correctly, but a future writer that drifts will be caught at INSERT time rather than producing inconsistent rows.
- **`promoteEmergencyVideoAction`** ([promote-emergency-video.ts](../app/actions/documents/promote-emergency-video.ts)) — promotes a secondary to primary. Two sequential UPDATEs (demote current primary by `(house_id, kind, category, is_primary=true)`; promote target by id), wrapped with defensive checks (target exists, is an emergency video, has a category). Already-primary input is a no-op success so callers don't need to special-case re-tap.
- **`updateEmergencyVideoAction`** ([update-emergency-video.ts](../app/actions/documents/update-emergency-video.ts)) — edits label and/or notes. Server-side enforces the "label required when category is 'other'" rule before the UPDATE.
- **`deleteEmergencyVideoAction`** ([delete-emergency-video.ts](../app/actions/documents/delete-emergency-video.ts)) — same best-effort-storage / authoritative-row pattern as `cleanupDocumentAction`. After the row delete, if the deleted row was the primary in its category, the action runs `pickPromotedSecondaryId` against the remaining rows and UPDATEs the winner to `emergency_is_primary=true`. The pure logic lives in [emergency-video-rules.ts](../lib/documents/emergency-video-rules.ts); the action just translates the survivor list into a single UPDATE.

All four call `revalidatePath('/dashboard')` so dashboard surfaces (the panel and the SuggestedNext implicit-completion timestamp once that lands as a follow-up) re-render with the new state.

### Signed URL caching

The dashboard tiles use the static `/public/document_icons/*.jpg` images for the icon-as-background treatment — those are public assets, no signing needed. The video and poster bytes live in the private `hearth-emergency-videos` bucket and are accessed via [createCachedSignedUrl](../lib/house-image/signed-url.ts), the same helper the photo flows use. The bucket was added to the helper's `CachedSignedUrlBucket` union so emergency video URLs participate in the existing sessionStorage caching layer.

---

## Server actions and the Grok analyze pipeline

The Smart Uploader's server-side surface is seven `"use server"` actions under `app/actions/documents/` plus the Grok 4.3 vision wrappers in `lib/documents/ai/`. The modal in phase 1.4 is the orchestrator — every action below is callable in isolation and returns the project's standard `{ data, error }` shape. None of them bypass RLS via the service-role client; ownership enforcement is the load-bearing job of `hearth.documents` and `hearth.inventory` policies, both of which delegate through `hearth.houses.owner_id = auth.uid()`.

The row type for `hearth.documents` is hand-typed in [types/document.ts](../types/document.ts) (`DocumentRow`, plus the `DocumentKind` / `DocumentStatus` unions and the `AiExtraction` discriminated union used for the `ai_extraction` jsonb column). Same pattern as `types/house.ts` — kept in sync with the migration until `supabase gen types typescript` replaces it.

### The server actions

All under `app/actions/documents/`, all use `createClient` from [lib/supabase/server.ts](../lib/supabase/server.ts), all return `Promise<{ data, error: null } | { data: null, error: string }>`.

Shared with the photo and receipt flows:

- **`checkDocumentDuplicateAction`** — looks up an existing `hearth.documents` row in the given house by SHA-256 `content_hash`. Used by the Smart Uploader before insert so a byte-identical re-upload jumps to the existing-row branch instead of tripping the partial unique index. Returns `{ exists: false, existingDocument: null }` or `{ exists: true, existingDocument: <row> }`.
- **`createPendingDocumentAction`** — inserts a `hearth.documents` row with `status='analyzing'`. The storage uploads have already completed by this point; the action takes the pre-allocated client-side UUID and the storage paths and writes the row. `uploaded_by` is set from `supabase.auth.getUser()`. An optional `inventoryId` parameter pre-attaches the document for the "open Smart Uploader from inventory detail" entry point.
- **`attachDocumentToInventoryAction`** — attaches a document to an *existing* inventory row, optionally merging accepted AI-extracted fields (`acceptedFields`) into that inventory row first. The merge runs before the document UPDATE so a merge failure leaves the document in its prior state — the user can retry rather than ending up with an attached document whose inventory row doesn't reflect their accepted edits.
- **`cleanupDocumentAction`** — used by the modal's retake / cancel paths. Lists the document's storage directory and removes every object in one sweep (handles both single-page documents and multi-page receipts without the caller needing to know which) followed by an authoritative `DELETE` of the row. The `hearth.document_pages` rows fall out via `ON DELETE CASCADE`. A failed storage removal does not block the row delete; orphaned bytes are deferred to a future periodic sweep.

Photo flow only:

- **`analyzeNameplateAction`** — the photo flow's analyzer. Loads the row, mints a 5-minute signed URL against the `hearth-documents` bucket via `createSignedUrl()`, calls either `classifyImage` (when no `existingInventoryData`) or `deltaImage` (when present), normalizes the result into the `AiExtraction` shape, writes back `ai_extraction` / `ai_model` / `ai_confidence` / `analyzed_at` and flips `status` to `analyzed`. On any throw from the Grok call the row flips to `status='failed'` and the action returns the error message.
- **`findMatchingInventoryAction`** — surfaces inventory rows in the house that look like the same physical item as the proposed classification, so the review stage can offer "add this photo to existing X" instead of forcing a duplicate row. Filters by `type` in Postgres (a "Microwave" appliance must never collide with a system row even when names normalize identically), then runs `inventoryNameMatches()` from [`lib/inventory/match-name.ts`](../lib/inventory/match-name.ts) in-process against the candidate set. The matcher canonicalizes both sides (lowercase, punctuation-strip, whitespace-collapse) and applies a tight whole-string alias map — `microwave oven` → `microwave`, `washer`/`clothes washer` → `washing machine`, `clothes dryer` → `dryer`, `hot water heater` → `water heater`, `fridge` → `refrigerator`, `ac`/`air conditioning` → `air conditioner`, `gas furnace` → `furnace`. The alias map is whole-string only by design: "Pressure Washer" must not collapse to "Washing Machine", and "Dishwasher" must not match "Washer". N per house is small enough that filtering in TypeScript is simpler than fighting Postgres for fuzzy matching, and the alias rules stay testable without a database. The classify prompt pins seven canonical names ("Microwave", "Washing Machine", "Dryer", "Water Heater", "Refrigerator", "Air Conditioner", "Furnace") and tells Grok to use them verbatim — the matcher catches the residual drift when the model paraphrases anyway. New alias pairs land only when we've actually observed Grok returning them (issue #90).
- **`createInventoryFromDocumentAction`** — inserts a new `hearth.inventory` row using the user-confirmed values, then attaches the document to it (`inventory_id` set, `status='attached'`). Two sequential queries rather than a Postgres function — simple enough that a function isn't justified yet. Inventory columns are `manufacturer` / `model_number` / `serial_number` / `installed_on` / `notes` (the schema's actual column names, not the prompt-draft `model` / `serial`).

Receipt flow (issue #117):

- **`addDocumentPageAction`** — inserts a `hearth.document_pages` row for pages 2+ of a multi-page receipt. Page 1 still lives on the parent `hearth.documents` row, written by the existing `createPendingDocumentAction`. Storage uploads happen client-side first via `uploadDocumentPageFiles`; this action is a thin Supabase wrapper around the row insert.
- **`deleteDocumentPageAction`** — removes a single page row plus its two storage objects. Used by the multi-page capture stage when the user deletes a page mid-capture. Same best-effort storage / authoritative row-delete pattern as `cleanupDocumentAction`.
- **`analyzeReceiptAction`** — multi-page receipt analyzer. Loads the parent document, the ordered list of `document_pages` rows, signs every storage path in one `createSignedUrls` batch, hands the ordered URL list to `analyzeReceipt()` in `lib/documents/ai/analyze.ts` for a single `generateObject` call across all pages, persists the structured result into both `ai_extraction` (raw provenance) and `metadata` (application-curated shape), and flips status to `analyzed`. Same `status='failed'` write on AI throws as `analyzeNameplateAction`.
- **`findInventoryByReceiptAction`** — surfaces inventory items in the house whose serial numbers (or model numbers, as a weaker signal) match identifiers the receipt extracted. The pure-logic core is in [`lib/documents/receipt-inventory-match.ts`](../lib/documents/receipt-inventory-match.ts) (`matchInventoryByReceipt`) so it can be unit-tested against fixture inventory sets; the server action is the Supabase wrapper. Two passes on serials — case-folded exact match wins first, punctuation-normalized match runs only against rows that didn't hit in pass 1 (receipts print VINs with separator characters that the user's nameplate-captured serial often doesn't have). Model-number matches surface as suggestions only, never strong — a model number alone isn't unique. The literal `"unknown"` sentinel from [`lib/inventory/model-number.ts`](../lib/inventory/model-number.ts) is filtered out to avoid colliding every receipt with every sentinel row. A single serial hit becomes the strong match; multiple serial hits demote to suggestions so the user disambiguates.
- **`saveReceiptAction`** — final save. Attaches the document to the chosen inventory item, flips status from `analyzed` to `attached`, and optionally persists the user's edited notes. Extraction has already written `ai_extraction` / `metadata` in `analyzeReceiptAction`; this action does not rewrite either column.

### Grok 4.3 via the Vercel AI Gateway

[`lib/documents/ai/`](../lib/documents/ai/) holds the model wiring. Three files:

- **`schema.ts`** — Zod schemas for `generateObject`. `classificationSchema` is a `z.discriminatedUnion("photo_kind", […])` of three branches (`nameplate`, `appliance_photo`, `not_useful`); the discriminator lets the model pick exactly one shape. `deltaSchema` is a `{ deltas: Record<string, { currentValue, proposedValue }>, confidence }` object. `receiptExtractionSchema` (issue #117) is a flat structured shape — vendor / address / phone / date / type / cents / currency / payment method / line items / referenced serials / referenced model numbers / notes / ai_confidence. All three are the contract between Grok and the rest of the system — the AI SDK rejects any model output that doesn't validate, so getting them right is load-bearing.
- **`prompt.ts`** — `buildClassifyPrompt()` returns the static classify-and-extract system prompt; `buildDeltaPrompt({ existingInventoryData })` returns the delta prompt with a JSON-serialized existing-data block appended; `buildReceiptPrompt()` returns the static multi-page receipt extraction prompt. Separated from `analyze.ts` so they're easy to iterate on and easy to unit-test against. The receipt prompt mirrors the nameplate prompt's anti-leak discipline (issue #81) — example values are angle-bracket placeholders rather than literal strings, and the test suite pins "no `Visa ending in 4242`-style literals" and the load-bearing rule lines so a future edit can't silently re-introduce the leak vector.
- **`analyze.ts`** — `classifyImage(input)` and `deltaImage(input)` for the photo pipeline, `analyzeReceipt({ pageUrls })` for the receipt pipeline. All three are thin wrappers around `generateObject({ model, schema, system, messages })` from the `ai` package. The image part of the user message is `{ type: "image", image: new URL(input.imageUrl) }` — the action passes a Supabase storage signed URL rather than loading bytes into the Node process. `analyzeReceipt` sends every page as ordered image parts in a single user message plus a short text instruction so the model treats the document as one logical thing (vendor on page 1, total on the final page, line items spanning) rather than per-page extractions that would need a downstream merge. Throws on missing `NAMEPLATE_PRIMARY_MODEL`; the calling server action catches and surfaces.

The photo modes correspond to the two ways a homeowner photographs an item. Mode A is "I don't know if you've seen this before, look at it fresh" — three `photo_kind` outcomes (`nameplate` with extracted fields, `appliance_photo` with classification only, `not_useful` to prompt a retake). Mode B is "you already know this item, here's another angle" — return only the fields where the photo adds or contradicts. The receipt mode is its own pipeline alongside the two photo modes — distinct prompt, distinct schema, single multi-image call.

### Receipt extraction and inventory matching (#117)

The receipt path lives parallel to the photo path. Pages 1-5 of a real-world printed receipt go in (HVAC tune-up invoice, vehicle service receipt, vet visit, plumber call, parts purchase, contractor invoice); a structured extraction comes out (vendor / date / totals / line items / serials seen on the receipt); a matched inventory item gets the document attached.

**Client-side capture** uses `useReceiptUpload` in [`components/smart-uploader/hooks/use-receipt-upload.ts`](../components/smart-uploader/hooks/use-receipt-upload.ts) — a sibling to `useDocumentUpload` rather than an overload, because the receipt flow is incremental (the user adds pages one at a time) and tangling the two state machines would be a maintenance tax. Pipeline per added page: hash → resize → upload (parallel optimized + thumb) → row insert. Page 1 creates the `hearth.documents` row via `createPendingDocumentAction` with `kind='receipt'`; pages 2+ insert into `hearth.document_pages` via `addDocumentPageAction`. Per-session content_hash dedup catches a user re-photographing the same page twice. Cap is 5 pages (raised from the issue's 3-page lean to give longer service invoices headroom); the constant is `RECEIPT_MAX_PAGES` in the hook.

**Finalize** runs `analyzeReceiptAction`, then in non-target mode also runs `findInventoryByReceiptAction` so the review stage can offer strong-match attach. In target mode (opened from an inventory item's "Add document" button) matching is skipped — the inventory item is already known.

**The review stage** ([`components/smart-uploader/stages/ReviewReceiptStage.tsx`](../components/smart-uploader/stages/ReviewReceiptStage.tsx)) shows: a read-only thumbnail strip of every page; a "what we read" chip cluster of vendor / date / type / total / subtotal / tax / payment method; a read-only line-items list (editing line items is deferred per the issue's "out of scope" call); a chip cluster of identifiers the model found (serials and model numbers); a match banner (strong match → one-tap select, suggestions → buttons, none → manual searchable inventory picker); an editable notes field defaulting to the extracted notes; and a Save button. In target mode the picker collapses to a read-only "Attaching to <item>" banner.

**Confidence threshold for the low-confidence branch** is `RECEIPT_CONFIDENCE_THRESHOLD = 0.5` in the review stage — lower than the nameplate `0.6` because receipts vary more in quality (faded thermal paper, handwriting, glare). Documented contract; if we tighten it server-side we update the constant in lockstep.

**The matcher** in [`lib/documents/receipt-inventory-match.ts`](../lib/documents/receipt-inventory-match.ts) is pure — the server action is a thin Supabase wrapper. Two passes: case-folded exact match on `inventory.serial_number`, then punctuation-normalized match for rows that didn't hit. Model-number matches surface as suggestions only. The `"unknown"` model_number sentinel is filtered out. A single serial hit becomes the strong match; multiple hits demote to suggestions so the user disambiguates.

**Serial normalization** in [`lib/documents/serial-normalize.ts`](../lib/documents/serial-normalize.ts) has two passes: `caseFoldSerial` (uppercase + trim, light touch) and `normalizeSerial` (strip whitespace + hyphens + dots + slashes + colons, then uppercase). The character class is whitelisted rather than catch-all-non-alphanumeric so unusual-but-legitimate identifier characters survive. Empty-after-strip becomes null — the matcher can short-circuit before joining everything to everything.

**Receipt metadata** lives in `hearth.documents.metadata` parsed by `receiptMetadataSchema` in [`lib/documents/metadata-schemas.ts`](../lib/documents/metadata-schemas.ts). Same column-vs-jsonb philosophy as `hearth.inventory.metadata` — a field gets its own column only when a cross-row query pattern earns it; receipt vendor / date / totals all live in jsonb today. The parser uses `safeParse` with an empty-fallback so renderers never crash on schema drift.

**`metadata.expiration_date`** (issue #124) is the renewal-document handle: nullable ISO date populated only when the document represents a time-bounded grant the user will need to renew — vehicle registration, insurance policy, warranty certificate, permit, professional license. Distinct from `transaction_date`: a registration card's `transaction_date` is when the user paid the SOS, but `expiration_date` is when the registration lapses (the date the maintenance module cares about). Service receipts, purchase receipts, and inspection reports leave it null — the prompt's positive/negative examples and "wrong date is worse than a null" framing exist to keep Grok from inventing expirations on those. The field lands silently in `metadata` today; the direct-event maintenance pipeline (follow-on issue) reads it to seed renewal tasks.

**Receipt detail surface** is a lightweight page-flip modal — [`app/(app)/inventory/[id]/receipt-page-flip-modal.tsx`](../app/(app)/inventory/[id]/receipt-page-flip-modal.tsx). Same `yet-another-react-lightbox` chrome as the photo lightbox, themed to match Hearth's surfaces. Lazy-loads the page-1 `storage_path` plus every `document_pages` row in ascending order, signs each via `createCachedSignedUrl`, and hands the slides to the library. A dedicated `/documents/[id]` route is deferred per the issue's open-question lean — modal first, then revive the route once the documents corpus is large enough to need a browse surface.

**Inventory detail entry points** — the inventory detail page exposes two target-mode triggers: an existing "Add photo" button and the new "Add document" button (issue #117 follow-on request). Both open the Smart Uploader pre-locked to the current inventory item; the new `targetKind: 'photo' | 'receipt'` prop selects the path. Single uploader instance, two trigger refs for focus-return.

### Kind demotion

A row inserted with `kind='nameplate'` can be demoted to `kind='photo'` when the AI classifies the image as `appliance_photo`. The demotion is one-directional: rows inserted as `photo` from the dashboard's generic entry point stay where they are even if the AI judges them to be label shots. The `not_useful` path leaves `kind` untouched — the caller's next move is almost always `cleanupDocumentAction`, so the column's value stops mattering immediately.

### Environment variables

Both read at call time so the model can be swapped without redeploying:

- **`NAMEPLATE_PRIMARY_MODEL`** — required. The model string passed to `generateObject`. Routes through the Vercel AI Gateway; the gateway forwards to xAI using the project's BYOK Grok credentials. Default in development: `xai/grok-4.3`. Missing → `analyzeNameplateAction` returns the configuration error.
- **`NAMEPLATE_CONFIDENCE_THRESHOLD`** — float in `[0, 1]`. The Smart Uploader's review stage shows a low-confidence branch when `ai_confidence < threshold`. Default `0.6`. Consumed server-side in 1.3 only as a documented contract; the modal in 1.4 reads it via the analysis result, so neither value needs `NEXT_PUBLIC_` exposure.

These are populated in `.env.local` via `vercel env pull` and configured in the Vercel dashboard for preview / production environments.

---

## Inventory detail page and AI insights

The inventory detail page at `app/(app)/inventory/[id]/page.tsx` is the page-level destination behind every dashboard inventory tile. Two AI surfaces live here: **structured pills** (discrete `{label, value}` facts pulled from the nameplate at upload time, rendered in the title area) and **Research this model** (an on-demand AI lookup, streamed via the Vercel AI Gateway, that produces a "what we know about [things] like yours" panel). Both store their output as jsonb columns on `hearth.inventory` and are independently regeneratable.

### Page, not modal

The detail page is a real Next.js route, not a modal. Deep links work, browser refresh works, and any future "Add another photo / re-analyze" entry point can ride the same URL. The earlier mockup floated a modal — we explicitly chose a page so the surface can grow over time without fighting modal mechanics. The page lives at `/inventory/[id]`; the older `/entities/[id]` placeholder still exists from the dashboard mockup and is intentionally untouched in this phase.

### Schema additions

Migration `20260519153348_add_inventory_ai_columns.sql` adds two nullable jsonb columns to `hearth.inventory`:

- **`ai_pills`** — `Array<{ label: string, value: string }>`. Populated at row-creation time by `createInventoryFromDocumentAction`, which copies the source document's `ai_extraction.extracted.pills` through. Nameplate-classification documents are the only path that produces pills; appliance_photo and not_useful documents leave the column null.
- **`ai_insights`** — single object: `{ headline, overview, service_life, maintenance, source_urls, found_specific_model, generated_at, model_used }`. The three content sections (`overview` / `service_life` / `maintenance`) are independently nullable so the model can populate the parts it can ground and leave the rest null. Populated on-demand by the streaming route handler at `/api/inventory/[id]/research` and overwritten in place on re-run, which is what lets Todd iterate on the prompt during development without extra plumbing. The column is jsonb (application-defined shape), so the section split landed without a migration; legacy rows written before the split carry a stale `body` field and render as if no sections are populated — the user clicks "Research again" to regenerate.

Both columns are additive and forward-only; no backfill is needed.

### Pills extraction

`lib/documents/ai/schema.ts` extends the nameplate branch's `extracted` shape with `pills: z.array(pillSchema)`, where `pillSchema = { label: string min 1 max 40, value: string min 1 max 120 }`. Bounded lengths exist because the detail-page chip cluster can't render unbounded text without breaking the layout. The `appliancePhotoBranch` does **not** get pills — appliance photos by definition have no readable label.

The classify-and-extract prompt in `lib/documents/ai/prompt.ts` gains a section that explains the pills array, gives five label/shape examples (Capacity / BTU Input / Fuel / Voltage / Max Pressure), and codifies four rules the prompt enforces: pills must be facts **printed directly on the label** (no facts derived from decoding serial numbers, model numbers, or other identifiers — those belong in AI Insights); no Manufacture Date pill unless a date is printed verbatim on the label as a date (the same prohibition extends to model release year, generation/series, and equipment age); skip industry-internal codes (certification numbers, factory codes); and skip facts already captured as named extracted fields (manufacturer / model_number / serial_number).

Example pill values are written in angle-bracket placeholder syntax (`"<voltage as printed>"`) rather than literal-looking strings, because an earlier revision using literal values like `"29 Jan 2015"` was observed leaking verbatim into Grok 4.3's output for unrelated appliances — a textbook few-shot leak (issue #81). The header comment above `CLASSIFY_SYSTEM_PROMPT` documents the failure mode so future prompt edits don't silently re-introduce specific-looking example values. The `prompt.test.ts` suite pins the no-leak contract: it asserts the absence of the prior leaked values, the presence of the placeholder syntax, and the load-bearing rule strings (Manufacture-Date prohibition, derived-facts prohibition, printed-directly-on-the-label requirement). A live-API regression harness against real nameplate JPGs is deliberately deferred to a follow-up — the prompt unit tests catch "did someone delete the rule?" but only an end-to-end fixture run against actual Grok will catch "does Grok still obey the rule?".

The Smart Uploader review stage (`components/smart-uploader/stages/ReviewNewStage.tsx`) renders the extracted pills as a read-only chip cluster beneath the editable fields ("Also captured: …"). This is deliberate: users shouldn't discover the pills surface for the first time on the detail page. Pills are not editable in this phase.

### Research this model pipeline

The `lib/inventory-insights/` module pairs with the streaming route handler at `app/api/inventory/[id]/research/route.ts`. Model selection is env-driven via `INVENTORY_INSIGHTS_MODEL` (with `BRIEFING_PRIMARY_MODEL` as a fallback) so providers can be A/B-tested without code changes — GPT-5.5 and Grok 4.3 have both ridden this path during prompt iteration.

- **`prompt.ts`** — two builders. `buildResearchSystemPrompt()` returns the general framing that applies to every call (grounding definition, honesty rules, output structure, the 300–500 char target with a 1200-char hard ceiling, and an explicit instruction *not* to decode the serial number — that lives in a separate pipeline, see "Serial-number decode pipeline" below); `buildResearchUserMessage(input)` returns the per-item ask, embedding the item's known data (type / name / manufacturer / model_number / serial_number / notes) and three numbered asks — one per output section. Splitting system from user message gave the model an explicit cadence to follow; the earlier single-string prompt with a thin user message produced responses that populated only the first ask. Pills are intentionally **not** included in the user message — they tended to be noisy (every BTU rating, every voltage spec) and didn't materially improve output quality, so the prompt stays lean.
- **`prompt.test.ts`** — covers field-presence permutations on the user message and load-bearing system-prompt content (output field names, "return null for that section" honesty rule, character caps).
- **`research.ts`** — narrow on purpose. Exports `insightsSchema` (the Zod schema both the route and the client's `useObject` hook validate against) and `getInventoryInsightsModel()` (env-driven selector). The schema's three content sections (`overview` / `service_life` / `maintenance`) are independently nullable with `.min(1)` on each — empty string is invalid, so the only way to skip a section is `null`, which forces the model into a binary "I have something grounded" decision per section. `source_urls` uses `z.string().refine(...)` rather than `z.string().url()` because Zod's `.url()` emits `"format": "uri"` in the generated JSON schema, which OpenAI's structured-outputs subset rejects — refine keeps the runtime URL validation without putting `format` in the schema sent to the model.
- **`research.test.ts`** — covers schema's null-vs-empty-string semantics, the per-section length cap, the missing-key vs explicit-null distinction (Zod requires the field present even when null), and the URL refine behaviour.

The route handler at `app/api/inventory/[id]/research/route.ts` is the only caller. It authenticates via `createClient()` (cookie-based Supabase session), loads the inventory row (RLS-scoped through `hearth.houses.owner_id`), composes the prompts, and calls `streamObject({ model, schema, system, messages, onFinish })`. The stream is piped to the client via `result.toTextStreamResponse()`; `onFinish` runs server-side once the model finishes and writes the structured result (headline + three nullable sections + provenance fields) into `ai_insights`, calls `revalidatePath` so any future SSR reflects the new data, and appends a debug entry to `logs/ai-insights-prompts.log` (gitignored — see "AI Insights debug log" below).

**Streaming, not blocking.** The earlier `researchInventoryModelAction` server action returned the full result after a 20–60s wait; the streaming route returns the response body as soon as the model emits its first token (typically 1–3s for the headline). The client's `useObject` hook reads partial-object updates from the stream and the panel populates field-by-field — headline first, then `overview`, then `service_life`, then `maintenance`. The user is reading content within seconds instead of staring at a spinner.

**Navigation-away trade-off.** Both the streaming call and the DB write live inside the request lifecycle. Vercel Fluid Compute propagates client cancellation to the function, so if the user closes the tab mid-stream the call is killed and `onFinish` never fires — the partial result is discarded and nothing is persisted. Re-clicking from a fresh page load re-runs cleanly. A fully decoupled implementation (Phase 2) would lift the call into Vercel Workflow (see [`workflows/briefing.ts`](../workflows/briefing.ts) for the pattern), which runs to completion regardless of connection state. Phase 2 is deferred until there's a use case beyond single-click-per-item — e.g. "research all unprocessed items" or auto-research at OCR ingest time.

### Serial-number decode pipeline

The Research-this-model pipeline is intentionally non-reasoning for latency reasons (10-ish seconds first-token to last-token on the fast models). That choice was right for the broad summary work but wrong for the one task where determinism matters: decoding the manufacture date encoded in the serial number. Live testing showed the non-reasoning model would fabricate a plausible-sounding encoding rule per call and apply it confidently to itself, producing different dates for the same Whirlpool serial across consecutive runs (2014 / 2022 / 2022-via-a-different-rule / 2023 — all internally consistent, all wrong). Internal-consistency prompting can't catch the hallucination because the *rule itself* is the hallucinated part.

The fix: lift just the decode work into a separate parallel call on a reasoning model.

**Two calls, one click.** Clicking "Research this item" fires both endpoints in parallel from `inventory-detail-view.tsx`:

1. `POST /api/inventory/[id]/research` — the existing streaming insights call, untouched in latency or model choice.
2. `POST /api/inventory/[id]/decode-serial` — the new reasoning-model call. Not streamed; `generateObject` returns the structured response whole. Longer wall-clock than research, but because the two run in parallel the user only feels the longer of the two.

The user-visible click surface, copy, and gating are unchanged. The research stream populates the panel as it always did; the decode call resolves quietly in the background and either lands a toast or doesn't.

**The decode endpoint** at [`app/api/inventory/[id]/decode-serial/route.ts`](../app/api/inventory/[id]/decode-serial/route.ts):
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

**Tile fallback.** The detail page's first stat tile (`StatTiles` in [`inventory-detail-view.tsx`](../app/(app)/inventory/[id]/inventory-detail-view.tsx)) used to be just "Installed". After the decode pipeline landed, it picks between three states via [`pickFirstDateTile()`](../lib/inventory/first-date-tile.ts):
- `installed_on` non-null → eyebrow stays **Installed**, value is the formatted install date (existing behaviour).
- `installed_on` null AND `manufacture_date` non-null with `manufacture_date_confidence === "high"` → eyebrow flips to **Manufactured**, value is the decoded date formatted by precision (`YYYY` → "2014", `YYYY-MM` → "Oct 2014", `YYYY-Www` → the month containing that ISO week's Thursday). The relative-time meta line is suppressed for the manufactured branch — unit age is a different conceptual axis from install age, and mixing them would mislead.
- Otherwise → eyebrow is **Installed**, value is the existing "Unknown" placeholder.

`installed_on` always wins when present. The fallback only fires when the user has no install date for the item. The helper is pure logic and is unit-covered in [`first-date-tile.test.ts`](../lib/inventory/first-date-tile.test.ts) across all four cases — both-null, installed-only, high-confidence-manufactured, and low/medium-confidence-becomes-unknown (defensive; we never persist those, but the helper defends against a future schema change that decouples confidence from persistence).

**The toast.** When the decode call resolves with `confidence === "high"` and a non-null `manufacture_date`, the client formats the date through the same `formatManufactureDate()` helper the tile uses and surfaces a small one-line toast: *"We decoded your manufacture date: Oct 2014"*. The toast is the minimal Hearth-styled primitive at [`components/toast.tsx`](../components/toast.tsx) — bottom-centered, surface-raised, accent leading edge, sparkles icon, hover-paused auto-dismiss at 6s with an explicit X. After the toast mounts, `router.refresh()` pulls the new row state into the page so the StatTiles tile flips from Installed/Unknown to Manufactured in the same paint window.

**No retry surface in this issue.** Re-running decode is implicit: clicking "Research this item" again fires both calls again. There is no dedicated decode-only button. A request-id ref on the client guards against a fast double-click producing two toasts — only the most recent call can land one.

**Serial-decode debug log.** Every call appends one block to `logs/serial-decode-prompts.log`, same format and same gitignore as `ai-insights-prompts.log`. The two files are independent so Todd can iterate on the decode prompt without churning the research log and vice versa.

### On-demand, not auto

Research runs only when the user clicks the Research button. We deliberately did not auto-run on inventory creation: the prompt is still evolving, the model choice may change, and burning Gateway credits on every new row before we know the output is what we want would be wasteful. Auto-running on save is a future enhancement; the column shape supports it (regeneratable) so we won't have to re-shape data when it lands.

### The `"unknown"` model_number convention

Items captured without a model number on the label (radon systems, custom-built equipment, generic exterior assets) would otherwise be locked out of the Research lookup forever — `canResearch` is gated on `manufacturer && model_number`, and the AI prompt has plenty to ground on even when the specific model is missing. To resolve this without weakening the gate, the project writes the literal sentinel string `"unknown"` (lowercase) to `hearth.inventory.model_number` whenever the user-submitted value is null or empty.

The substitution is owned by [`lib/inventory/model-number.ts`](../lib/inventory/model-number.ts) — `normalizeModelNumberForCreate(value)` runs server-side inside [`createInventoryFromDocumentAction`](../app/actions/documents/create-inventory-from-document.ts) before the row insert. The Smart Uploader review stage does **not** pre-fill the user-visible input with `"unknown"` — the displayed UI stays honest about what the photo captured, and the sentinel only appears in the persisted row.

Display surfaces filter the sentinel back out via `displayModelNumber(value)` from the same module, which returns `null` for the sentinel (case-insensitive, whitespace-tolerant — `"unknown"`, `"Unknown"`, `"  UNKNOWN  "` all collapse). Three surfaces combine manufacturer + model_number into an item identifier and all use this helper:

- The detail page title at [`inventory-detail-view.tsx`](../app/(app)/inventory/[id]/inventory-detail-view.tsx) — falls back to `item.name` when the model is the sentinel.
- The dashboard inventory tile meta line at [`dashboard/inventory-preview.tsx`](../app/(app)/dashboard/inventory-preview.tsx) — falls through to the manufacturer-only branch.
- The home inventory list detail line at [`inventory/page.tsx`](../app/(app)/inventory/page.tsx) — same manufacturer-only fall-through.

The convention is **create-time only**. The edit modal does not re-normalize on update — if a user explicitly clears the model field after creation, that's respected, and they'll see the Research gate re-engage. They can re-type `"unknown"` themselves if they want it unblocked again. No backfill of legacy null model_number rows; those continue to render `item.name` as the title since the truthy check already handles the null case.

### Detail page surfaces

- **Hero photo + lightbox** — the server component fetches every `hearth.documents` row with `status='attached'` and `kind IN ('nameplate', 'photo')` for the inventory item, ordered `analyzed_at desc nullsLast, created_at desc`, and passes the full set as `photos: { id, storagePath, thumbnailPath }[]` to `InventoryDetailView`. When `inventory.hero_document_id` is non-null the server reorders the array so that document lands at index 0 — every read site (the hero `<button>`, the lightbox, the modal's photo strip) keeps the simple "`photos[0]` is the hero" contract, so nothing downstream needs to know about the new column. The hero slot renders `photos[0].thumbnailPath` (600px — the same asset the dashboard tile already cached, so the cross-surface navigation typically resolves from sessionStorage). The hero is wrapped in a `<button>` with a `zoom-in` cursor and a small "N" badge in the corner when more than one photo exists; clicking it mounts the `<PhotoLightbox>` defined in [`photo-lightbox.tsx`](../app/(app)/inventory/[id]/photo-lightbox.tsx) at slide index 0. The lightbox wraps `yet-another-react-lightbox` (which owns keyboard nav, swipe gestures, and focus management), signs the 1920px `storage_path` for every slide on open through `createCachedSignedUrl`, and themes the chrome via the library's `--yarl__*` CSS custom properties to match Hearth's surfaces. The Counter plugin shows "N of M" only when more than one slide exists. While a known-present photo's URL is still resolving on a cache miss, a neutral skeleton occupies the slot so the "Add photo" placeholder never briefly flashes for an item that already has one. The dashboard inventory tile and the `/inventory` list also honour `hero_document_id` when present, falling back to the most-recent rule otherwise — the same fall-through fires automatically when the FK is `SET NULL`'d after the chosen photo is deleted.
- **Stat tiles** (Installed / Last Serviced / Next Due) always render all three. Tiles with no underlying date show "Unknown" in tertiary text and drop the relative-time meta line. Layout stays stable across items, and the field is discoverable for the future edit-from-detail flow. The first tile has a fallback rule that swaps its eyebrow to **Manufactured** and shows the decoded manufacture date when `installed_on` is null and the serial-decode pipeline has landed a high-confidence date — see "Serial-number decode pipeline" above for the selector logic and the precision-to-display formatting.
- **Pill cluster** renders the serial number first as the brighter accent pill (`chip chip-ai chip-mono` — the serial is the load-bearing identifier for the physical unit) followed by the AI-extracted spec pills in the order the model returned them, using the muted base `chip` treatment so they don't compete with the SN for attention. The cluster doesn't render at all if both sources are empty.
- **"What we know" panel** is the home for the Research surface. The button is disabled (with a tooltip) when manufacturer or model_number is missing, and is always available when insights already exist so a re-run is one click away. Insights render as up to three subsections (`Overview` / `Service life` / `Maintenance`) with their own eyebrow labels; a section the model returned `null` for simply doesn't render. If all three are null, a small caption explains that no detail was found and invites a re-run. When `found_specific_model: false`, a category-level disclaimer renders above whatever sections came back. A `Sources` subsection renders at the bottom of the panel when `source_urls` is non-empty, listing each URL as a single-line truncated link that opens in a new tab (`target="_blank"` + `rel="noopener noreferrer"`); the model emits this near the end of the stream, so the section quietly appears once the stream is nearly complete, and the renderer filters out any URL that isn't `new URL()`-parseable to avoid a half-typed href briefly flashing while a partial stream chunk is in flight. The panel reads from the in-flight streaming object (via `useObject` from `@ai-sdk/react`) while a call is in progress, then falls back to the persisted `item.ai_insights` once `router.refresh()` after the stream finishes has pulled the new row into view. Each progressively-rendered piece (headline, sections, disclaimer, sources) animates in with a 240ms fade+slide via the `.insights-appear` keyframe so the streaming handoff feels intentional rather than a series of hard layout pops. The brief loading overlay covers only the gap between click and first-token (typically 1–3s); once any field arrives it yields to the streaming content. The panel's empty state, error path, and overlay-with-narration are co-located in `inventory-detail-view.tsx`.

### AI Insights debug log

Every call to the streaming route appends one block to `logs/ai-insights-prompts.log` from inside the `onFinish` callback. Each block carries the timestamp, model name, total duration (start-of-call to onFinish-resolved), the structured input, the full system + user prompts, the response JSON (or `(no response)` if the call errored before producing one), and an error line on failure. The `logs/` folder is gitignored — the log is a local-only iteration aid for prompt and model experimentation, never committed. All writes are swallowed in a try/catch so a logging failure can never break the user request.

### Deliberately deferred

These appear in the page layout but are intentionally **not wired to real data** in this phase:

- The **Notes & photos** panel — depends on a notes data model that doesn't exist yet.
- The **Maintenance & history** panel — depends on a maintenance-log table that doesn't exist yet. The single timeline row showing `installed_on` is the only real data point on the panel today.

---

## Inventory edit and delete

The **EDIT DETAILS** button on `/inventory/[id]` (sitting next to the title) opens a modal that exposes every editable column on `hearth.inventory` and houses the destructive **Delete this item** flow. The modal is the only edit surface today — there is no inline-edit on the detail page itself.

### Component layout

```
components/
  edit-inventory-item-modal.tsx          # main edit modal (this section)
  delete-inventory-item-confirm-modal.tsx # nested confirmation modal
app/actions/inventory/
  update-item.ts                         # updateInventoryItemAction
  delete-item.ts                         # deleteInventoryItemAction
lib/inventory/
  research-significant-fields.ts         # pure helper for stale-insights detection
  research-significant-fields.test.ts    # Vitest coverage
```

### Modal mechanics

`EditInventoryItemModal` reuses the conventions of [`EditHomeDetailsModal`](../components/edit-home-details-modal.tsx) — scroll-lock, focus-trap, ESC, return-focus, the `surface-ai` shell, the `FieldText` / `FieldSelect` helpers, and the shared `<DatePicker>` and `<MonthPicker>` components for any date input (see "Custom date and month pickers" further down). The parent (`inventory-detail-view.tsx`) mounts the modal **conditionally on `editOpen`** rather than mounting it permanently and gating with the `open` prop. This is the deliberate alternative to a reset-in-effect: every reopen is a fresh React mount, so `useState(initial)` re-initializes from the latest `item` snapshot without tripping `react-hooks/set-state-in-effect`. The same conditional-mount discipline applies to the nested delete-confirm modal — it mounts only while `deleteOpen` is true, so the "Also delete linked documents" checkbox is freshly defaulted to checked on every open.

The shell width is `max-w-3xl` (matching `HabitatFindingModal`) so the Service tracking row can fit Manufactured / Installed / Last serviced / Next due on a single line at desktop widths via `sm:grid-cols-2 lg:grid-cols-4`. Mobile rendering is unchanged — below the `sm:` breakpoint the modal stays full-width with the existing padding. **Backdrop clicks intentionally do not close the modal**: only ESC, the X button, and Cancel dismiss it. Accidental outside-clicks while editing fields used to wipe in-progress work — same trap any reviewer of this surface should preserve.

The form is sectioned into Identity, Classification, Service tracking, Notes, **Hero photo**, and a **Danger zone** at the bottom — a red-tinted bordered region styled after the GitHub pattern so a destructive action can't be fat-fingered while editing fields. The danger-zone button opens the nested confirm modal rather than firing the delete itself.

### Manufacture date input

The Service tracking section's first field is a `<MonthPicker>` for the manufacture date (issue #105, picker swapped in #107). It writes to the same six columns the serial-decode pipeline uses (`manufacture_date`, `manufacture_date_precision = 'month'`, `manufacture_date_confidence = 'high'`, `manufacture_date_model = 'user-entered'`, `manufacture_date_decoded_at = now()`, `manufacture_date_reasoning = null`), so the detail page's "Manufactured" tile fallback (in `pickFirstDateTile`) lights up for both decoded and user-asserted values without any helper change. Clearing the field nulls all six columns in the same UPDATE. The picker's lenient parsing handles all three prior shapes on prefill: `YYYY-MM` shows exact, decoded `YYYY` renders as January of that year, and the rare ISO-week (`YYYY-Www`) precision the picker can't represent falls through as no selection — the underlying state preserves the raw string so a save without a touched field round-trips the value unchanged. Manufacture date is **not** part of `researchSignificantFieldsChanged()` and a manufacture-date-only edit does not invalidate `ai_insights` — research grounds on manufacturer + model_number, and the decoded date is a separate axis.

### Hero photo selection

The Hero photo section (issue #105) sits between Notes and the Danger zone and is hidden entirely when the item has no attached photos. The detail page's server component passes the same photo list it uses for the hero / lightbox into the modal as a prop (`photos: { id, thumbnailPath }[]`) — the modal stays a pure render of its props and never queries Supabase itself. Each thumbnail is an 80px square wrapping `useCachedSignedUrl("hearth-documents", thumbnailPath, null)` so the URL string is cached across navigations (same pattern as the dashboard inventory tile). The currently-selected thumbnail gets a 2px accent ring (`box-shadow: 0 0 0 2px var(--color-accent)`) and an accent checkmark badge in the top-right corner; tapping a thumbnail toggles it (re-tapping the selected thumbnail clears the selection, which writes `hero_document_id: null` on save). If the stored `hero_document_id` points at a document that isn't in the current photo list (e.g. it was deleted and the FK SET NULL hasn't propagated, or the doc fell out of the kind filter), the modal treats the selection as "none" rather than painting a phantom highlight.

### Server actions

- **`updateInventoryItemAction`** — single `UPDATE` against `hearth.inventory`. Loads the existing row first so it can detect when manufacturer or model_number changed and clear the now-stale `ai_insights` in the same write. RLS scopes both the read and the write through `hearth.houses.owner_id`. Returns `{ researchInvalidated: boolean }` so the client knows whether to re-run the Research panel. Owns the six-column manufacture-date write contract described under "Manufacture date input" above, and the `hero_document_id` write (FK constraint at the DB enforces validity — invalid ids surface through the existing `result.error` path). `revalidatePath`s `/inventory/[id]` and `/dashboard` so the detail view re-renders with the new values and the dashboard's inventory tile picks them up.
- **`deleteInventoryItemAction`** — accepts `{ inventoryId, cascadeDocuments }`. Two modes:
  - `cascadeDocuments: true` (the modal's default) — fetches every `hearth.documents` row with `inventory_id` matching, deletes the rows (authoritative), best-effort `storage.remove()`s the optimized + thumbnail object paths for each (same trade-off as `cleanupDocumentAction` — orphaned bytes land in a future periodic sweep rather than blocking the delete), then deletes the inventory row.
  - `cascadeDocuments: false` — deletes only the inventory row. The FK constraint on `hearth.documents.inventory_id` is `ON DELETE SET NULL`, so linked documents survive as unattached items in the user's house — useful for keeping a receipt for tax records after replacing the appliance it was tied to.

  Ordering matters in the cascade path: docs are deleted before the inventory row so a transient docs-failure doesn't leave the user with a vanished appliance and lingering attachments. Storage cleanup runs between the doc-row delete and the inventory-row delete; a failed storage call leaves orphaned bytes for a future periodic sweep rather than blocking the operation.

### Research re-run on key-field edits

When the user edits manufacturer or model_number, the previously-generated `ai_insights` is grounded on the *old* values and is stale (issue #57). The flow has three coordinated parts:

1. **Pure detector** — `researchSignificantFieldsChanged(before, after)` in `lib/inventory/research-significant-fields.ts` compares the two research-grounding fields. Trim/case-insensitive (so " Whirlpool" → "whirlpool" is not treated as a change worthy of burning a Sonar call). Lives outside the server-action file specifically so it can be Vitest-covered without pulling in `"use server"` + Supabase imports. `type` was previously a third grounding field but was relaxed in issue #69 — it's organizational rather than substantive (the same physical AC is the same AC whether the user files it under `system` or `exterior`), so type-only edits no longer burn a Sonar call. Category framing in the prompt fixes itself on the next manual "Research again".
2. **Server-side invalidation** — `updateInventoryItemAction` runs the detector inside the same query path, writes `ai_insights: null` in the same `UPDATE` when invalidation fires, and returns `researchInvalidated: true`.
3. **Client-side re-trigger** — `inventory-detail-view.tsx` lifts the Research lookup out of `ResearchPanel` so it can be triggered both by the panel's button and by the edit modal's `onSaved` callback. The callback sets a ref flag that a `useEffect` consumes on the next render (after `router.refresh()` has pulled the cleared insights into view), which calls `clearResearch()` to drop any prior streamed object and then `submit({})` on the `useObject` hook to fire the streaming POST.

The split between "did key fields change?" (pure helper, server-side check) and "kick off the new lookup" (client-side, fires the streaming hook) keeps the user-visible save fast — the modal dismisses immediately and the Research panel starts streaming a moment later as the new call proceeds in the background.

### What the page-level server component fetches for the modal

In addition to the inventory row, [`/inventory/[id]/page.tsx`](../app/(app)/inventory/[id]/page.tsx) fetches the house's rooms (`id, name`, ordered by `sort_order`) for the Room select, a `count: 'exact', head: true` query on `hearth.documents` filtered by `inventory_id` for the cascade-checkbox copy ("Also delete N linked documents"), and the photo list (the same `documents` query the hero / lightbox use, now selecting `id` alongside `storage_path` / `thumbnail_path` so the modal can persist a chosen hero). All three queries fan out in `Promise.all` alongside the single-item load — no client-side fetching shim added.

### Post-delete navigation

The delete-confirm modal's `onConfirm` closes both modals on success and the parent's `onDeleted` callback fires `router.replace("/inventory")` — the home inventory list is the natural landing for "where did my appliances go?".

---

## Property: the fourth inventory type

`property` is the fourth `hearth.inventory.type` value, added alongside `appliance | system | exterior`. It covers things the homeowner *owns* that aren't part of the house itself — vehicles, electronics, instruments, art, tools, jewelry, pets. The conveyance line is the framing rule: appliance/system/exterior items convey at sale; property leaves with the owner. This is also the line the insurance industry draws between dwelling and contents.

### Subtype discriminator

`hearth.inventory.subtype` is a nullable column on every row. v1 recognizes two concrete property subtypes:

- **`vehicle`** — cars, trucks, motorcycles. The VIN lives in `serial_number` (the Smart Uploader's nameplate flow already lands a photographed VIN there with no special-case code; the detail page re-labels the column "VIN" for vehicles). `metadata` carries `license_plate`, `license_plate_state`, `model_year`, `purchased_from`, and the `vin_decode` payload.
- **`pet`** — dogs, cats, anything else the user wants to track. `metadata` carries `species`, `breed`, `color`, `sex`, `microchip_number`, `vet_name`, `vet_phone`, `adopted_on`. Pets are a property subtype because the conveyance test holds (a pet leaves with the owner) and the documents-and-reminders pattern fits (vet records, vaccinations, microchip number, medication renewals). The dedicated pet experience is deliberately small at v1 — richer vet-record / vaccination surfaces are follow-up work.

For other top-level types (`appliance` / `system` / `exterior`) the column is always null. For generic property without one of the two recognized subtypes (a TV, a stereo, art, jewelry), the column is also null — those items ride the generic property path.

### Schema philosophy

The column shape is deliberately small: three new columns (`subtype`, `purchased_on`, `estimated_value_cents`) plus a `metadata jsonb` bucket. The principle that should govern future inventory work:

> A field gets its own column only when it has a proven cross-row query pattern (WHERE/ORDER BY/aggregation across many rows) or it applies broadly across most inventory types. Otherwise it goes in `metadata`. Promote from JSONB to a column later if a query pattern emerges — don't speculatively column up front.

`estimated_value_cents` earns a column because the insurance-inventory report's value aggregation (`select sum(estimated_value_cents) where type='property'`) is exactly that cross-row pattern. `purchased_on` earns a column because it's broadly meaningful across all inventory types (and is a date — date columns get index-friendly comparison cheaply). License plate, model year, microchip number — none of those have proven cross-row query patterns yet, so they live in `metadata`.

### Validation: `lib/inventory/metadata-schemas.ts`

Per-subtype Zod schemas are the single source of truth for what `metadata` may contain. The edit modal validates user input through these schemas before writing; the VIN-decode route writes through them; any renderer reading `metadata` calls `parseVehicleMetadata` / `parsePetMetadata`, both of which return `{}` for any input the schema rejects. The DB column stays jsonb — only the application layer validates — so older app versions writing a different shape don't crash the renderer, they just produce an empty bag.

The metadata-schemas module also exports `isValidVin(raw)` — the 17-character VIN format check (alphanumeric, excludes I/O/Q) — which the detail page's Decode VIN button uses as a client-side gate and the API route re-applies as defense in depth.

### Smart Uploader awareness

The classify-and-extract prompt at [`lib/documents/ai/prompt.ts`](../lib/documents/ai/prompt.ts) treats `property` as a fourth valid `type` value, with explicit guidance: vehicles photographed at the VIN plate or the car badge land as `type='property'` with `subtype='vehicle'` and the VIN in `serial_number`; pets photographed as identifying documents (vet records, microchip cards, registrations) land as `subtype='pet'`. Generic property (TV nameplate, computer service tag, stereo back panel) stays `subtype=null`. The Zod schema at [`lib/documents/ai/schema.ts`](../lib/documents/ai/schema.ts) carries the `subtype` field on every classification branch — required, nullable.

The Smart Uploader's review stage extends the Type select with a "Property" option and reveals a "Property kind" sub-select when property is chosen. The review stage save flow passes `subtype` into `createInventoryFromDocumentAction`; the action defensively coerces `subtype` to null whenever `type !== 'property'` so stale UI state can't produce semantically-wrong rows.

The room-fallback table at [`components/smart-uploader/match-room.ts`](../components/smart-uploader/match-room.ts) maps `property → Garage`. That's a deliberate vehicle-leaning default — the VIN is the most VIN-shaped photo a homeowner is likely to capture first, and a vehicle in the Garage is the unsurprising place to find it. A pet or TV will land there too; the user can pick a different room from the dropdown.

### Detail page rendering

The inventory detail page at [`app/(app)/inventory/[id]/inventory-detail-view.tsx`](../app/(app)/inventory/[id]/inventory-detail-view.tsx) is type-aware:

- **Breadcrumb / eyebrow.** Property rows show "Property" in the breadcrumb; the eyebrow above the title shows the subtype word (Vehicle / Pet) when one is set, falling back to "Property" otherwise.
- **Title.** Non-vehicles still use the existing Manufacturer + Model display rule. Vehicles use the row's `name` as the title — for a Toyota Land Cruiser the name is already "Toyota Land Cruiser" and synthesizing "Toyota Land Cruiser" again from Manufacturer + Model would just duplicate it.
- **StatTiles.** Property rows drop the Last serviced / Next due / Installed tiles (none apply) and replace them with Purchased / Estimated value / [Model year for vehicles | Acquired for pets]. The "Manufactured" decode fallback is also dropped for property — the model year for a vehicle lives in `metadata.model_year`, not the manufacture-date pipeline.
- **PillCluster.** For vehicles the existing serial-number pill is relabeled "VIN" and a second `[state] Plate · [plate]` chip surfaces when plate metadata is set. For pets and generic property the pill cluster works exactly as before.
- **PropertyDetailsBlock.** A new component below the pill cluster surfaces subtype-specific content. For vehicles it carries the "Decode VIN" button (with re-decode affordance after a successful decode) and the decoded NHTSA facts (body class, engine cylinders, fuel, drive, country of manufacture) as chips. For pets it surfaces a chip cluster of species/breed/color/sex/microchip/vet.
- **Research panel.** Replaced for property with a `PropertyInsightsPlaceholder` that explains depreciation / replacement-value (for vehicles), the dedicated pet experience (for pets), or generic property follow-ups are on the roadmap. The "Research this model" lookup is tuned for appliances and systems and doesn't apply to property today.

### VIN decode pipeline

The "Decode VIN" action on a vehicle posts to [`/api/inventory/[id]/decode-vin`](../app/api/inventory/[id]/decode-vin/route.ts). The route is deterministic — no LLM, no API key, no model selection — it just calls NHTSA's free DecodeVinValues endpoint at `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json` and writes the trimmed result into the row.

**Endpoint choice is load-bearing.** NHTSA has two siblings: `/DecodeVin/` returns `Results: [{ Variable, Value }, ...]` where `Variable` is the human-readable label ("Model Year" with a space). `/DecodeVinValues/` returns `Results: [{ flat camelCase object }]` where keys are `ModelYear`, `EngineCylinders`, etc. Hearth uses the values endpoint so the field names are self-consistent end-to-end. The first cut of this code used the labelled endpoint with camelCase field names; Make and Model worked (single-word labels match either shape) but ModelYear silently fell through because the underlying Variable was "Model Year" with a space. Don't switch back.

The module at [`lib/vin-decode/decode.ts`](../lib/vin-decode/decode.ts) owns the wire format and parsing:

- `VIN_REGEX` and `isValidVinFormat()` enforce the 17-character VIN shape (alphanumeric, excludes I/O/Q to avoid ambiguity with 1/0). The route applies the same check the client used as a defense-in-depth gate.
- `buildNhtsaDecodeUrl()` builds the endpoint URL — kept as a one-liner helper so a future swap (DecodeVinValuesExtended, a different API) is one line.
- `extractVinFields()` cherry-picks the handful of NHTSA variables we surface (`Make`, `Model`, `ModelYear`, `BodyClass`, `VehicleType`, `EngineCylinders`, `FuelTypePrimary`, `DriveType`, `Manufacturer`, `ManufacturerId`, `PlantCity`, `PlantState`, `PlantCountry`) from the ~130 NHTSA returns per VIN, and collapses NHTSA's sentinel values (`""`, `"Not Applicable"`, `"Not Available"`, `"0"`) to null so the renderer's "render only if present" rule doesn't paint stub strings as facts.

**Persistence policy** (write only when empty, except where noted):

- `metadata.vin_decode` — **always overwrites** with the fresh payload (the user clicked decode; they want the latest read). Carries `source: "nhtsa_vdecoder"`, `decoded_at: <iso>`, and the trimmed `raw` map.
- `manufacturer` — written from NHTSA's `Make` (title-cased — NHTSA returns SCREAMING CAPS) when the column is empty.
- `model_number` — written from NHTSA's `Model` when the column is empty.
- `metadata.model_year` — written from NHTSA's `ModelYear` when not already set.
- `name` — **rewritten** to `"YYYY Make Model"` when the row's current name is empty or matches a small generic-vehicle vocabulary (`truck`, `car`, `vehicle`, `suv`, `van`, `motorcycle`, `my car`, etc. — see `GENERIC_VEHICLE_NAMES` in the route). A personalized name like "Beth's Car" or "Dad's Truck" is preserved. This is the one place we override user input by design; the rationale is that "Truck" carries no information the dashboard tile can use, and `2018 Toyota Land Cruiser` does.
- **Manufacture-date columns** (`manufacture_date`, `manufacture_date_precision`, `manufacture_date_confidence`, `manufacture_date_decoded_at`, `manufacture_date_model`, `manufacture_date_reasoning`) — written with year precision, high confidence, and `model = 'vin-decode-nhtsa'` when `manufacture_date` is currently null. The row's model year doubles as a year-precision manufacture date (for most production runs the two coincide; VIN position 10 encodes only the model year letter). Same write contract as the serial-decode pipeline and the user-entered manufacture date, so the detail page's "Manufactured" tile fallback (in `pickFirstDateTile`) lights up for vehicles without any additional UI work. Existing manufacture-date values — from a prior serial decode or the user — are preserved.

**Anything the user explicitly entered wins** for the structured columns, with the deliberate exception of the name rewrite documented above.

A 10-second AbortSignal timeout guards against transient NHTSA outages. Failures (invalid VIN format, NHTSA unreachable, empty NHTSA response) surface inline as `decodeError` rather than blowing up the page. The route's JSON response carries both the raw decode and an `applied` block telling the client which structured fields were actually written, so the success toast can surface the canonical "YYYY Make Model" string rather than re-deriving it from the raw response.

### Deferred for the property type

These are deliberately out of scope for the initial property landing; the schema supports them but the surfaces aren't built:

- **Renewal reminders** (registration, insurance, microchip renewal, vet appointments). The reminder engine generalizes beyond vehicles and pets — warranty expirations, appliance recalls, jewelry rider renewals — and warrants its own focused design pass. The data model captures the dates the user provides today; surfacing reminders from them is the follow-up.
- **Vehicle maintenance.** Hearth is not becoming a vehicle maintenance app. No mileage tracking, no service intervals, no MPG. The rule stays: Hearth stores documents and reminds on dates that appear *in* documents.
- **Insurance valuation lookups.** `estimated_value_cents` is user-entered for v1. Auto-fetched depreciation curves (electronics) or KBB (vehicles) are enrichment on top of the field, not a prerequisite for adding it.
- **VIN-based document entity resolution.** Auto-associating a registration PDF with an existing vehicle row by VIN match belongs to the renewal-reminder follow-up. The data is there in `serial_number` for that work to consume; no schema change is needed when it ships.
- **Multi-vehicle households and family sharing.** Same posture as multi-property — household-level sharing remains a premium-tier feature for later.

---

## Custom date and month pickers

`<DatePicker>` and `<MonthPicker>` (issue #107) are the only date input primitives in the app — native `<input type="date">` and `<input type="month">` are no longer used. The native widgets came with a system-blue, square-cornered popup chrome that couldn't be CSS-styled into the Hearth palette no matter how much `accent-color` or `::-webkit-calendar-picker-indicator` filtering we threw at it; the custom pickers replace that popup wholesale while preserving the underlying wire format (`YYYY-MM-DD` for date, `YYYY-MM` for month) so server actions and stored values didn't change.

### Component layout

```
components/
  picker-popover.tsx   # shared portal + position + focus + ESC mechanics
  date-picker.tsx      # input-styled trigger + react-day-picker popup
  month-picker.tsx     # input-styled trigger + custom year stepper + 4x3 month grid
```

`<DatePicker>` and `<MonthPicker>` share the same API shape — `{ label, value, onChange, placeholder? }` — and the same trigger visual: a `.picker-trigger` button styled identically to `.input` with the date display (or placeholder copy in tertiary text) on the left and a small calendar icon on the right. Both render the popup body inside a `<PickerPopover>`.

### PickerPopover mechanics

`<PickerPopover>` renders through a React portal to `document.body` so the popup escapes the host modal's `overflow: hidden` clip. It positions itself viewport-aware — anchored below the trigger by default, flipping above when there's more room above than below — and clamps horizontally so it never escapes the viewport edges. Mounted via a single `useLayoutEffect` listener so it re-runs on resize and on any scroll in the document tree, keeping the popup glued to the trigger as the modal scrolls.

The popover owns the close mechanics for both pickers so consumers don't have to:

- A transparent click-eater overlay (positioned `fixed inset-0`) calls `onClose` on `onMouseDown` and `stopPropagation`s the event so a parent modal that listens for backdrop clicks (`EditHomeDetailsModal` still does, by design — `EditInventoryItemModal` does not after #105) doesn't also fire and close the modal behind the popover.
- ESC and Tab are intercepted at the document level with `{ capture: true }` so they land on the popover before any ancestor modal's bubble-phase listener. ESC closes only the popover and `stopPropagation`s the event. Tab cycles focus inside the popover card rather than letting focus escape back into the modal form.
- Initial focus moves into the popover on open (the first focusable inside the card), and on close focus is returned to the trigger so keyboard navigation picks up where the user left off.

The popup card itself uses the `surface-ai` class so it inherits the same diagonal accent halo + warm dark fill the modals it opens out of already use. A `.picker-popover-card` rule layers a softer elevation shadow on top so the popover reads as floating above the modal surface. The open transition is the existing `.insights-appear` keyframe (240ms fade + 3px slide) — same handoff used by the Research panel's streaming chunks, so the visual language is consistent across surfaces.

### DatePicker

The date picker wraps [`react-day-picker`](https://react-day-picker.dev) v10 in single-selection mode with the displayed month controlled externally (`month` + `onMonthChange`) and a custom `MonthCaption` component that renders the month name alongside a `<YearSelect>` chip. `startMonth` / `endMonth` are bounded to 100 years back / 10 years forward from today, which is also the range the YearSelect uses. The library's own stylesheet is **not imported** — the `.rdp-*` classes the library emits are styled from scratch in [app/globals.css](../app/globals.css) so the day grid, navigation chevrons, weekday headers, today indicator, and selected-day fill all match Hearth's palette. The selected day uses `var(--color-accent)` as a solid fill; today (when not selected) gets an inset accent-tinted ring; out-of-month cells are dimmed.

The custom caption skips react-day-picker's `captionLayout="dropdown"` mode on purpose — that mode uses native `<select>` elements whose popups (a) ignored the document's dark color-scheme on older Chromium builds and rendered white-on-everything, (b) couldn't be padded or sized, and (c) showed all 110 years in a skinny full-viewport column. The `<YearSelect>` chip uses the same trigger styling the native dropdown would have had but opens a custom Hearth-themed list (see "YearSelect" below).

Local-time conversion is owned in `date-picker.tsx` so a `new Date("2025-10-24")`-style UTC parse doesn't cause display dates to shift back a day in negative-UTC time zones. The picker speaks `YYYY-MM-DD` strings via `dateFromIso` / `isoFromDate` helpers that use local-time accessors (`getFullYear`, `getMonth`, `getDate`).

Two footer affordances live below the day grid: **Clear** (writes `""` and closes) and **Today** (selects today and closes). Both are styled as accent-colored text buttons via `.picker-popover-link`.

### MonthPicker

The month picker is custom (no library). The popup is a year header — `◀ 2026 ▼ ▶` — above a 4×3 grid of month cells (`Jan` through `Dec`). The center element is the same `<YearSelect>` chip the date picker uses; the flanking chevrons handle ±1 year nav with `disabled` states at the bounds. Same 100-back / 10-forward year range as the date picker. Selected month cells fill with the accent; today's month-year combination gets the same inset accent ring as today's day in the date picker; hover/focus on any cell brightens it with the accent-tinted background mix the rest of the surface-ai surfaces use.

### YearSelect

`<YearSelect>` ([year-select.tsx](../components/year-select.tsx)) is the shared year picker used inside both the date picker's custom caption and the month picker's header. Trigger is a chip showing the current year + chevron-down; clicking it opens a 92px-wide, 240px-tall list of years (descending — recent on top) anchored below the trigger. The selected year is auto-scrolled into view on open and receives focus so keyboard users can navigate immediately.

Two ownership decisions that matter:

- **Close mechanics live in YearSelect, not PickerPopover.** The component owns its own outside-click and ESC handlers and does **not** `stopPropagation`. If the click was inside the calendar popover (but outside the year list), only the year list closes. If the click was outside the calendar popover entirely, the YearSelect closes here and the popover's own overlay handler still fires to close the calendar — the natural cascade.
- **The list renders as an absolute child of the popover card, not a portal.** The `surface-ai` card it lives in doesn't clip, so portal-mounting would add complexity for no gain. The list's `position: absolute` + `top: calc(100% + 4px)` sits right under the trigger.

`parseValue` accepts the three legacy shapes from the manufacture-date pipeline: `YYYY-MM` (preferred, exact), `YYYY` (decoded values from the serial-decode pipeline — rendered as January of that year), and anything else (notably ISO `YYYY-Www`) as no selection. `onChange` always emits a canonical `YYYY-MM` string, or `""` when cleared. The year header is initialized from the selected year (or the current year if no value) on every open, so prior navigation on one open doesn't bleed into the next.

Footer affordances mirror the date picker: **Clear** and **This month** (which writes the current calendar month and closes).

### Why custom over the native widgets

The native `<input type="date">` / `<input type="month">` popup is a Chromium dialog — `accent-color` reaches some selection cells but the popup's panel chrome (square corners, system font, panel background, "This month" link color) is fundamentally not stylable from CSS. The shim in `globals.css` that tried to invert the calendar-picker-indicator icon and tint the accent was the proof of what *isn't* achievable with the native widget. Replacing the widget entirely is the only path to a popup that visually matches the rest of the surface — and once the popup is custom anyway, the trigger becomes a styled button instead of a faux-input, which sidesteps the empty-state "dashes" problem the month input has on Chromium without needing the CSS overlay trick #105 introduced.

The `react-day-picker` dependency is the only third-party UI dep added by this work. The month picker is intentionally custom: a 4×3 grid of buttons doesn't need a library's worth of abstraction, and keeping it in-house means we own the visual contract for the most-touched picker in the inventory edit flow.

---

## Smart Uploader modal and dashboard wiring

The Smart Uploader is the user-visible composition of phase 1's plumbing — the modal that homeowners actually interact with when they tap **+ Add** in the top nav. It owns the path-picker → capture → process → analyze → review → save flow end-to-end, calls the seven server actions in [app/actions/documents/](../app/actions/documents/), and writes nothing to storage or to `hearth.documents` that the client-side library helpers and server actions didn't already own.

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

- **`.page-sheet` utility class** lives in [`app/globals.css`](../app/globals.css), scoped inside `@media (max-width: 639.98px)`. It sets `height: 95dvh`, `width: 100%`, and `border-radius: var(--radius-lg) var(--radius-lg) 0 0`. The class deliberately sits in the same unlayered space as `.surface-ai` because Tailwind v4 puts its utilities in the `utilities` cascade layer — unlayered CSS outranks layered, so a Tailwind `sm:rounded-t-*` would lose to `.surface-ai`'s shorthand `border-radius` declaration. Keeping the override in raw CSS is the only way the top-rounded shape actually paints.
- **`.surface-ai::before` pseudo-element** uses `border-radius: inherit`, so the accent gradient hugs the same top-rounded shape on mobile with no extra rules.
- **Drag handle** is a 1px × 40px rounded pill rendered above the header, styled in `--color-border-emphasis`. It is `sm:hidden` so desktop never paints it, and it doubles as the start of the dismissal touch target.
- **Swipe-to-dismiss** is implemented inline in `SmartUploader.tsx`: `onTouchStart` / `onTouchMove` / `onTouchEnd` are bound to the drag-handle div *and* the header — not to the scrollable content area below, so vertical content scroll never collides with a dismissal gesture. The handler tracks a single `dragOffset` in component state, applies `transform: translateY(...)` while the gesture is active, snaps back via a 200ms CSS transition on release, and dismisses through the existing `handleClose()` (which keeps the mid-flow cleanup contract intact) when the cumulative downward delta crosses `SWIPE_DISMISS_THRESHOLD_PX` (120). A `matchMedia("(max-width: 639.98px)")` guard in `onDragStart` makes the gesture a no-op on touch-screen laptops where the dialog is the centred desktop modal.
- **Sheet height vs. inner scroll** — the outer dialog is `flex flex-col overflow-hidden` and its content region is `flex-1 overflow-y-auto`, so the sheet's outer dimensions stay locked at 95dvh while the active stage scrolls within whatever space remains under the header. This is the same flex shape the dialog already used; the only change is dropping `max-h-[100dvh]` for a hard `height` so the surface no longer shrinks to fit short stages.

The pattern is the page-sheet half of a deliberate split documented in issue #56: page-sheet for **multi-step / content-heavy** flows (this one; future siblings for documents and emergency-procedure videos when those paths come online), and a smaller fixed-height bottom-sheet for **single-action** prompts (confirms, quick pickers) that hasn't been built yet. New multi-step capture flows should reuse `.page-sheet` plus the same drag-handle + touch-handler shape rather than rolling their own; once a second consumer lands it's worth extracting the shell into a `<PageSheet>` primitive, but two callers is the bar.

### CaptureStage dropzone

The empty state of [`CaptureStage`](../components/smart-uploader/stages/CaptureStage.tsx) is a bounded drag-and-drop region on desktop and a tap-to-open target on touch — both paths funnel through the same `onPickFile` prop, so the rest of the pipeline never sees which gesture initiated the upload. The container is a plain `div` (clickable, but not focusable) wrapping a single focusable "Choose from your computer" button — no nested-interactive-elements anti-pattern, but tapping anywhere in the dashed region still opens the picker so mobile keeps its one-tap behaviour. Drag handlers `preventDefault` on `dragover`/`drop` (the browser otherwise navigates to the file's local URL), use a `currentTarget.contains(relatedTarget)` check on `dragleave` to keep the active-border highlight from flickering as the cursor moves across child elements, and a window-level `dragend` listener resets state if the user releases outside the modal. Non-image drops are validated against `file.type.startsWith("image/")` before `onPickFile` fires — same gate the dashboard photo upload uses, with the same inline "Please choose an image file." message under the dropzone. Multi-drops are deliberately truncated to `dataTransfer.files[0]` since the Smart Uploader is one-photo-at-a-time.

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

The home-details modal *also* dispatches the `HOUSE_UPDATED_EVENT` because `useHouseRealtime` is unreliable in some browsers (see "Cross-tree refresh signal" elsewhere in this guide). Smart Uploader does *not* dispatch a custom event because the dashboard's inventory tiles are server-rendered, not driven by a Realtime hook — a server-component re-render is the only signal the surface listens for, so `router.refresh()` is sufficient.

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

---

## Reports page (mockup)

`/reports` is the central hub for Hearth's synthesis reports — documents generated from the homeowner's ingested data, each tuned to a specific reader (carrier, adjuster, buyer's agent, contractor, family member, or the homeowner themselves). The page that ships today is **UI-only**: the report taxonomy, naming, and visual treatment are locked in, but every Generate button is visibly disabled with a "Coming soon" indicator. No generation logic, no PDF rendering, no tier gating.

The page exists first because most of the reports depend on the maintenance module to deliver meaningful intelligence — service-life forecasts adjusted for habitat findings, cost projections built on the maintenance task model, structured inventories with service history. Shipping the page shell ahead of the engines lets us validate the taxonomy with real users, surface exactly what data the maintenance module needs to capture, and give the rest of the product a destination URL to deep-link into.

**Route and navigation.** Server component at `app/(app)/reports/page.tsx`, no data fetching — the report inventory is a static const in the file. Reachable from the desktop sidebar (between "Home inventory" and "How it Works") and the mobile bottom nav (which moved from a three-column to a four-column grid to accommodate the entry). Both nav surfaces use the `file-text` icon.

**Three groups, in this order.**

- **Forward-looking** — the most novel surface, leads the page. Houses the **10-Year Home Improvement Forecast**, the **Forecasted Maintenance Cost Report**, and the **Capital Planning Timeline** (a visual companion to the 10-year forecast that may end up as a view inside that report rather than a standalone export — decided when the engine lands).
- **Retrospective** — documentation of what is. Houses the **Insurance Inventory & Annual Refresh Packet**, the **On-Demand Claim Packet**, and the **Pre-Listing Export Package**.
- **External stakeholder** — documents shaped for someone outside the household. Houses the **Underwriting / Binding Packet** (with an explicit honest-framing caveat that it's homeowner input, not an inspection substitute), the **Contractor Briefing Packet** (will eventually compose with the contractor magic-link feature), and the **Family / Co-Owner Summary**.

**Card composition.** Each report renders as a `surface` card with: an accent-tinted icon medallion in the top-left, the report title, a 2–3 sentence description hinting at the intelligence layer ("adjusted for your home's specific conditions" rather than "based on your data"), an optional italic caveat line beneath the description (underwriting only today), a wide 16:9 preview placeholder (decorative gradient + icon + stub line bars — reads as a document preview rather than a missing photo, and intentionally doesn't commit to a specific paginated layout the real generator may not produce), and a footer row pairing a `Coming soon` chip with a disabled `Generate` button. Cards lay out on an `auto-fill` grid at `minmax(320px, 1fr)` so they widen on desktop and collapse to one column on phones.

**Deliberately not yet present.** Per-report generation engines, PDF rendering, background jobs, premium / free tier gating, analytics, distribution flows (email, share links). Each is its own focused project tracked outside this issue.

---

## Auth and routing

### Sign-in surfaces

- `/` — public landing. Full-bleed pencil-style architectural sketch of a home with four floating annotation panels (Air Quality, Home Facts, Water Quality, Ground) baked into the image, overlaid by a centered translucent card carrying the Hearth wordmark, h1 tagline, and primary Sign in CTA. The annotation panels deliberately mirror the Habitat surface's visual language (dark slate fill, thin amber left-rule, ALL-CAPS titles) so the page previews what the product actually does rather than functioning as a generic marketing splash. Asset lives at `public/landing/hero.png` (PNG, not JPG, to preserve sketch fidelity); the card uses `color-mix` against `--color-bg-base` at 90% opacity so light/dark token swaps still work without hardcoding. One-screen poster — no below-the-fold marketing content is planned for this surface. Signed-in visitors redirect to `/dashboard` from the page's server component before any of this renders.
- `/login` — public page with two paths: Supabase **magic-link OTP** (`signInWithOtp` → emailRedirectTo `/auth/confirm`) and **Google OAuth** (`signInWithOAuth` → redirectTo `/auth/callback`).
- `/auth/callback` — OAuth code exchange handler.
- `/auth/confirm` — OTP token verification handler.
- `/auth/signout` — POST route that calls `supabase.auth.signOut()`.

### Route protection: `proxy.ts` → `lib/supabase/proxy.ts`

The proxy runs on every non-static request and does four things in order:

1. **Refresh session** via `supabase.auth.getUser()`. Cookie reads/writes are mirrored into the response so the session stays warm across navigations.
2. **Auth gate**: if there is no user and the route is not public (`/`, `/login`, `/auth/*`), redirect to `/login`.
3. **Onboarding gate**: if there is a user, the route is protected, and the path is neither `/onboarding` nor `/houses/new`, run a `select id, count exact, head true` against `hearth.houses`. If the count is zero, redirect to `/onboarding`. `/houses/new` is exempt here because it has its own gate below (zero-house users navigating directly to it still get bounced to `/onboarding`, but via the add-property gate rather than this one).
4. **Add-property gate**: if the path is `/houses/new`, run two queries in parallel — the house COUNT and a thin `plan_tier, is_admin` read from `public.profiles`. Bounce to `/onboarding` if the user has zero houses; bounce to `/dashboard` if neither `is_admin` nor `plan_tier === 'premium'` (matching `canCreateAdditionalHouse`). The page itself re-checks both as defense in depth; the proxy gate runs first so a stale-session direct hit never even renders the page shell.

The onboarding gate adds one cheap COUNT query to every protected request; the add-property gate adds two queries but only on `/houses/new`, which is rare. Intentionally simple for now; revisit (cache, move to a layout, or set a flag on the user) if it shows up in perf work.

### Authenticated layout

The `app/(app)/layout.tsx` mounts a single `<AppShell>` (top nav, bottom nav on mobile, desktop sidebar) around every authenticated route. Onboarding lives inside this shell intentionally — the user is signed in, and the navigation chrome is the same surface they'll use after they finish.

---

## Onboarding flow

The first end-to-end data flow in the product: a signed-in user with no house lands on `/onboarding`, captures their address via Mapbox, and is redirected to `/dashboard` where the OnboardingDiscoveryModal narrates the briefing + habitat lookups in real time (with the issue #142 property-situation prompt landing as an interstitial phase between the briefing result and the first habitat module).

### Files

```
app/(app)/onboarding/
  page.tsx                              # Server; renders the address form
  address-form.tsx                      # Client; Mapbox AddressAutofill + confirmation
  actions.ts                            # Server action: extracts, inserts, redirects
  extract-address.ts                    # Pure helpers (extractCounty, extractAddress)
  extract-address.test.ts               # Vitest coverage of the pure helpers
```

### What runs where

- **`page.tsx`** (server) — Reads the current user, queries `hearth.houses` count. Redirects to `/login` if not signed in, `/dashboard` if a house already exists. Otherwise renders the hero text and mounts `<AddressForm>`.
- **`address-form.tsx`** (client) — Wraps a single street-address input in `<AddressAutofill>` from `@mapbox/search-js-react`. Hidden inputs for `address-level1/2`, `postal-code`, `country`, and `address-line2` are present so Mapbox can auto-populate them and the confirmation minimap can render full context. On user selection the full feature is stashed in component state. Submit is disabled until a feature is captured. On submit, `useConfirmAddress({ minimap: true, skipConfirmModal: high-confidence })` shows a modal with a minimap; the user can confirm or adjust. The (possibly adjusted) feature is then handed to the server action via `useTransition`.
- **`actions.ts`** (`"use server"`) — `createHouseFromMapboxFeature(feature)`. Verifies the session, calls `extractAddress(feature)`, inserts into `hearth.houses` with `owner_id = user.id` and `mapbox_raw = feature`. On Postgres unique-violation (code `23505`) the user already has this house — redirect to `/dashboard` rather than surface a SQL error. On success: writes `active_house_id` on `public.profiles` to point at the newly inserted house, kicks off the Day One Briefing workflow, then `redirect("/dashboard")`. The discovery modal that mounts on `/dashboard` is where the user actually watches the briefing land and answers the property-situation questions — the action itself does not own that surface. The `houses_seed_default_rooms` trigger seeds the 9 default rooms — no app code needed.
- **`extract-address.ts`** (pure) — `extractCounty(context)` finds the `district.*` entry, strips a trailing `" County"` (case-insensitive), and returns the bare name or null. `extractAddress(feature)` maps Mapbox properties onto our canonical column shape, including `[lng, lat]` → `(latitude, longitude)` reordering, and throws on missing required fields. Covered by `extract-address.test.ts`.

### Property-situation prompt (issue #142)

The two property-situation inputs (`water_source` + `basement_present`) the downstream Superfund follow-ups need are captured **inside the OnboardingDiscoveryModal** as an interstitial phase, not via a separate page. An earlier attempt at a standalone `/onboarding/property-details` page broke two things that the discovery modal had been load-bearing for: the user no longer saw the briefing land in real time (the modal didn't mount until after the form submitted), and the layout revalidation timing left the dashboard showing stale "still loading" data even though the briefing had completed. Folding the prompt into the existing modal preserves both.

Phase sequence inside [`onboarding-discovery-modal.tsx`](../app/(app)/dashboard/onboarding-discovery-modal.tsx):

```
intro → briefing-checking → briefing-result → property-questions
      → module-checking ↔ module-result (per module) → done
```

The `property-questions` phase has no auto-advance timer — the user's Skip / Save click is what drives the transition to the first module. The briefing and habitat workflows have already been running in parallel the whole time; the phase pauses only the visual reveal, not the underlying work. Skip and Save both transition to the same next phase (first applicable module, or `done` when none apply). Save also runs an RLS-bound UPDATE against `hearth.houses` through the browser Supabase client to persist the chosen values.

**Habitat kickoff moved to the property-questions phase (issue #144).** An earlier design had the briefing workflow's persist step fire `runHabitatChecks` directly, so habitat started running the moment Zillow finished. That created a timing race: habitat ran with the still-null `water_source` / `basement_present` defaults, finished before the user could answer the property-situation questions, and any module whose output depends on those values (today: the Superfund recommended-actions logic) computed against the wrong inputs. Double-firing habitat to recover would have wasted 10–15 s of compute per onboarding.

The fix moves habitat kickoff out of the briefing workflow entirely and into the callers:

- **New-property onboarding** — the discovery modal's property-questions Save AND Skip handlers each call [`triggerHabitatRecheck`](../app/(app)/dashboard/actions.ts) once the user has answered (Save) or explicitly opted out (Skip). The houses UPDATE on the Save path completes first, so the workflow's `loadHouseContext` step sees the freshly-saved values. The Skip path fires habitat too — without it, users who skip the questions would dismiss the modal without ever getting habitat findings.
- **Refresh House Facts** — [`refreshBriefing`](../app/(app)/dashboard/actions.ts) now fires briefing AND `runHabitatChecks` in parallel. Returning users already have their answers persisted, so the timing hazard doesn't apply and parallel-fire is the cheapest path.
- **Briefing workflow** — [`workflows/briefing.ts`](../workflows/briefing.ts) no longer fires habitat from its persist step. The comment block there explains the why so a future contributor doesn't reintroduce the race by re-adding the call.

Soft-fail at every kickoff site: a `start()` failure is logged but doesn't block the modal phase advance / briefing return. The "Refresh House Facts" button is the manual recovery path for any edge case (user closes browser mid-modal, transient workflow start failure, etc.).

On the briefing-failure path the prompt is skipped entirely — the failure message is the last thing the user sees before the "Start" button enables, and adding a form prompt right after a failure message would compound the friction. Those users can fill the fields in later via the home-details edit modal.

Pure logic for the phase belongs to the row builder in [`onboarding-discovery-rows.ts`](../app/(app)/dashboard/onboarding-discovery-rows.ts): during `property-questions` the briefing row stays `done` and every module row stays `idle`, identical to the `briefing-result` phase. The interactive form (segmented controls + Skip / Save buttons) is rendered separately in the modal body, beneath the row list.

The form region itself is a thin wrapper around the shared [`components/property-situation-fields.tsx`](../components/property-situation-fields.tsx), which also powers the home-details edit modal so the question copy and segmented-control shape stay in sync across surfaces. Users who skip during onboarding (or who onboarded before this prompt landed) can populate the fields later via the edit modal — the same `<PropertySituationFields>` block lands there under a "Property situation" section.

### Mapbox configuration

- Product: **Address Autofill** (not Search Box, not raw Geocoding). Session-based pricing — one onboarding equals one billable session regardless of keystrokes.
- Token: `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, set in Vercel and pulled locally via `vercel env pull`. URL-restricted to `http://localhost:3000`, `https://hearth.toddtech.llc`, and the Vercel preview wildcard.
- TypeScript note: `@mapbox/search-js-react@1.5` types `AddressAutofill`'s `children` as `React.ReactChild`, which was removed in `@types/react` v19. `address-form.tsx` re-types the component locally with `React.ReactNode` children to keep TSC happy. `@mapbox/search-js-core` is only a transitive dependency, so the retrieve-response shape is inlined rather than imported.

### Multi-house

The schema supports many houses per owner. The UI surfaces evolved across two issues: #98 wired the data layer (profile fields, helpers, query swap) while shipping no user-visible change; #100 added the switcher dropdown, the `/houses/new` flow, and the proxy gate split that lets premium / admin users actually use the feature.

**User-facing noun is "property", not "house".** Cleaner business word that extends to condos / rentals naturally. The data model still uses `house` / `hearth.houses` — only the user-visible copy changed.

**Pieces:**

- **`public.profiles` carries user state** — `plan_tier`, `role`, `is_admin`, and `active_house_id` (see the profiles bullet in the schema map). RLS lets a user read/update only their own row, and the UPDATE policy pins plan/role/admin to current values so the client can only ever write `active_house_id`.
- **Active-house resolution** — [`lib/houses/active-house.ts`](../lib/houses/active-house.ts) exports `resolveActiveHouseId(supabase)`. It reads `profiles.active_house_id`, verifies the referenced house is still owned by the user (RLS handles the ownership check), and falls back to the **most recently created** owned house when the stored value is null or stale. Most-recent rather than oldest is deliberate: when a user adds a second house, the natural default is to land on the new one. Returns null only when the user has zero houses. The (app) layout, dashboard, and `/inventory` all call this helper instead of the old `.order("created_at", asc).limit(1)` pattern, so any future surface that needs "the user's current house" picks up the user's actual selection automatically.
- **Capability gate** — [`lib/houses/capabilities.ts`](../lib/houses/capabilities.ts) exports `resolveUserCapabilities(supabase)`, called once per request from the (app) layout. Returns `{ canCreateAdditionalHouse, canSwitchHouses, isAdmin, planTier }`. `canCreateAdditionalHouse = isAdmin || planTier === "premium"` is the single chokepoint surfaces that need it (the "Add a property" entry in the switcher / account menu, the `/houses/new` page, the proxy gate) all consult. `canSwitchHouses` is purely "does the user have ≥ 2 houses" so the switcher can render as a static chip vs. an interactive dropdown. When trial / referral / contractor-gets-N-free policies land, `resolveUserCapabilities` is the only file that changes.
- **Switcher dropdown** — [`components/property-switcher.tsx`](../components/property-switcher.tsx) replaces the old static address chip in the top nav. Three render states: legacy static chip when the user can neither switch nor add (free user, one house), button-shaped trigger + dropdown otherwise. The dropdown lists every owned house (most-recent first), marks the active one with a `circle-check` icon, and surfaces a divider plus "+ Add a property" entry when `canCreateAdditionalHouse` is true. Clicking an inactive row fires [`setActiveHouseAction`](../app/actions/houses/set-active-house.ts) and renders a spinner where the checkmark would go until the server-action redirect navigates away. The component is `hidden md:block` — mobile parity is provided by the account-menu submenu (see "Mobile parity" below).
- **`/houses/new` flow** — [`app/(app)/houses/new/page.tsx`](../app/(app)/houses/new/page.tsx) reuses the onboarding `<AddressForm>` (the form takes a `submitLabel` prop so the button reads "Add this property" here vs. "Set up my house" on `/onboarding`). The page is guarded both at the proxy and at the page level: zero-house users get bounced to `/onboarding`, free users without the capability get bounced to `/dashboard`. The shared `createHouseFromMapboxFeature` action writes `active_house_id` on every insert success, so the user always lands on `/dashboard` viewing the newly added property.
- **`setActiveHouseAction`** — verifies ownership via RLS-scoped SELECT, writes `active_house_id` to `public.profiles`, then `revalidatePath("/", "layout")` + `redirect("/dashboard")`. The layout-wide revalidation matters because the user may already be on `/dashboard` when they switch — without it, the destination would re-render with the stale active house.

**Why `is_admin` is separate from `plan_tier`.** A contractor on the free plan and a homeowner on premium are different in different ways. Folding admin-ness into `plan_tier` would conflate "can use premium features" with "can bypass gates", and the capability gate's behavior would become a side-effect of also being premium rather than an explicit "admins can do anything" rule.

**Mobile parity.** The top-nav PropertySwitcher and the Add button are both `hidden md:flex`-class — the address chip space simply doesn't exist on small viewports. The account menu (always visible) provides the mobile path: a "Switch property" entry (when `canSwitchHouses` and `houses.length >= 2`) opens a submenu that swaps the menu's contents for an inline property list with a back affordance, and an "Add a property" entry (when `canCreateAdditionalHouse`) links to `/houses/new`. The submenu pattern is a `view: "root" | "properties"` state inside the menu rather than a nested fly-out, so it works on a touch viewport without extra layout choreography. Both entries also render on desktop — duplicating affordances rather than hiding them keeps the menu's read consistent across viewports.

**Post-switch landing is always `/dashboard`.** Switching properties is a context-shift event, and landing on a deep page (e.g. an inventory detail) in the new context can be jarring. Matches the Vercel project-selector convention.

**Briefing on add-property.** `createHouseFromMapboxFeature` calls `start(runBriefing, [inserted.id])` regardless of which form it was invoked from, so the new property's Day One Briefing kicks off the moment it's created. The dashboard's `briefing_status='running'` skeletons cover the wait.

### Admin bootstrap

The migration that adds the profile columns defaults everyone to `plan_tier='free'`, `role='homeowner'`, `is_admin=false`. Todd's account is bootstrapped manually after the migration runs, via a one-off SQL update against the remote project (not a migration, since it's account-specific):

```sql
update public.profiles
set plan_tier = 'premium', is_admin = true
where id = '<todd-user-id>';
```

This is a one-time operation — re-running is harmless but unnecessary. Any future admin promotions go through the same path until a real admin UI exists. The RLS UPDATE policy's `with check` clause blocks self-escalation, so this **must** be executed from the Supabase dashboard SQL editor (service-role context) rather than from the browser.

---

## Frontend design system

### Visual language

Two-weight typography, restrained accent use, tokens always referenced via CSS custom properties — never hardcoded values in component code.

- **Fonts** — Fraunces (serif, display) + Inter (sans, body) + JetBrains Mono (mono, ids/codes). Wired via `next/font` in `app/layout.tsx`, exposed as `--font-serif`, `--font-sans`, `--font-mono`.
- **Color** — warm, hearth-leaning palette. Dark mode is the default; light mode under `:root[data-theme="light"]`. The single accent is a warm amber (`--color-accent`), reserved for affordances that earn attention: primary buttons, links inside AI cards, the flame mark, focus rings.
- **Surfaces** — three tiers: `.surface`, `.surface-raised`, `.surface-ai`. The AI surface has a subtle accent gradient border masked through the radius — used for any AI-authored content (briefings, summaries, ask-strips).
- **Type scale** — `--text-h1`, `--text-h2`, `--text-h3`, `--text-body`, `--text-small`, `--text-eyebrow`. The `.eyebrow` class is uppercase, tracked, 11px, tertiary text.

All tokens are defined in `app/globals.css` and projected through Tailwind v4's `@theme inline` block so utility classes resolve to the right CSS variables.

### Component primitives

`components/ui.tsx` exports the shared layout primitives:

- `SectionHeader` — eyebrow + h2 + optional trailing slot.
- `MetricCard` — eyebrow / serif numeric value / meta line.
- `EntityRow` — icon + name + type + meta, used in inventory lists.
- `EmergencyTile` — large tappable shutoff/hazard tile, with an "add" variant.
- `TimelineItem` — vertical history dot with done/upcoming/due states.
- `AskAboutStrip` — AI-themed scoped chat affordance.
- `AICard` — wraps any block with the AI surface treatment + sparkles eyebrow.
- `Breadcrumb`, `PlaceholderImage` — utility primitives.

`components/icon.tsx` ships a small Tabler-style outline icon set (`<Icon name="..." />`) as inline SVG — no runtime icon-library dependency. Stroke 1.75, round joins, 24×24 viewBox. Add icons by extending the `IconName` union and the `paths` map.

`components/app-shell.tsx` composes `TopNav`, `BottomNav`, and `DesktopSidebar` into the authenticated app frame, capped at `--content-max` (1200px) with safe-area-aware bottom padding for mobile nav. The `(app)` layout fetches the user's active house row once and passes the address-chip subset through `AppShell` to `TopNav`.

`components/document-modal.tsx` provides the document-viewer modal and a `DocumentTrigger` to launch it. Body scroll-lock is handled via the `.scroll-locked` class in globals.css.

`components/edit-home-details-modal.tsx` is the only edit surface for the user's property facts. It is triggered from the **pencil-icon button next to the property address on the dashboard** (issue #110 moved it out of the top-nav account dropdown — editing property details is direct manipulation of the current property, not an account-scoped action). The modal writes directly to `hearth.houses` via the RLS-bound browser client; after a successful save it dispatches `hearth:house-updated` (see "Cross-tree refresh signal" below) so the dashboard hero refetches immediately, and also calls `router.refresh()` so the top-nav address — which is server-rendered — picks up the new value. Address fields are read-only (sourced from public records during onboarding); editable fields are `year_built`, `living_area_sqft`, `lot_size_sqft`, `bedrooms`, `bathrooms`, and `purchase_date`. Modal mechanics (scroll-lock, focus trap, ESC, return focus) match `HabitatFindingModal`; backdrop click closes the modal when no save is in flight AND the nested delete-confirm modal is not open.

The modal's footer area also hosts the **danger zone** for property deletion (issue #110). The danger-zone button opens a nested `DeletePropertyConfirmModal` that gates the destructive action behind an address-typing confirmation — the user must retype the property's `address_line1` (case-insensitive, whitespace-trimmed) before the delete button enables. A two-tap "Are you sure?" wouldn't survive a sleepy fat-finger on something this destructive; the typing gate keeps the friction proportionate to what's being removed (every room, every appliance, every document, every habitat finding, plus the Day One Briefing data and onboarding progress on the houses row itself).

The delete itself runs via `deleteHouseAction` (under `app/actions/houses/`). Most of the cascade is owned by the database: `hearth.rooms`, `hearth.inventory`, `hearth.documents`, and `hearth.habitat_findings` all FK to `hearth.houses` with `on delete cascade`, so the row delete handles them inside a single transaction. The action handles the two things that don't cascade: storage objects in the `hearth-documents` bucket (collected before the cascade fires, removed best-effort after the row delete succeeds — same trade-off as `deleteInventoryItemAction`, orphans from a transient storage failure get picked up by a future periodic sweep), and `public.profiles.active_house_id` reassignment. The FK on `active_house_id` is declared `on delete set null` as a safety net, but when the user is deleting their active property and has another property, the action explicitly writes the next-most-recent owned house id to `active_house_id` **before** the cascade fires — keeping the column semantically meaningful (an explicit choice, not a null left over after a cascade) and ensuring cross-device consistency. When the deleted property is the user's only one, the column is left alone and the cascade nulls it; the layout's onboarding gate catches the zero-house state on the next request and redirects to `/onboarding`. On success the action calls `redirect("/dashboard")` so the active-house resolver renders the explicit next property; on failure it returns `{ ok: false, error }` and `EditHomeDetailsModal` propagates the message up to `DashboardLive` for a top-center `<Toast>`.

### Cross-tree refresh signal

`useHouseRealtime` is the dashboard's live data source for a single house row. Realtime UPDATE broadcasts are the primary path, with a polling fallback that's only active while `briefing_status` is non-terminal. When realtime is blocked at the browser layer (extensions, tracking-prevention — see "Realtime and the browser" below) and briefing has already completed, the hook would otherwise go silent for any subsequent write.

The hook accepts an optional `initialHouse` snapshot. When provided (by `app/(app)/dashboard/page.tsx`, which fetches the full row server-side and passes it through `<DashboardLive initialHouse={house} />`), the hook seeds its state synchronously and skips the client-side initial fetch — first paint is the final dashboard layout, with no "Loading your house" placeholder card between the server-rendered shell and the first client fetch. The Realtime channel, polling fallback, same-tab refresh listener, and `refetch` API all run identically either way. The `if (loading)` early-return inside `DashboardLive` is preserved as a defensive fallback for future error paths but should not fire under normal operation.

**Active-house remount via `key`.** `useState(initialHouse)` only seeds on first mount; subsequent prop changes don't re-seed the hook's internal state. That doesn't matter while the user stays on one property, but it matters the moment the *active house* flips — e.g., after `deleteHouseAction` reassigns `profiles.active_house_id` and `redirect("/dashboard")` re-renders the server component with a different `house.id` and `initialHouse`. The same component instance would otherwise persist with the previous (now-deleted) row in state, and the UI would show the wrong property until something forced a refetch. To prevent that, `dashboard/page.tsx` passes `key={house.id}` to both `<DashboardLive>` and `<HabitatPreviewPanel>` — the two client components whose hooks seed state from an `initial*` prop. A different house id swaps the React key, which forces an unmount + fresh mount, which re-runs the hooks against the new seed. The cost is a fresh Realtime subscription on each switch, which is the same cost a brand-new page load would pay anyway.

To stay robust against that, write paths inside `DashboardLive`'s subtree (photo upload/remove, regenerate-image, refresh-briefing, and now the Property Details edit modal — moved here from the top-nav by issue #110) call `refetch()` directly after they finish — the hook is in scope. The home-details modal still dispatches the `HOUSE_UPDATED_EVENT` (`hearth:house-updated`) custom event via the `dispatchHouseUpdated(houseId)` helper exported from `lib/hooks/use-house-realtime.ts` because the modal itself doesn't have the hook in scope (it's a generic component reachable from any future host). The hook listens for that event and calls `refetch()` when the `houseId` matches. The event is idempotent against Realtime — if both fire, the second update is a no-op. Any future house-mutating UI that's not a descendant of `DashboardLive` can dispatch this event after its write completes instead of plumbing the hook's `refetch` through a context.

### Discipline

- Every Claude Code task that creates or modifies UI invokes the `frontend-design` skill first. This is non-negotiable and applies regardless of how "simple" the change appears.
- Match existing patterns rather than introducing new ones ad hoc. Tailwind utilities only — no inline `style` for anything that has a token, no CSS modules, no styled-components without explicit approval. (`style={{ color: "var(--color-...)" }}` is fine for token references where Tailwind doesn't have a class for it.)
- No premature abstraction. Wrappers, custom hooks, and helper utilities require two concrete callers before extraction.

---

## Environments and deployment

### Local development

- `next dev` runs locally on the developer's machine. It connects to the **same remote Supabase project** as preview and production — there is no local Postgres / GoTrue / Storage stack. We tried a local stack earlier; the operational drag of keeping the two in sync outweighed the isolation benefit, so we dropped it. `supabase/config.toml` is kept around because the CLI commands we still use (`supabase migration new`, `supabase db push`) read from it.
- `.env.local` is the only env file. It is populated by `vercel env pull` and holds the remote Supabase URL, anon key, service-role key, and the Mapbox token. There is no `.env.development.local` override.
- Migration loop is described under "Migration discipline" above — edit SQL on a feature branch, get review, then `supabase db push` against remote.
- **Because local dev and production share a database, treat dev writes as production writes.** Schema changes from a `supabase db push` are visible to everyone immediately; data you insert or delete during local exploration affects production rows. The cost of a careless action is real.

**Realtime and the browser.** Realtime works end-to-end through the remote Supabase project — the websocket terminates at the project's `wss://<project-ref>.supabase.co/realtime/v1/websocket` endpoint. If the dashboard fails to receive UPDATE events and the browser console shows a `WebSocket connection failed` with close code `1006`, it is almost certainly a **browser-side block**: an extension intercepting websockets, a tracking-prevention setting, or a content-blocker rule. Quickest diagnostic is an InPrivate / Incognito window — if it works there, the issue is in the regular profile's extensions or settings. The 2.5s polling fallback in `useHouseRealtime` keeps the dashboard usable even when the websocket is blocked, but the right fix is to identify and unblock the offending extension/setting per-developer.

**Realtime and the `hearth` schema (load-bearing).** Supabase Realtime evaluates a subscription's RLS policy as the JWT-identified role (`authenticated` for signed-in users, `service_role` for system work). The RLS check only runs *after* that role has SELECT permission on the table at the Postgres catalog level. Supabase auto-grants the API roles SELECT on `public` but not on custom schemas like `hearth` — without an explicit grant, the realtime broadcaster sees zero rows when it looks up which subscribers to notify, and every UPDATE / INSERT / DELETE event silently disappears. The subscription handshake still succeeds; you just never get events. Migration `20260523201949_fix-realtime-servicerole-perms.sql` grants `usage` + `select on all tables` to `anon`, `authenticated`, and `service_role` on the `hearth` schema, plus an `alter default privileges` clause so future tables in the schema inherit the same grant automatically. **Any new schema we introduce must repeat this pattern**, or realtime on that schema will silently break. Row-level access stays gated by the per-table RLS policies as before — the schema-level grant just lets the realtime broadcaster ask the question.

### Vercel

- Push to a feature branch → Vercel builds a **preview deployment** at a unique URL.
- Merge to `main` → Vercel builds the **production deployment**.
- Environment variables are managed via `vercel env`. `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the load-bearing ones today.

### Testing in CI

- `pnpm test` (Vitest, `--passWithNoTests`) runs on every PR via GitHub Actions and surfaces as a "Tests" check on the PR.
- Branch protection is **not enforced** at GitHub (private repo on a free plan). The discipline of not merging on a red check is manual; revisit if that fails or as collaborators are added.

---

## Conventions worth knowing

- **Package manager**: pnpm only. Do not use `npm` or `yarn`.
- **Middleware file is `proxy.ts`** at the repo root (not `middleware.ts`). It delegates to `lib/supabase/proxy.ts`.
- **Schema default**: both Supabase clients are scoped to `hearth`. `.from("anything")` hits `hearth.anything`. Reach into shared tables with `.schema("public")`.
- **Money in cents**: monetary columns are `bigint` cents (e.g. `purchase_price_cents`) to avoid float drift and give headroom over `int`.
- **Coordinates**: stored as `numeric(9,6)` on `houses`. Mapbox returns `[lng, lat]`; we store them swapped into `(latitude, longitude)`.
- **Server actions return `redirect()`**: `redirect()` throws a Next-internal error. Treat the return type as "error object or never", and don't wrap a `redirect()` call in a try/catch.
- **Tests live next to code**: `*.test.ts` adjacent to the source file. Coverage is selective — pure logic with non-obvious behaviour, not orchestration code or thin library wrappers (see CLAUDE.md "When to write unit tests").

---

## Day One Briefing

When a user submits an address through onboarding, the house row is inserted and a **briefing workflow** is started in the background. The dashboard subscribes to that row via Supabase Realtime, so house facts appear in place as the workflow discovers them — no manual refresh, no second round trip. The same workflow can be re-run on demand from the dashboard; results merge into the existing row rather than overwriting it, so re-running accumulates fields rather than risking the loss of a value the previous run found.

### Pipeline

```
onboarding action (server)        workflows/briefing.ts (durable)            dashboard (client)
  insert hearth.houses     ──▶    start(runBriefing, [houseId])
  redirect /dashboard             │
                                  ├─▶ step: startBriefing
                                  │     read address, set status='running'
                                  ├─▶ step: lookupZillow
                                  │     AI Gateway → Zillow JSON
                                  │     pure validation (clamp to ranges)
                                  ├─▶ step: persistBriefingSuccess
                                  │     read current row, merge non-destructively,
                                  │     write payload, status='completed'
                                  └─▶ on throw → markBriefingFailed
                                                                  ──▶  useHouseRealtime
                                                                       re-renders on UPDATE

dashboard refresh action (server) ─▶ start(runBriefing, [houseId])
  verify session + ownership          (same workflow as onboarding)
```

### Files

- **`lib/briefing/zillow.ts`** — `lookupHouseOnZillow(input)` calls the AI Gateway via `generateText` and returns a typed `ZillowLookupResult`. The exported `validateZillowResponse` is a pure helper that clamps year/sqft/bedroom/bathroom values to plausible ranges and is the unit-tested surface (`zillow.test.ts`). The validator also reconciles lot-size units: the prompt asks the model to copy what Zillow displays (acres or sqft, not converted by the model itself), and the validator derives whichever is missing using `1 acre = 43560 sqft`. Heating, cooling, and parcel number flow through string validators — parcel numbers are explicitly kept as strings (leading zeros are part of the identifier) and capped at 64 chars to reject obvious junk.
- **`lib/briefing/merge.ts`** — `buildBriefingSuccessUpdate({ current, result, now })` is the pure helper the persist step uses to turn a fresh `ZillowLookupResult` into a Supabase update payload. A new non-null value writes only when it differs from the current row value; a new null never overwrites an existing non-null value; equal old/new values produce no field at all (a no-op). `description_source` is provenance-locked — once set, it is never overwritten, even by a different non-null description. Run-lifecycle fields (`briefing_status`, `briefing_generated_at`, `briefing_error`) always update unconditionally. Covered by `merge.test.ts`.
- **`workflows/briefing.ts`** — `runBriefing(houseId)` is the `"use workflow"` orchestrator. It calls three `"use step"` functions (`startBriefing`, `lookupZillow`, `persistBriefingSuccess`) and falls back to `markBriefingFailed` on any throw. The persist step reads the current row, hands it to `buildBriefingSuccessUpdate`, and writes only the diff — so a re-run can fill in gaps without clobbering anything the previous run already found. Steps retry automatically — by default three attempts — before the workflow's catch handler marks the row failed. Step functions use the service-role Supabase client (`lib/supabase/service.ts`) because the workflow runs outside a request context.
- **`app/(app)/onboarding/actions.ts`** — after the house insert, calls `start(runBriefing, [houseId])` from `workflow/api`. The call is not awaited; a `start()` failure is logged but never blocks the user from reaching the dashboard.
- **`app/(app)/dashboard/actions.ts`** — `refreshBriefing(houseId)` is the server action behind the dashboard's Refresh affordance. It verifies the session, confirms the house exists for the signed-in user (RLS is the load-bearing check; the explicit lookup gives a clean error message), short-circuits if `briefing_status` is already `running`, and calls `start(runBriefing, [houseId])` AND `start(runHabitatChecks, [houseId])` in parallel. The dual-start is the explicit orchestration that replaced the briefing workflow's old internal habitat kickoff (see "Habitat kickoff moved to the property-questions phase" under the onboarding section). `triggerHabitatRecheck(houseId)` is the sibling action the discovery modal's property-questions Save/Skip handlers call — habitat-only kickoff with no briefing run. The client component disables its button while the action is pending and while the realtime row reports a non-terminal status, so double-starts are guarded both client- and server-side.
- **`lib/hooks/use-house-realtime.ts`** — generic single-row subscription. Fetches the house once on mount, then re-renders on every UPDATE event. Reusable for any future "live row" pattern; not Zillow-specific.
- **`lib/hooks/use-habitat-findings.ts`** — sibling hook for the `hearth.habitat_findings` table. Subscribes to all INSERT/UPDATE events for a given house and merges them into local state keyed by `module_key`, with a 2.5s polling fallback for environments where the realtime websocket is blocked. Accepts an optional `initialRows` seed so a server-component parent can hydrate the panel with zero first-paint flash. Used by both `HabitatPreviewPanel` and `OnboardingDiscoveryModal`.
- **`app/(app)/dashboard/dashboard-live.tsx`** — client component that renders the hero, the five house-facts cards, and the description from the realtime row, with three states per field: skeleton pulse (`briefing_status = 'running' | 'pending'` + null value), em-dash with "Not found" meta (`completed` + null value), and a soft error banner (`failed`). The hero exposes a Refresh button that calls `refreshBriefing` via `useTransition`; while the call is in flight or the briefing is running, the button is disabled and the metric cards naturally fall back to the skeleton state because the workflow flips `briefing_status` to `running`.
- **`next.config.ts`** — wrapped with `withWorkflow()`. Required for the `"use workflow"` and `"use step"` directives to compile.
- **`proxy.ts`** — matcher excludes `.well-known/workflow/*` so the Workflow SDK's internal endpoints aren't intercepted by session refresh.

### Model selection

Two env vars, read at call time so models can be swapped without redeploying:

- `BRIEFING_PRIMARY_MODEL` — default `perplexity/sonar-pro`
- `BRIEFING_FALLBACK_MODELS` — comma-separated, default `perplexity/sonar`

These are passed to the AI Gateway as `providerOptions.gateway.models`, which gives automatic model-level fallback if the primary errors.

**Why Perplexity Sonar.** Zillow lookup requires *live web access* — the model has to actually open Zillow's site and read what's there. Claude / GPT-5 / Grok through the AI Gateway don't have web access enabled by default, so they answer from training data and return `data_found=false` for any real address they haven't memorized. Perplexity's Sonar family is search-grounded: every answer cites and synthesizes from live web pages. For a "find facts on Zillow" task that's exactly the capability we need; the trade-off is slightly less raw reasoning than the frontier models, which doesn't matter here.

**What Sonar can and can't surface.** Sonar reads search-engine snippets — it doesn't execute JavaScript. Zillow's modern site is a React SPA where the "Facts & features" panel (heating, cooling, parcel number, sometimes lot size and year built) is hydrated client-side, so those fields aren't in the bytes Sonar receives and come back `null` more often than not. Fields that do land in indexed HTML or schema.org metadata (bedrooms, bathrooms, living area, listing description) are reliable. The prompt lets the model fall back to Realtor.com / Redfin / Trulia / Compass / Homes.com / public records when Zillow is silent, which recovers some of the missing fields (notably year built and heating) when those sites have less JS-heavy pages. Parcel number in particular is rarely retrievable via Sonar; the canonical source is the county assessor (BS&A for Michigan), tracked as a follow-up rather than a Sonar prompt problem. The right long-term fix for the JS-rendered fields is either a headless-browser fetcher (Browserbase, Tavily Extract) or going straight to authoritative sources for each field.

### First-run discovery modal

The dashboard's first-time experience is a streaming modal that narrates the briefing + habitat lookups as they happen, rather than the quiet inline skeletons used on the steady-state dashboard and on manual Refresh. The intent is for the user to see *what Hearth is actually doing for them* — a Zillow lookup, then each habitat module — instead of watching cards fill in silently. After the modal walks through every applicable check, the user clicks **Start Managing my Home** to dismiss it and lands on the fully populated dashboard.

- **Lives at `app/(app)/dashboard/onboarding-discovery-modal.tsx`** and is mounted by `dashboard-live.tsx` when the first-run preconditions hold.
- **First-run preconditions** (both must be true): `houses.briefing_generated_at IS NULL` or `briefing_status` is `pending`/`running`, AND no `habitat_findings` rows exist for this house *at all*. Once either flips false, the modal is gone for good — no schema column tracks "dismissed," because the data conditions already do. The habitat probe checks row existence, not `status = 'completed'`, because the habitat orchestrator upserts each row to `status = 'running'` before the check runs (`workflows/habitat.ts`); during a Refresh House Facts every row cycles `completed → running → completed`, and a status-filtered probe would re-open the onboarding modal on top of the refresh modal in that window. Once the orchestrator has ever run for a house, rows exist permanently — that's the right signal for "not a first-run user."
- **sessionStorage** is a re-mount safety net keyed by `houseId` (`onboardingDiscoveryDismissed:<id> = "1"`), so a fast nav back to the dashboard immediately after dismissal doesn't briefly flash the modal back open while the habitat read catches up. It is not the source of truth.
- **Sequencing is visual only.** The briefing and habitat workflows are already running in parallel — the modal just waits for each piece of data to land and paces the reveal. A short `RESULT_DISPLAY_MIN_MS` keeps fast modules (radon resolves sub-millisecond) on screen long enough to read.
- **Row count is fixed from first paint.** The modal renders one row per applicable check (briefing + every applicable habitat module) from the moment it mounts, with not-yet-reached rows held in a muted `idle` state (hollow circle, `--color-text-tertiary` label). Each row advances `idle → checking → done` as its phase activates. This keeps the modal surface from growing or re-centering as results stream in — adding a new habitat module to `HABITAT_MODULES` does not re-introduce jumping because the row list always equals `1 + applicableModules.length`. The pure `buildRowList` mapping from `(phase, applicable modules, accumulated copy, accumulated severities)` to rendered rows lives in `app/(app)/dashboard/onboarding-discovery-rows.ts` and is unit-tested in the sibling `.test.ts` — extracted out of the `.tsx` so the row-shape logic can be exercised without React.
- **Source eyebrow above each row.** Every card renders an 11px/uppercase eyebrow above the glyph + lead block ("PUBLIC RECORD SEARCH" for the briefing row, "EPA RADON CHECK" / "FEMA FLOOD ZONE CHECK" / etc. for habitat modules) so each tile self-identifies its data source from intro through done. Habitat-module rows read the label from an optional `sourceLabel` field on `HabitatModule` (`lib/habitat/types.ts`); when a module omits it the row falls back to `module.name.toUpperCase()`. The briefing row has no module, so its label lives as `BRIEFING_SOURCE_LABEL` next to `buildRowList` in `app/(app)/dashboard/onboarding-discovery-rows.ts`. Idle rows dim the eyebrow's opacity in lockstep with the lead line so not-yet-started tiles still read as muted.
- **Card rows with severity awareness.** Each row renders as a bordered card with a 14px/500 lead line and an optional 13px secondary line beneath it. Done-state rows derived from a habitat module carry the module's persisted `severity` and drive three things from it: the glyph (alert triangle in the severity colour for flagged severities — caution / concern / critical — and a green check otherwise), the card border (a warm `color-mix` of `--color-warning` and `--color-border-subtle` when flagged, plain subtle otherwise), and a right-aligned "Worth knowing" relevance pill wrapped in the project `Tooltip` primitive so hover, keyboard focus, and screen readers all reach the same explanation. The pill label is uniform across every flagged severity — the visual differentiation already lives in the glyph + border, and the tone-of-voice escalation lives in the tooltip body ("we'll surface this on your dashboard with our findings and suggested follow-ups." for concern/critical, "worth being aware of. You'll find this on your dashboard with the full details." for caution). The pure derivation helpers (`isFlaggedSeverity`, `discoveryRowGlyph`, `pillLabelForSeverity`, `pillTooltipForSeverity`) live in `components/habitat-severity.tsx` alongside `SEVERITY_COLOR`, so the modal never invents a parallel severity vocabulary and the helpers can be reused by the dashboard tiles and detail modal in the future. The briefing row never carries a severity — it always renders as a green-check, non-flagged card. The subtitle slot beneath the headline stays mounted in every phase so the surface height is stable; in non-`done` phases it carries the existing copy ("This typically takes 20 to 30 seconds." / property-questions help text) and in `done` it carries a summary chip — "{total} facts found · {N} worth a closer look" with a `--color-warning` dot — where `N` is the number of flagged habitat findings shown (the briefing row never counts toward `N`) and the chip omits the second clause when `N === 0`.
- **The Refresh button on the dashboard does not re-open the modal.** Once any habitat module has completed once, the preconditions are false; the existing inline-skeleton flow takes over for re-runs.

### `HabitatModule.getOnboardingMessage`

The modal's per-module result line is authored by each module via an optional `getOnboardingMessage(finding) => string` on the `HabitatModule` contract (`lib/habitat/types.ts`). The string should lead with what was found, not what was checked, because the modal already renders "Checking <module.name>…" before this fires. Modules that don't implement it get a generic "Checked <name> for your area" fallback. The radon module's implementation lives alongside its `check()` in `lib/habitat/modules/epa-radon-zone/index.ts` and branches three ways on zone — Zone 1 leads with concern, Zone 2 with moderate, Zone 3 with positive framing. Unit-tested in `index.test.ts`.

The WQA module's onboarding line is a richer case: it has *two* independent axes (EPA compliance violations and Lead and Copper Rule sample results) and the severity is the worse of the two. The pre-#186 implementation read only the compliance axis, which produced a contradictory row in the discovery modal whenever LCR alone pushed severity to `caution` ("no active compliance issues." next to a warning glyph and a "Worth knowing" pill). Issue #186 replaced that with a pure builder at [`lib/habitat/modules/water-quality-awareness/onboarding-message.ts`](../lib/habitat/modules/water-quality-awareness/onboarding-message.ts) that reads `finding.severity` + `system_card.compliance_status_short` + `classifyLcrAxis(lead_copper_summary)` and produces a two-clause sentence — clean axis as reassurance, flagged axis as the honest call-out. Issue #188 expanded the model so any detected lead/copper drives caution (not only ≥80% of the action level) and dropped monitoring/reporting violations from severity, so the builder now has three caution tiers — `above` (concern, "at or above the action level"), `approaching` ("approaching the action level. We'll flag this for follow-up."), and `detected` ("recent samples have detected lead. Any presence is worth knowing about."). The voice across all flagged-caution branches leads with "they're in active compliance with EPA" — celebrating the regulator-side positive — and pairs it with the actual LCR-axis call-out. Lead vs. copper is distinguished when a single metal is responsible; "lead and copper" appears only when both axes are at the same tier. Favorable only fires when every sample is below the detection limit and reads as "no detectable lead and copper." The builder is unit-tested per-row in `onboarding-message.test.ts`. The non-CWS branches (private well / cws_unmapped / stale / non_community) stay shaped by their own copy and don't go through this builder.

### Briefing message helper

`lib/briefing/getBriefingMessage.ts` exports two helpers. `getBriefingMessageParts(house) => { lead, secondary }` is the canonical form the discovery modal consumes — `{ lead: "Home data found", secondary: "built in 1934, 2,210 sq ft, 3 bed / 3 bath" }` when concrete facts came back, `{ lead: "Public records checked", secondary: null }` when nothing did. `getBriefingMessage(house) => string` composes from the parts and stays the legacy single-string surface ("Found your home data — built in 1934, ..." / "Looked up your home's public records") for callers that need a sentence. Both are unit-tested across field-presence permutations in `getBriefingMessage.test.ts`, with a composition test asserting the two forms can't drift. The output is not persisted — the modal calls `getBriefingMessageParts` against the realtime house row at the briefing-result transition and holds the result through every later phase.

### Realtime publication

Supabase Realtime only broadcasts changes for tables explicitly added to `supabase_realtime`. The publication is enabled by migration `20260514180500_houses_realtime_publication.sql` for `hearth.houses` and by `20260515165033_create_habitat_findings_table.sql` for `hearth.habitat_findings`. Future tables that the dashboard subscribes to need a similar migration. RLS continues to enforce scope — only the row's owner receives the events.

### Service-role client

`lib/supabase/service.ts` exports `createServiceClient()` for background work that has no session cookie (workflow steps, cron jobs). It uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS, so every call must filter by the right id. Never use it from a server action or route handler under a user session — those keep using the cookie-bound client in `lib/supabase/server.ts` so RLS keeps doing its job.

---

## House image: generated sketch + user-uploaded photo

The dashboard's hero image surface shows one of two assets:

- **User-uploaded photo** (`hearth.houses.user_image_url`, bucket `house-photos`) — the user's own photo of their house. Takes priority when present.
- **Generated architectural sketch** (`hearth.houses.generated_image_url`, bucket `house-images`) — a pencil-style illustration of a typical home of the same era and style as the user's house, not a depiction of the actual property. The default placeholder until the user uploads their own photo. Generated by a workflow appended to the Day One Briefing pipeline once `year_built` and `description` are populated, and re-rollable from the dashboard via a Regenerate button.

Both assets co-exist on the row, so the user can remove their photo and revert to the generated sketch without re-running the image workflow. The two live in different buckets with different RLS shapes — users write directly to `house-photos` but cannot write to `house-images`.

**The "not a photo of your home" framing is load-bearing whenever the generated illustration is on screen.** It is wrong to imply the illustration depicts the actual property. The disclaimer beneath the image ("Stylized illustration — not a photo of your home.") and the deliberately generic prompt (era + style + stories, never literal description details) both encode this contract. The disclaimer is intentionally dropped only when a real user-uploaded photo replaces the sketch — at that point the figure caption reads "Your photo." instead. Any change that makes the generated illustration look more "real" or removes the disclaimer is a regression.

### Pipeline

```
workflows/briefing.ts persistBriefingSuccess
  └─▶ start(runHouseImage, [houseId])
                    │
                    ├─▶ step: loadHouseForImage
                    │     read year_built + description from hearth.houses
                    ├─▶ step: generateSketch
                    │     buildHouseImagePrompt({ yearBuilt, description })
                    │     generateImage({ model: $HOUSE_IMAGE_MODEL })
                    │       → 1024x1024 PNG bytes
                    └─▶ step: persistHouseImage
                          upload to `house-images/{house_id}/generated-sketch.png` (upsert)
                          write generated_image_url / prompt / created_at on hearth.houses

dashboard regenerate action
  └─▶ start(runHouseImage, [houseId])     (same workflow; overwrites in place)
```

Errors are logged but do NOT taint a status column on `hearth.houses` — unlike the briefing, image generation is a best-effort enrichment. The dashboard's placeholder + Regenerate button cover the failure surface; a stuck status flag would only add noise.

### Files

- **`lib/house-image/prompt.ts`** — `buildHouseImagePrompt({ yearBuilt, description })`, the pure builder that turns the row's era/style/stories signals into the final prompt string. Era is derived from `year_built` via fixed buckets (pre-1920 → "early 20th century"; 1920–1945 → "1930s-era"; 1946–1965 → "mid-century"; 1966–1985 → "1970s-era"; 1986–2005 → "late 20th century"; 2006+ → "contemporary"). Style hint is extracted by keyword match against the description (Craftsman, Cape Cod, Colonial, Victorian, Farmhouse, Bungalow, Cottage, Tudor, Ranch, Contemporary) — multi-word styles ordered before single-word prefixes. Stories ("single-story" / "two-story" / "three-story") is extracted by pattern match. Any of the three signals can be null and the assembled prompt stays well-formed (no leaked literal details, no dangling phrases). Unit-tested in `prompt.test.ts` across era boundaries, style positive/negative matches, stories variants, and the "no literal description leak" contract.
- **`lib/house-image/signed-url.ts`** — `createCachedSignedUrl(supabase, bucket, path, stamp)` issues a signed URL for any supported private bucket (`house-images`, `house-photos`, or `hearth-documents`; type `CachedSignedUrlBucket`) and caches the resulting URL string in `sessionStorage` keyed by `(bucket, path, stamp)`. The cache is what gives the browser a stable URL across navigations — without it, a remount would mint a fresh signed URL on every visit, and the browser's HTTP cache (which keys on URL) would miss the previous bytes. The signed URL TTL is 7 days; cache entries expire at 90% of that. The `stamp` argument is the cache-bust knob for buckets where bytes can change in place (house-images uses `generated_image_created_at`, house-photos uses `user_image_uploaded_at`); `hearth-documents` paths embed a `{document_id}` segment that is unique per upload, so callers pass `stamp: null` and rely on the path itself as the version key. The module also exports `HOUSE_IMAGE_CACHE_CONTROL = "31536000, immutable"`, used as the `cacheControl` on every upload so the bytes themselves are forever-cacheable behind the stable URL.
- **`lib/house-image/use-cached-signed-url.ts`** — `useCachedSignedUrl(bucket, path, stamp)` is the React hook wrapper around `createCachedSignedUrl`. Returns `null` while resolving (or when `path` is null) so consumers can render a placeholder, then re-renders with the URL once the helper resolves. Used by `InventoryDetailView` and the dashboard's `<InventoryThumbnail>`; the `HouseImageSurface` in `dashboard-live.tsx` uses the underlying helper directly because it tracks more state (the active bucket/path/stamp tuple as the user swaps between generated sketch and uploaded photo).
- **`workflows/house-image.ts`** — `runHouseImage(houseId)` is the `"use workflow"` orchestrator. Three `"use step"` functions (`loadHouseForImage`, `generateSketch`, `persistHouseImage`); top-level try/catch logs and exits rather than writing a failure column. The image step uses the service-role client because the workflow runs outside a request context, and uploads with `cacheControl: HOUSE_IMAGE_CACHE_CONTROL` so the bytes carry the right Cache-Control header into the browser.
- **`workflows/briefing.ts`** — calls `start(runHouseImage, [houseId])` in `persistBriefingSuccess` alongside the habitat kickoff. Fire-and-forget — a `start()` failure is logged but the briefing itself is already user-visible at that point. The kickoff is **skipped when `user_image_url` is already set** on the row: a user who has uploaded their own photo doesn't see the generated sketch, so re-running the sketch workflow on every Refresh would burn image-model credits with no visible benefit. The dashboard's explicit Regenerate button still calls `runHouseImage` directly, so a user who wants a fresh sketch under their uploaded photo can still trigger one.
- **`app/(app)/dashboard/actions.ts`** — `regenerateHouseImage(houseId)` is the Regenerate-button server action. Verifies the session, confirms the house exists for the user (RLS does the load-bearing check), and calls `start(runHouseImage, [houseId])`. The dashboard observes `generated_image_created_at` advancing via Realtime and refreshes the signed URL.
- **`app/(app)/dashboard/dashboard-live.tsx`** — `HouseImageSurface` renders the active image (user photo if present, otherwise the generated sketch) via a signed URL, plus the figcaption row whose copy + actions swap based on which image is on screen. The component also owns the hidden `<input type="file">` and triggers it via a ref from either the "Upload your own photo" or "Replace" affordance. `accept="image/*"` (no `capture` attribute) lets mobile browsers offer both camera and photo-library natively. Upload and remove handlers live in `DashboardLive` and call Supabase Storage + `hearth.houses` UPDATE directly from the browser; RLS on both surfaces is the load-bearing ownership check. The `GeneratingIllustrationSkeleton` covers the first-time-waiting state for the generated image and is suppressed during the brief user-photo URL fetch so its copy doesn't lie about what's happening.

### Storage layout

Two private buckets, one per asset:

- **`house-images`** — AI-generated sketches. Path layout `{house_id}/generated-sketch.png`. One object per house, written exclusively by the workflow's service-role client. Read-only from the user's perspective.
- **`house-photos`** — user-uploaded photos. Path layout `{house_id}/photo` (no extension; the stored content-type is the source of truth for the MIME). One object per house. Owners can read, insert, update (upsert), and delete via RLS. The "Remove photo" affordance deletes the object and clears the columns; deletion is best-effort while the row update is authoritative (an orphan object will be overwritten on the next upload).

Both buckets follow the same upload contract: `upsert: true` so a replace overwrites in place (no version history), and `cacheControl: '31536000, immutable'` so the bytes carry a Cache-Control header that the browser respects for one year. The stable storage path combined with the immutable header lets the browser HTTP cache hit reliably across navigations once the signed URL string is itself stable (see "Signed URL caching" below).

RLS on `storage.objects`:

- **`house-images` SELECT** — `authenticated` role can read an object when the first folder segment of the path matches a `hearth.houses` row they own. INSERT/UPDATE/DELETE have no `authenticated` policies; only the service-role client (workflow steps) writes.
- **`house-photos` SELECT / INSERT / UPDATE / DELETE** — all four scoped to the owner of the matching `hearth.houses` row, using the same folder-name → house_id → owner_id join. The dashboard uses the browser's RLS-bound client for every operation; no service-role path exists for user photos.

### Path vs URL

`generated_image_url` and `user_image_url` on `hearth.houses` hold storage **paths** within their respective buckets, not public URLs — both buckets are private, and a permanent URL doesn't exist. The dashboard derives a signed URL whenever the active `(bucket, path, stamp)` tuple changes; the path is stable across regenerates / replaces but the stamp (`generated_image_created_at` or `user_image_uploaded_at`) moves, which forces a fresh signed-URL fetch and a new cache-key when the user genuinely wants to see different bytes.

### Signed URL caching

The signed URL is what the browser actually uses as the `<img src>` — but Supabase's `createSignedUrl()` returns a fresh URL string every time it's called (a new JWT signature). On a dashboard remount the helper would otherwise mint a brand-new URL, and the browser's HTTP cache (keyed on the full URL) would miss the bytes from the previous visit.

`createCachedSignedUrl` solves this by caching the issued URL string in `sessionStorage` under `hearthSignedUrl:{bucket}:{path}:{stamp}` with an explicit expiration timestamp. A remount with the same `(bucket, path, stamp)` reads the cached URL string synchronously — the browser sees the same URL it saw before, the HTTP cache hits the previously-downloaded bytes, and the image renders without a network round trip. When the row's stamp moves (a regenerate, a photo replace), the cache key changes and the helper mints (and caches) a fresh URL.

Two values are tuned together here: a 7-day signed-URL TTL so the cached URL stays valid through a long active session, and `cacheControl: '31536000, immutable'` on the bucket objects so the bytes themselves stay in the browser cache for the cached URL's whole lifetime. Either alone would still miss; together they give effectively-forever caching for the duration of normal usage.

`sessionStorage` (not `localStorage`) is the right scope because it dies with the tab — which avoids accumulating dead URLs forever and bounds the worst-case staleness to a single browsing session.

The same caching contract applies to the `hearth-documents` bucket, which backs every appliance / inventory hero photo and thumbnail. The dashboard inventory tiles and the inventory detail page sign client-side via the `useCachedSignedUrl` hook so the same URL is reused across navigations — without that, the 1-hour server-signed URLs the surfaces formerly used were fresh on every render and the immutable bucket bytes were re-downloaded on each reload. For `hearth-documents` the cache key's `stamp` is `null`: each path embeds a `{document_id}` segment that is unique per upload, so the path itself is the version key.

### Model selection

`HOUSE_IMAGE_MODEL` env var, read at call time. Default `openai/dall-e-3`. The Vercel AI Gateway's GA OpenAI image model is `openai/gpt-image-1` — if the gateway returns "unknown model" for DALL-E 3, flip the env var without a code change. The `providerOptions.openai` settings (`quality: "standard"`, `style: "natural"`) are DALL-E 3-specific and are silently ignored by `gpt-image-1`.

---

## Habitat surface

Habitat findings live in exactly one place: the dashboard's Habitat preview block. There is no dedicated `/habitat` route — every finding the user has is already on the dashboard, and clicking a tile opens a modal with the full detail (action chips, source link, and the activity log narrating how the finding was computed).

The dashboard's Habitat block (`app/(app)/dashboard/page.tsx`) renders a `<HabitatPreviewPanel>` (client component) inside its half-width left column. When no finding has produced a populated row yet the panel falls back to a one-line "Looking up public records for your area…" placeholder so the dashboard layout stays stable during the first-run discovery window. The `SectionHeader` carries only the eyebrow and title — no trailing affordance, because the modal is the follow-up.

`HabitatPreviewPanel` is a client component because the panel must stay live across the onboarding workflow's completion and across manual refreshes. The server component fetches an initial set of rows (passed as `initialRows`) so first paint is fully hydrated; the panel then subscribes to `hearth.habitat_findings` via `useHabitatFindings` (`lib/hooks/use-habitat-findings.ts`) and overlays realtime INSERT / UPDATE events as the orchestrator writes new findings. A 2.5s polling fallback runs alongside the websocket so the panel still updates when a browser blocks realtime transports.

The panel filters rows by "severity is populated" rather than `status='completed'`. The orchestrator's `running`-status upsert only writes `status` / `checked_at` / `error` and leaves the prior `severity` / `headline` / `summary` intact, so this filter keeps the previously-completed tile visible through a re-check (manual refresh, cadence-driven re-run) instead of flickering it out and back in when the new completed row arrives. Sort order is concerns first: critical → concern → caution → neutral → favorable → beneficial.

### Tile + trigger + modal

The preview is a three-piece composition:

- **`components/habitat-finding-tile-compact.tsx`** — presentational tile content. 72px hero, eyebrow + severity dot + module label, headline, line-clamped 2-line summary. No wrapping interactive element — the trigger owns the click.
- **`components/habitat-finding-trigger.tsx`** — client component that wraps the tile in a real `<button>` and opens the modal on click. Owns the open state and the return-focus ref so the modal's focus trap returns focus to the originating tile when it closes. `aria-haspopup="dialog"` so AT users know what the button does.
- **`components/habitat-finding-modal.tsx`** — client component that renders the finding detail. Sticky header (severity dot + module label + severity word + headline + summary + close button), scrollable body with the optional action shelf, an optional list of overview cards (when the module opts in via `getOverviewCards`, see below), and the activity log timeline ("How we got here"), sticky footer with "Last checked", a "View source" link, and the `Esc` keyboard hint.

The modal is **generic by default, slotted on demand**. The shell renders directly from the `HabitatFinding` shape (`severity`, `headline`, `summary`, `actions`, `source_url`, `activity_log`) for modules that need no extra structure (radon). Modules that produce multi-item findings opt into a richer body by implementing two optional slots on `HabitatModule`:

- `getOverviewCards(row): OverviewCard[]` — one drillable card per item. Cards render between the action shelf and the activity log in the overview pane, sorted severity-desc then subtitle-asc by the shell. Each card carries `{ id, eyebrow, headline, subtitle, severity, sourceUrl? }`. Clicking a card swaps the modal body to the detail pane and invokes `renderDetail` with the card's id.
- `renderDetail(row, cardId): ReactNode` — body content for the detail pane. The shell provides a prominent back affordance above whatever this returns and reuses the same header and footer the overview pane uses. The detail content gets the full body width with no inner chrome.

Modules can also set `overviewCardsHeader: string` to override the default section title ("Details"). Modules that implement neither slot get exactly the modal that landed before the slotted shell was introduced — radon stays single-finding by design and the shell stays out of its way.

The back affordance in the detail pane is UX-load-bearing for non-technical users: a full-width sticky row at the top of the scroll area, 44px minimum tap target, chevron-left icon + label that includes the total card count when there is more than one ("Back to all 5 findings"). Focus moves to the back button when entering the detail pane and returns to the originating card when leaving, using a card-id-keyed ref map maintained by the shell. ESC, the close button, and backdrop click close the modal entirely from either pane — they do not first walk back through the overview. Pane state resets to overview when the modal closes, so reopening always lands on the overview pane without a flash of detail-pane content.

Footer behaviour follows the pane: in the overview the "View source" link points to the row's `source_url`; in the detail pane it points to the active card's `sourceUrl` (with the row's `source_url` as fallback when a card doesn't provide one). Activity log stays in overview — the log narrates module-wide reasoning, not per-item context. Per-item reasoning lives inside whatever the module renders in its detail pane (the Superfund SiteDetail component is the reference example).

The modal's mechanics (scroll-lock via the `.scroll-locked` class, focus trap, ESC handler, backdrop-click close, return focus on unmount) are lifted from `components/document-modal.tsx`. We did not extract a shared base modal in this PR — two callers is the threshold for extraction and the codebase has exactly two now. The next modal that lands should pull a shared primitive out of those two in one step.

### Severity tokens

`components/habitat-severity.tsx` exports `SEVERITY_COLOR` (CSS-variable map keyed by the 6-stop severity scale), `SEVERITY_WORD` (sentence-case labels), and a small `SeverityDot` component the compact tile and the modal both render. Two severities share a color (`concern` + `critical` → danger, `favorable` + `beneficial` → success); the textual severity word carries the finer distinction.

### Action chip

`components/habitat-action-chip.tsx` is the shared chip that renders a single `FindingAction`. Product chips use the accent treatment; link and service chips stay subtler. Every chip opens in a new tab via `target="_blank" rel="noopener noreferrer"`. The chip is rendered in two places today: the modal's action shelf, and (potentially) any future surface that wants to surface module actions.

### `HabitatFinding.actions` and `FindingAction`

A module's `check()` may return an `actions: FindingAction[]` field on its finding. The orchestrator persists it into the `hearth.habitat_findings.actions` jsonb column on the completed-status upsert. `FindingAction` is a discriminated union of three kinds:

- `product` — a consumable (e.g. test kit). URL is wrapped in `affiliateLink()` at construction time. Optional `priceHint` shown subtly next to the label.
- `link` — informational link (EPA page, county GIS, etc.).
- `service` — a directory or finder for local professionals (mitigators, inspectors).

Actions are per-finding rather than per-module because the right call to action depends on what the module actually returned: Zone 1 radon and Zone 3 radon share a module but surface different next steps. The dashboard renders product chips with the accent treatment so they read as the primary affordance; link and service chips stay subtler.

### Affiliate-link chokepoint

`lib/affiliate/link.ts` exports a single `affiliateLink(url)` function. It is identity passthrough today and is the only place we will later inject Amazon Associates tags (or per-region storefront swaps, AAX redirects, etc.). Every module that emits a product URL routes it through this helper, so adopting affiliate revenue becomes a one-file change. A trivial test in `link.test.ts` asserts identity today and will fail the moment we start mutating URLs, prompting an update of the contract callers rely on.

### Activity log on every check()

Every habitat module's `check()` emits a structured **activity log** — a step-by-step record of what the module did during that run, persisted to the `activity_log` jsonb column on `hearth.habitat_findings` alongside the finding itself. The helper is `createActivityLogger()` from `lib/habitat/activity-log.ts`; the module calls it at the top of `check()`, emits `log.step({ kind, narration, ... })` at meaningful points, calls `log.finalize()` before returning, and attaches the result as `activityLog` on the returned `HabitatFinding`. The orchestrator writes that into the column on the completed-status upsert.

The log is **module-emitted, not framework-derived** — the orchestrator does not observe the module and try to infer what it did. The module explicitly emits each step it considers meaningful. This keeps the log honest: it describes what the module *thinks* it did, not what the framework guessed it might have done. Step kinds (`fetch` / `rule` / `compute` / `decide` / `finding` / `error`) loosely categorize the step so a future detail view can render them differently if useful.

The log is a **frozen-in-time artifact of one specific run**, not module documentation. If a module's logic changes later, old findings on rows that aren't re-checked still have logs describing the old behavior. That's correct — the log records what happened the last time the user's house was checked. The finding detail modal renders the log as a vertical narrative timeline ("How we got here"); each step's `narration` is the primary line, `result_summary` an inline pill, `detail` a small mono block, and `source` a link to the upstream citation.

**Narration voice:** `narration` strings are written in first-person voice ("I checked…", "I looked up…", "I'm flagging this as…") so the log reads like a person doing the lookup for the user. Jargon, URLs, and raw lookup keys go in the optional `detail` field, not in `narration`. Citations for rules and datasets go in `source` so the user can verify what was applied. Failure paths emit an `error` step before re-throwing; that step is not persisted (no log is returned on throw, by design — partial-log persistence on failure is a deferred concern), but the in-code emission keeps the module's intent readable.

The radon module (`lib/habitat/modules/epa-radon-zone/index.ts`) is the reference implementation: it emits a five-step log on success (`fetch` → `compute` → `rule` → `decide` → `finding`) and an `error` step before re-throwing on the dataset-miss paths. New modules should mirror this shape.

**Conventions calibrated against the radon log:**

- **Narration voice** — first-person singular ("I checked," "I'm flagging"), sentence case with full punctuation, no log-style fragments. Decide steps follow the input → output → system-behavior shape: "Because your county is in Zone 1, I'm flagging this as a 'concern' in Hearth's classification so it surfaces near the top of your dashboard."
- **`detail` field** — terse, code-flavored technical receipt. File paths, lookup keys, threshold values, transformations (`zone(1) → severity('concern')`). Distinct from narration: narration is for the user, detail is for the curious reader who wants to see what the module actually did.
- **`result_summary`** — only on steps where the outcome is the point of the step. Steps 1 and 2 of the radon log don't have one (they're setup); steps 3, 4, and 5 do.
- **Source citations** — every `fetch` step cites the upstream dataset, every `rule` step cites the external authority the rule derives from, every `decide` step cites Hearth's own classification page for that module. A step without an appropriate citation is a red flag — either the source is missing or the step shouldn't exist.
- **Per-module documentation** — every new module's file opens with a comment block sketching the narration arc (3–7 lines describing the story the log tells) and listing the source citations the log uses. Same shape as the block at the top of the radon module.

**Timing fidelity.** `createActivityLogger` uses `performance.now()` directly (Node 18+ and all browsers have it). `at_ms` and `total_duration_ms` are rounded to 1 decimal place — sub-millisecond resolution is enough to distinguish fast in-memory steps without storing float noise in jsonb. An earlier fallback to `Date.now()` caused every radon step to report `at_ms: 0` because the whole check ran inside a single millisecond tick.

### Methodology page — `/how-it-works`

The `/how-it-works` route at `app/(app)/how-it-works/page.tsx` is Hearth's in-app methodology document. It covers two surfaces today: the **inventory system** (how items get captured via Smart Uploader → Grok nameplate analysis → confirmed entry, what the detail page surfaces, what "Research this model" does) at a high-level user-facing depth, and each **habitat module's classification logic** — the table that maps raw data into a Hearth severity — alongside the upstream sources and any model-vs-authority note where Hearth's interpretation diverges from the original publisher. A "Maintenance — coming soon" teaser sits between the two while that module is being designed. Every habitat finding's activity log cites this page from its `decide` (and, for Superfund, `rule`) step.

The page lives inside the `(app)` route group so it inherits the standard app shell (top nav, desktop sidebar, bottom nav) and authentication gate. Anonymous visitors clicking a `/how-it-works` link from outside the app are bounced to `/login` by the proxy like any other authenticated route.

Anchor IDs on the page (`#radon`, `#superfund`, `#flood-zones`) are load-bearing — they're embedded verbatim in the `activity_log` JSONB of every existing `habitat_findings` row, frozen-in-time. The slug version of the module key (without the `epa_` or `fema_` source prefix) is the convention for future modules. Old findings persisted with the prior `/about/classification#<anchor>` URL still resolve via a permanent redirect rule in `next.config.ts`; browsers carry the anchor through the redirect automatically, so no per-anchor rules are needed.

**Governance principle (load-bearing).** Modifying a habitat module's classification logic without updating its corresponding section in `/how-it-works` is a regression. The page is Hearth's public methodology, and the activity log on every finding tells users they can read this page to understand how the finding was produced. If the page is out of date with the code, users get inaccurate transparency, which is worse than no transparency at all. Module PRs that change classification thresholds, severity mappings, or data sources must include corresponding edits to `app/(app)/how-it-works/page.tsx` and update the "Last updated" date for that module's section. The same discipline applies to the inventory section: PRs that meaningfully change the capture pipeline (e.g. swapping the nameplate analysis model, materially changing what "Research this model" returns) should update the Inventory section's prose and sources block to match.

### `HabitatModule.iconImage`

Each module may declare an optional `iconImage` (a root-relative path under `/public`). When present, the dashboard's compact tile renders it as a 72px square hero on the left of the tile. Module definitions stay serializable — we use string paths, not imported asset modules. Module hero images live under `public/habitat_module_images/` (e.g. `radon.jpg`).

### EPA Superfund Proximity module

The second shipping habitat module (`lib/habitat/modules/epa-superfund-proximity/`). It hits EPA Envirofacts SEMS at [`https://data.epa.gov/efservice/sems.envirofacts_site/...`](https://www.epa.gov/enviro/envirofacts-data-service-api) to pull every NPL-relevant Superfund site in the house's state (left-joined to `sems.envirofacts_contaminants`), measures haversine distance from the home to each site's EPA-provided point, and applies a three-tier proximity model based on EPA's standard 1- and 3-mile community-impact rings:

- **Tier 1** (≤ 0.5 mi) includes any NPL status — Final (F), Proposed (P), Part of NPL site (A), or Deleted (D).
- **Tier 2** (0.5–2 mi) includes only F and P.
- **Tier 3** (2–5 mi) includes only F.

Severity maps from tier + NPL status: Tier 1 + F/P → `concern`; Tier 1 + A/D → `caution`; Tier 2 + F/P → `caution`; Tier 3 + F → `neutral`; zero qualifying sites within 5 mi → `favorable`. The top-level finding severity is the worst across qualifying sites. `findings.sites` is sorted by `label`-desc → `severity`-desc → `distance`-asc (see "Finding label and portfolio summary" below) — the module owns the sort, and the modal renders cards in the order the module returns them.

Cadence is `yearly` — the NPL list and statuses do change but slowly. Issue #160 added a per-state cache layer (`hearth.epa_envirofacts_state_cache`, see "Per-state Envirofacts cache" below) to amortize the slow EPA Envirofacts call across every user in the same state; the finding payload still uses the `{ site, context }` per-entry shape (place-in-the-world facts vs per-house relationship) so a future per-house cache migration is similarly mechanical.

Three EPA quirks the module handles explicitly. (1) Many sites arrive with `null` coordinates and are filtered out before any distance math, with the dropped count surfaced in the activity log. (2) Every text field arrives ALL CAPS, so site names, addresses, and contaminants flow through a `titleCase()` helper that preserves initialisms like `LLC`, `DOT`, `USN`, `PCB`, renders business suffixes like `INC` as `Inc.`, and collapses spaced hyphens (EPA returns `"GEORGIA - PACIFIC CORPORATION"` with surrounding spaces; the module renders it as `Georgia-Pacific Corporation`). (3) The joined `sems.envirofacts_contaminants` table exposes its contaminant in the `preferred_contaminant_name` column — *not* `contaminant_name`. The site's own `name` rides along on every joined row, and an earlier implementation that fell back to `name` reported the site's own name as its contaminant; the picker now reads only `preferred_contaminant_name` (with `contaminant_name` as a defensive fallback against future schema renames).

Some SEMS records aggregate multiple physical locations into one row (Allied Paper, Inc./Portage Creek/Kalamazoo River is the canonical example — a single record covering 80 miles of river and several landfills). The module flags those at qualification time: a site whose `name_original` contains a `/` gets a `precision_note` string on its `findings.sites[].context`, and when at least one qualifying site carries the caveat, the activity log gains a conditional `compute` step between the distance and the tier-filter steps that names the flagged sites. With the label-rollup and portfolio-summary compute steps landed for issue #140, the CIC enrichment step landed for #143, the recommended-actions step landed for #144, and the conditional empty-contaminant suppression step landed for #154, current step counts are: single-location hit path 10, multi-location hit path 11, +1 if at least one site was dropped for empty contaminants, no-hits path 6 (no sites to label, enrich, summarize, or act on). Polygon-edge distance and cleanup-milestone enrichment from `sems.envirofacts_site_milestone` are deliberate v2 deferrals.

The tier model is Hearth's, not EPA's. The activity log's `rule` step cites our own `/how-it-works#superfund` page rather than `epa.gov/superfund` — EPA's published guidance uses 1- and 3-mile rings in community-involvement work, but does not publish a "community-impact rings" standard. Citing it as if it did would overstate provenance.

The Superfund module is also the first consumer of the modal's slotted shell (see "Tile + trigger + modal" above). It implements `getOverviewCards(row)` to return one card per qualifying site — eyebrow leads with the computed label word (`Worth acting on · D mi BEARING · Tier N`) when the per-site label is populated, falling back to the legacy `Tier N · D mi BEARING` shape when the label is suppressed, headline is `name_display`, subheading is a sentence-case plain-English contaminant-category summary (issue #145; `Heavy metals`, `Volatile organic compounds and heavy metals`, etc., suppressed when EPA hasn't published contaminants for the site), subtitle is `address.street · npl_status.label`, severity is the per-site severity, and `sourceUrl` is the EPA Cumulis profile URL. It implements `renderDetail(row, cardId)` to mount `lib/habitat/modules/epa-superfund-proximity/components/site-detail.tsx`, which keeps the module-specific UI co-located with the module rather than leaking into the shared modal. The detail body's section order is reshuffled per issue #146 (see "Site Detail card section reshuffle" below); `index.ts` stays a `.ts` file by passing the component through `createElement` rather than JSX — the SiteDetail component is the only place in this module that imports React JSX. Per-site payload shapes live in `./types.ts` so `index.ts` and `site-detail.tsx` can both consume them without forming an import cycle.

The module also implements the two new optional `HabitatModule` slots introduced by issue #140. `getFindingLabel(row)` reads the persisted `portfolio_label` and returns `{ word, color }` from the [`label.ts`](../lib/habitat/modules/epa-superfund-proximity/label.ts) lookup tables. The modal renders that word in the header eyebrow in place of the default severity word; when `getFindingLabel` returns `null` the header shows the severity dot and module name only (deliberately suppressing the second eyebrow word rather than falling back to a neutral severity word that could read as Hearth-endorsed reassurance). `getOverviewBanner(row)` reads `portfolio_summary.text` and returns a plain `{ text }` shape that the modal renders as a surface-raised paragraph at the top of the overview pane, above the cards list. Both slots return `null` for rows persisted before #140 (the fields aren't on those rows yet), restoring the modal's prior behavior — the yearly cadence backfills naturally.

The persisted per-site shape (`findings.sites[].site`) carries two SEMS fields that aren't surfaced anywhere else in the module: `archived_date` (the EPA-supplied ISO date string, present only when `archived` is true) and `epa_region_code` (the zero-padded region code, e.g. `"05"`). Both arrive from `SemsSiteRow` and are passed through verbatim; the display layer parses them via `formatArchivedDate` and `formatEpaRegion` in [`format.ts`](../lib/habitat/modules/epa-superfund-proximity/format.ts). Both fields are nullable on the row contract and absent on rows persisted before the quick-facts block landed — the display component renders gracefully in either case (Site status falls back to bare `"Archived"` without a date, and the EPA Region row is omitted entirely). Rows backfill naturally on the next yearly cadence run; no migration is needed.

#### EPA contacts and documents (issue #143)

The Envirofacts REST API exposes the base site record only — address, NPL status, archived flag, region, federal-facility indicator. The fields that make the per-site detail card actually useful for a homeowner (a contact to email with questions, a deep link into the documents library) live on the rendered Cumulis profile pages and aren't available through any sibling table in the SEMS schema. [`cumulis.ts`](../lib/habitat/modules/epa-superfund-proximity/cumulis.ts) carries the small per-site scrape that fills the gap.

Two pieces:

- **`siteDocumentsUrl(siteId)`** — deterministic URL build. No scraping, no HTTP. Constructed verbatim from the zero-padded site_id and the canonical `SiteProfiles/index.cfm?fuseaction=second.docdata` path. Lands on every qualifying site as `findings.sites[].site.documents_url`.
- **`fetchSiteContacts(siteId)` + `parseCommunityInvolvementCoordinator(html)`** — GETs the Contacts sub-page and parses the CIC block. The CIC is the homeowner-facing EPA contact for the site — distinct from the Remedial Project Manager, which is the technical-cleanup contact and not surfaced here. Soft-fail at every step: a network / parse miss leaves `community_involvement_coordinator: null` on that site entry, and one failed lookup never affects the others.

The enrichment fires inside `check()` after the tier filter, in parallel across the (small, post-distance-filter) set of qualifying sites — at single-digit n the wall-clock cost is ~1s in the worst case. The activity log gains a `compute` step between the tier rule and the label rollup that reports the hit ratio (`"2 of 3 sites have a CIC"`). The no-hits path skips the enrichment entirely (nothing to enrich) so its log shape is unchanged at 6 steps; multi-location hit path goes from 9 to 10 steps and single-location hit path from 8 to 9.

The persisted CIC shape is three-state:
- `community_involvement_coordinator: { name, email, phone }` — populated when EPA published a CIC and the parser pulled it cleanly. Each sub-field is independently nullable (most sites have name + email; phone is occasionally absent).
- `community_involvement_coordinator: null` — lookup attempted, no CIC published. The display layer renders honest "EPA hasn't designated a Community Involvement Coordinator for this site" copy rather than hiding the section.
- `community_involvement_coordinator: undefined` — legacy row from before #143 landed. The display layer suppresses the whole Site-Contact-and-Documents section in this case so legacy rows render exactly like they did before; yearly cadence backfills naturally.

The fields the original issue spec also mentioned but that proved unworkable in this PR — Five-Year Review history with dates, NPL sub-stage decoding (`remedy in place` vs. `long-term monitoring`), mailing list / Community Advisory Group signup URLs — are deferred. The FYR + sub-stage data exists on the Cumulis cleanup page but only as unstructured prose ("Construction of the remedy took place between 1987 and 2010. Operation and maintenance activities are ongoing.") that would need an LLM extraction pipeline to make useful; that work is its own follow-up issue. Mailing list / CAG signup isn't consistently published anywhere on EPA's site templates.

**Site profile URL bug fix.** While probing the Cumulis URL patterns for the #143 work, we discovered the existing `siteProfileUrl()` was producing 404 URLs in production. The old helper used the legacy `/cursites/csitinfo.cfm` path AND stripped leading zeros from the site_id; the combination resolved to a "No site is found" error page on every site. The fix (in [`cumulis.ts`](../lib/habitat/modules/epa-superfund-proximity/cumulis.ts)) pins to the canonical `/SiteProfiles/index.cfm?fuseaction=second.scs` path with the zero-padded id preserved. Same exported name (`siteProfileUrl`), same signature — call sites switched their import from `./fetch` to `./cumulis`.

#### Per-card subheading (issue #145)

The overview-card list inside the finding modal renders each qualifying site as a row. After issue #145, each row carries an optional plain-English contaminant-category subheading between the site name (headline) and the address line (subtitle), so a user can triage what's actually at a nearby site without opening the detail pane. The subheading is sentence-case ("Heavy metals", "Volatile organic compounds and heavy metals"), capped at three categories with "and other contaminants" appended when there are more, and suppressed entirely when EPA hasn't published any contaminants for the site (Georgia-Pacific is the canonical empty-inventory case — the card falls back to headline + subtitle as before, no awkward blank row).

The phrasing is generated by [`summarizeContaminantCategories`](../lib/habitat/contaminants/categories.ts) — a shared helper that lives next to the canonical contaminants table because both the per-card subheading AND the #144 recommended-actions supporting lines summarize categories the same way (heavy metals lead, common minerals trail, Oxford comma between three labels). The helper returns lowercase phrasing for inline use ("documented heavy metals and chlorinated solvents that can migrate..."); [`capitalizeCategoryPhrase`](../lib/habitat/contaminants/categories.ts) is the one-character sentence-case transform the subheading call site applies. Both the `CONTAMINANT_CATEGORY_LABELS` map and the `CONTAMINANT_CATEGORY_PRIORITY` ordering moved out of `recommended-actions.ts` and into `categories.ts` so the labels stay consistent across surfaces.

Issue #145's original spec also proposed translating the subtitle's NPL-status pill into a plain-English cleanup-stage label ("Active cleanup" instead of "Final NPL"); that's a separate small follow-up — Todd opted to land just the contaminant-category subheading in this PR so the corporate site name stays as the visual anchor on each card. The `OverviewCard.subheading` field is generic (other modules that ship multi-item findings later can populate it without changes to the modal).

#### Per-state Envirofacts cache (issue #160)

EPA's Envirofacts SEMS REST endpoint is consistently slow (~20s for a typical state response) and returns the same payload for every user in a given state. Without caching, two users in MI pay 40 seconds of EPA latency total to fetch the exact same data twice — fine at single-digit beta, painful once the neighborhood beta-test set grows.

[`cache.ts`](../lib/habitat/modules/epa-superfund-proximity/cache.ts) sits between `index.ts` and `fetch.ts` as a thin caching wrapper. It exposes a small `EnvirofactsCacheStore` interface (lookup + upsert) and a `fetchNplSitesInStateCached(state, store)` function that checks the store first, falls through to `fetchNplSitesInState` on miss / expired / lookup-error, and upserts the response back into the store after a successful fetch. The production factory `createSupabaseEnvirofactsCacheStore()` reads / writes `hearth.epa_envirofacts_state_cache` (migration `20260524210736_epa_envirofacts_state_cache.sql`) — primary key on the uppercased 2-letter state code, `jsonb` for the merged `NplSite[]` payload, `timestamptz` for `fetched_at`. No RLS — it's pure server state, only touched by the workflow's service-role client.

**TTL = 7 days**, enforced in app code (`CACHE_TTL_DAYS` in [`cache.ts`](../lib/habitat/modules/epa-superfund-proximity/cache.ts)) rather than the database. NPL statuses change slowly enough that a week-old cached response is functionally identical to a fresh one, and 7 days comfortably covers a weekend of beta testing across multiple neighbors. The constant is the only thing to tune if the cadence needs revisiting.

**Soft-fail at every step**, on purpose. Cache lookup errors (Supabase outage, missing env vars in a test environment, schema drift) resolve to `{ kind: "miss", reason: "lookup-error" }` so the EPA fallback always runs. Upsert errors get logged via `console.warn` but never thrown — the current request still returns its data; the next request just won't have a warm cache yet. An additional env-presence gate at the top of both `lookup()` and `upsert()` silently returns without a warning when Supabase env vars aren't configured (the unit-test runner case), so a development setup or test run that doesn't wire up Supabase doesn't flood stderr.

The activity log's `fetch` step narrates the cache outcome honestly. On a hit: `"I had a cached EPA Superfund response for MI from 4 days ago (within the 7-day cache window), so I used that instead of re-fetching."` with detail `Cache hit: state=MI, fetched_at=…, age=4d, ttl=7d` and `result_summary: cache: hit (4d old)`. On a miss the existing fetch copy is preserved and the detail line names the miss reason (`no-row`, `expired`, or `lookup-error`) before the EPA URL.

The cached payload is the **merged** `NplSite[]` (post-`mergeContaminants`), so cache hits skip both the EPA HTTP call AND the in-memory merge. A typical Kalamazoo, MI check goes from ~30s end-to-end to ~8s end-to-end on a warm cache (just the portfolio-summary AI call).

The companion follow-up #161 will add a sibling per-site cache for the Cumulis CIC scrape (another ~1–2s on a 4-site portfolio); the schema and pattern mirror this one.

#### Empty-contaminant suppression (issue #154)

EPA's SEMS database includes child rollup entries under some NPL parent listings. Those child rows can be tier-qualifying (close, with an NPL status code) but carry zero rows in the `sems.envirofacts_contaminants` join — the parent record holds the chemistry details and the child entry has nothing for us to render. The 604 Norton Dr fixture's canonical example is Georgia-Pacific Corporation: 0.4 mi away, status `A`, zero contaminants joined, and the EPA profile URL 404s for it. The card on the modal would carry a name, a bearing, and a dead link.

Issue #154's filter sits inside the qualification loop in [`index.ts`](../lib/habitat/modules/epa-superfund-proximity/index.ts): after `applyTier()` returns non-null and `buildSiteEntry` runs, if `entry.site.contaminants.length === 0` the entry is moved into a `droppedNoContaminants` array instead of `qualifying`. Everything downstream — `qualifying.length` (which feeds the headline and summary), CIC enrichment, label rollup, AI summary, recommended-actions, the per-site cards — automatically reflects only the useful sites with no special-casing.

The activity log gains a conditional `compute` step right after the `rule` step naming the dropped sites in its detail line. The step is emitted only when `droppedNoContaminants.length > 0`; multi-location hit path with one suppressed site goes from 11 to 12 steps in that case. The rule step's narration still reports tier-pass count (pre-suppression) so the math reads coherently — N sites passed the tier filter, M were then dropped for missing inventories, N-M flowed into the rest of the analysis.

When **every** tier-qualifying site is suppressed, the module falls through to the favorable no-hits branch. The no-hits summary copy grows a conditional clause acknowledging the suppression ("We checked 2 additional sites that EPA's database knows about but for which it hasn't published a contaminant inventory…") so the activity log and the summary tell a consistent story. The empty / non-suppressed no-hits case stays unchanged.

The filter is positive-list rather than NPL-status-based on purpose: an `A`-status site **can** carry contaminants when EPA has populated the child-level inventory, and a `D`-status site with documented chemistry is still worth surfacing. Empty contaminants is the actual "EPA has nothing substantive to tell us" signal. The `computeSiteLabel` suppression branch (Tier 3 + empty contaminants → null label) is now dead code in the production pipeline since the upstream filter catches the same case earlier; it stays in [`label.ts`](../lib/habitat/modules/epa-superfund-proximity/label.ts) as a defensive guard with a unit test in `label.test.ts`.

#### Label tightening with pathway alignment (issue #149)

Issue #140's first-slice `computeSiteLabel` rules ran on distance tier, NPL status, and highest contaminant concern level — the inputs we had on day one. After #142 added `waterSource` and `basementPresent` to `HouseContext` and #147 added `pathways` to the canonical contaminants table, #149 tightens the rules in place to factor in pathway alignment with the homeowner's actual situation. Two new escalation paths join the original v1 rule:

- **(b) Well-water + groundwater pathway.** Tier 1 or Tier 2 active cleanup + `waterSource ∈ {well, shared}` + at least one high-concern contaminant whose `pathways` includes `groundwater`. A chlorinated solvent at a Tier 2 active site flips from `worth_knowing` to `worth_acting_on` for a well user, because groundwater is the path that contaminant travels by and the user is downstream on that aquifer.
- **(c) Basement + vapor-intrusion pathway.** Tier 1 (the half-mile precautionary radius) active cleanup + `basementPresent === true` + at least one high-concern contaminant whose `pathways` includes `vapor_intrusion`. The v1 rule already escalates Tier 1 + F/P + high concern regardless of pathway, so (c) is technically redundant at Tier 1 today; it's encoded explicitly because the issue spec calls for it and so the rule stays correct if v1's concern threshold is ever relaxed.

Heavy metals and persistent organics like PCBs travel through multiple media and don't depend on the homeowner's water source — the v1 rule (Tier 1 + F/P + high concern → `worth_acting_on`) catches them regardless of the new inputs. AC #2 (Tier 1 + PCBs stays `worth_acting_on` for any water source) is satisfied by v1.

**Suppression discipline.** `waterSource ∈ {null, "unknown"}` and `basementPresent === null` disable the new pathway-aligned escalations. The v1 fallback still produces a label (`worth_knowing` or `informational` or, for Tier 3 + empty contaminants, `null`). Users who skipped both onboarding questions never get an inflated label — AC #3.

**Portfolio summary prompt.** [`portfolio-summary/prompt.ts`](../lib/habitat/modules/epa-superfund-proximity/portfolio-summary/prompt.ts) now forwards the same two property-situation fields into the user message as a "Homeowner property context" block. The block is emitted only when at least one of the fields carries a real value (not null / unknown), so the model defaults to no pathway commentary when the user skipped onboarding. The system prompt gains a paragraph that allows the model to mention pathway alignment ("the groundwater pathway here aligns with your private well") when the context is provided AND it materially changes the framing — and explicitly forbids inventing context that wasn't provided.

#### Site Detail card section reshuffle (issue #146)

Phase 1 of the Superfund risk-reasoning UI (PR #141) left the per-site detail body in the order: header → address → precision caveat → site contact & documents → contaminants list. Issue #146 restructured the body to lead with synthesis and demote the heavier chemistry list, while keeping every section that carries concrete homeowner value. The new order in [`site-detail.tsx`](../lib/habitat/modules/epa-superfund-proximity/components/site-detail.tsx):

1. **Site header** — site name + metadata pills (unchanged).
2. **Address card** — address + quick facts (unchanged).
3. **Precision caveat** — conditional, as before.
4. **What's distinct about this site** — NEW. 1–3 short facts computed by `computeDistinctFacts(thisEntry, allEntries)`: "closest of the nearby sites to your home", "only nearby site currently in active EPA cleanup", "only nearby site with documented [PCB and dioxin / heavy metal / etc.] concerns". Suppressed entirely when the portfolio is a single site (nothing to compare) or when no heuristic fires. Pure function exported from `site-detail.tsx` and unit-tested.
5. **How contamination from this site typically spreads** — NEW. Collapsible native `<details>` element. Body holds one short paragraph per pathway resolved from the site's contaminants, sourced from the static `PATHWAY_EXPLANATIONS` map in [`contaminants/data.ts`](../lib/habitat/contaminants/data.ts). Static, not LLM — same wording for every site that shares the same pathway profile. Suppressed when no pathway resolves (empty contaminants, only unknown EPA strings).
6. **What you can do** — RENAMED from "Site contact and documents". Same content as #143 (CIC contact + documents library link), just an eyebrow rename so it reads as actions the homeowner can take on this specific site (vs. the portfolio-level "Recommended for your situation" section above the per-site cards).
7. **Contaminants list** — KEPT. The most concrete value the modal carries; promoting "What you can do" above it lets a user triage and contact without scrolling through chemistry first, and demoting it below the new sections shifts emphasis onto synthesis without losing the chemistry detail.
8. **How we got here** — NEW transparency block. Names EPA Envirofacts SEMS as the upstream dataset, links to Hearth's `/how-it-works#superfund` methodology page for the tier / label / suppression rules, and surfaces the row's `checked_at` timestamp as "Last checked: \<short date\>". Always renders — every finding has a source and a check date.

The original #146 spec also listed a fifth section, "Cleanup trajectory" (Five-Year Review status + recent milestones + next scheduled review date). EPA publishes FYR data only as unstructured prose on Cumulis cleanup pages today; ingesting it would need its own LLM extraction pipeline and is tracked as a separate follow-up. NPL status and archived state already appear in the Address card's quick-facts column, which carries the cleanup-stage signal we have without the FYR ingestion.

`computeDistinctFacts` is pure (inputs are a single site + the portfolio array) so it's straightforward to unit-test. The heuristics are deliberately strict — strict-less-than for the closest fact (so a tie doesn't fire it for both sites), only one high-concern category called out per call (the rest land on the overview-card subheadings and the contaminants list below), and a hard cap of three facts. The section is the "lead with what's specific about this site" surface; quantity dilutes it.

#### Recommended actions (issue #144)

The finding modal renders a "Recommended for your situation" section between the AI portfolio summary and the per-site card list. The actions are computed in [`recommended-actions.ts`](../lib/habitat/modules/epa-superfund-proximity/recommended-actions.ts) at check() time from the qualifying-site set plus the user's `waterSource` and `basementPresent` off `HouseContext` (the #142 fields), and persisted on `SuperfundFindings.recommended_actions`. The modal slot `getRecommendedActions` is a pure read off the persisted array — the slot pattern matches `getFindingLabel` and `getOverviewBanner` (compute happens in check() where the full context is available; the slot just returns the data so the modal can render it).

Three action types in v1:

- **Test your well water** — fires for `waterSource ∈ {well, shared}` when any qualifying site has a contaminant whose `pathways` (issue #147) includes `groundwater` AND that contaminant's `concern_level` is moderate or higher. The supporting line lists up to three plain-English contaminant categories present at the qualifying sites (heavy metals / volatile organic compounds / etc.), capped to keep the card readable; if more categories are present, "and other contaminants" is appended. Links to EPA's certified-lab directory.
- **Check your utility's water quality report** — fires for `waterSource === "municipal"` under the same contaminant condition. Links to EPA's CCR search tool and mentions the user's city in the supporting line (the CCR tool is a search form, not a URL-driven landing page, so the city helps the user search effectively rather than appearing as a URL parameter).
- **Check for vapor intrusion concerns** — fires only when `basementPresent === true` AND at least one Tier 1 site (≤0.5 mi) has a contaminant whose `pathways` includes `vapor_intrusion`. The half-mile gate is the "defensible precautionary radius" the issue specified — it maps directly onto the existing tier model, no separate radius math. Links to EPA's vapor-intrusion overview.

Suppression matches the project pattern (the #140 label work, the #142 property-situation defaults): a `null` or `"unknown"` water source produces no water-test action of either flavor (we can't responsibly recommend without knowing the source); `basementPresent !== true` produces no vapor-intrusion action (skip rather than alarm households that don't have one). When the user is on municipal water and the portfolio has only soil-only contaminants (no groundwater pathway hits), no actions fire at all — the modal section is suppressed entirely and the layout falls back to (summary → cards → log) as before. The activity log gains a `compute` step between the summary step and the decide step that reports `N recommended action(s)` plus the action IDs in `detail`, including the zero case so a future debugging session can see why no actions were emitted.

The contaminant-category-to-plain-English mapping (`CATEGORY_LABELS` in recommended-actions.ts) is a small editorial map keyed by `ContaminantCategory`. Editorial priority ordering (`CATEGORY_PRIORITY`) determines which categories survive the three-label truncation when many are present — VOCs and heavy metals lead, common minerals and nutrients trail, so the trailing "and other contaminants" suffix drops the least-relevant family first. Both maps live in the actions module rather than the canonical contaminants table because they're rendering concerns specific to this action's framing.

The static "EPA Superfund overview" link in `actions: buildHitActions()` is unchanged — it still renders in the modal's secondary action shelf. The recommended-actions section is structurally distinct (cards with icons, headlines, paragraphs, optional links) and replaces nothing.

#### Finding label and portfolio summary (issue #140)

Issue #140 introduced two parallel additions to the Superfund finding shape: a computed `label` axis (per-site and rolled up to a portfolio label) and an AI-generated `portfolio_summary` paragraph. Both live on the existing `findings` jsonb — no schema migration is needed, and rows persisted before #140 backfill on the next yearly cadence run.

**Label.** The `SuperfundLabel` type in [`label.ts`](../lib/habitat/modules/epa-superfund-proximity/label.ts) is `"worth_acting_on" | "worth_knowing" | "informational"`, with `null` reserved for the suppression case ("we can't characterize confidently — show nothing rather than default to a bare word that could read as Hearth-endorsed reassurance"). The label is a *separate axis* from `HabitatSeverity`: severity stays load-bearing for the dashboard dot and module-level top severity, while the label is the issue's preferred visual anchor in the finding modal. `computeSiteLabel({ tier, nplCode, contaminants, waterSource, basementPresent })` derives the per-site label from the v1 inputs plus the issue #149 property-situation extensions (pathway-aligned escalation against well water and basement presence — see "Label tightening with pathway alignment" below); `computePortfolioLabel(labels)` rolls per-site labels up to a single portfolio label (max non-null label, null when every per-site label is suppressed).

**Portfolio summary.** The AI-generation pipeline lives under [`portfolio-summary/`](../lib/habitat/modules/epa-superfund-proximity/portfolio-summary/) and follows the same prompt + schema + generate split as the inventory-insights and maintenance-synthesis pipelines. `prompt.ts` enforces five hard rules in the system prompt: (1) never assert the property is or isn't contaminated (the load-bearing acceptance criterion); (2) hedge calibrated, not vague; (3) synthesize, don't repeat per-site detail; (4) translate NPL codes into plain English; (5) hard cap of 4 sentences. The Zod schema is intentionally narrow — `{ summary: z.string().min(40).max(1200) }` — and `generate.ts` is **soft-fail by design**: when the env var is unset or the AI call throws, the module persists a `text: null` summary with the error reason on the finding (and a `console.warn`); the finding itself ships either way. The check() call awaits the summary inside the multi-site path; the no-hits path skips the call entirely (nothing to summarize).

**File-based debug log (issue #158).** The inventory-insights, serial-decode, and maintenance-synthesis pipelines each land a `logs/*-prompts.log` developer file via `node:fs/promises` and `node:path`. The Superfund summary call landed its own — `logs/superfund-summary-prompts.log` — via a small side-channel pattern rather than the larger "lift the AI call into a workflow step" refactor.

The mechanic: `generatePortfolioSummary` now returns a `debug: PortfolioSummaryDebugCapture` field alongside the existing `{ text, model, generated_at, error_reason }`, capturing the assembled system prompt, user message, input shape, timing, and outcome (success or error_reason). The Superfund module's `check()` forwards that capture as `finding.debug.portfolio_summary` on the returned `HabitatFinding`. The orchestrator in `workflows/habitat.ts` reads `finding.debug` after `runOneModule`'s persist step completes and dispatches each populated slot to the matching writer via a new `writeModuleDebugLog` `"use step"`. The step uses dynamic `await import("@/lib/habitat/modules/epa-superfund-proximity/debug-log")` to pull in the helper — that's load-bearing: the helper statically imports `node:fs/promises`, and the workflow bundler blocks any Node built-in reachable through static imports from `workflows/habitat.ts`. Dynamic import inside a `"use step"` puts the helper on the step bundle (which has Node available) rather than the workflow bundle (which doesn't). The maintenance-synthesis log's `logSynthesisDebug` step is the reference pattern.

The `debug` field on `HabitatFinding` is **transient** by design — the orchestrator pulls `finding.findings` / `actions` / `activityLog` / `sourceUrl` explicitly for the row write, and `debug` is never one of them. The type's docstring spells this out so future modules don't accidentally rely on the field surviving the workflow. The slot map is `Record<string, unknown>` so any module that wraps an AI call can populate its own keyed slot and add a matching dispatch case to `writeModuleDebugLog`.

All four prompt-log writers (the new Superfund one plus inventory-insights, serial-decode, and maintenance-synthesis) gate on `process.env.NODE_ENV === "development"` and return early in any other environment — Vercel's function filesystem is read-only-ish in preview / production and the writes would either fail silently or clutter logs with swallowed errors. The explicit gate makes the dev-only intent obvious in source and saves the few wasted ms per call. The gate sits inside the helper functions rather than at the call sites so the dispatch in the orchestrator doesn't need to know about it.

**Env vars.** `SUPERFUND_SUMMARY_MODEL` (preferred) → falls back to `BRIEFING_PRIMARY_MODEL` when unset → returns empty string when neither is set, which is the graceful-skip signal `generate.ts` reads. Both vars route through the Vercel AI Gateway. The fallback chain matches the pattern in `getInventoryInsightsModel()` so a single shared model setting works in dev environments that haven't seeded the dedicated var.

### Canonical contaminants table

`lib/habitat/contaminants/data.ts` is the single source of truth for how Hearth talks about chemical contaminants — canonical spelling, observed EPA aliases, three-stop concern level (`high` / `moderate` / `low`), one short Hearth-voice description, an authoritative EPA / ATSDR link, and (issue #147) the set of `pathways` by which the chemical typically reaches people from a nearby contaminated site. `lib/habitat/contaminants/lookup.ts` exposes `findContaminantByAlias(raw)`, the case-insensitive whitespace-trimmed resolver against the aliases lists. The Superfund detail pane consumes the table to render enriched contaminant rows: high-concern entries bold, moderate normal weight, low muted, each with description and "Learn more" link. Unknown EPA strings fall through to a grouped "Other contaminants detected" section that renders the raw (chemistry-aware-formatted) string with no enrichment. A site with an empty `contaminants` array — Georgia-Pacific's Cumulis record is the canonical example — gets explanatory copy noting that EPA hasn't published an inventory for that site rather than an empty section. Future modules (water-system violations, soil testing) consume the same table; the source of truth never gets duplicated into individual modules.

**Pathway field (issue #147).** Each entry carries `pathways: Pathway[]`, a small enum (`groundwater | vapor_intrusion | soil_exposure | surface_water | airborne_particulate`) covering the route by which the chemical typically reaches a homeowner from a nearby contaminated site. Two downstream consumers are built around this: the Superfund recommended-actions logic (issue #144) gates "test your well" off `groundwater`-pathway contaminants and "check for vapor intrusion" off `vapor_intrusion`-pathway contaminants whose nearby sites are within the property's basement situation; the per-site detail card's "how this typically spreads" disclosure (issue #146) renders one paragraph per pathway present at the site, sourced from `PATHWAY_EXPLANATIONS` in data.ts (one explanation per pathway, keyed by pathway rather than per-contaminant). Two helpers in lookup.ts roll up the data for callers: `getPathwaysForContaminants(raw)` dedups pathways across a site's contaminants list with stable canonical ordering (ignoring unknown strings); `getPathwayExplanation(pathway)` is a thin wrapper over `PATHWAY_EXPLANATIONS`. A lookup-test guard rail asserts every entry has at least one pathway populated — a contaminant with no plausible homeowner pathway has no business in the table at all, and the assertion catches future additions that land with `pathways: []` by oversight. Editorial assignments are based on category + chemistry (VOCs → groundwater + vapor intrusion; PCBs / dioxins → soil + surface water; PFAS → groundwater + surface water; asbestos → airborne only; etc.) and live in the entries themselves so the contract a future module reads is the entry, not a separate category map.

### FEMA Flood Zones module

The third shipping habitat module (`lib/habitat/modules/fema-flood-zones/`). It queries FEMA's National Flood Hazard Layer (NFHL) at the user's home coordinates via the public ArcGIS REST endpoint at [`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query`](https://www.fema.gov/flood-maps/national-flood-hazard-layer) (MapServer layer 28 is "Flood Hazard Zones") and returns the FEMA flood zone designation for the property. One HTTP call, one polygon (typically), one classification — the simplest live-API habitat module by every measure. No state-wide fetch, no proximity math, no slotted-shell drill-down; single finding, generic modal.

The query is a point-in-polygon test: `geometry={lon},{lat}` (longitude first — the Esri convention) in WGS84, with `spatialRel=esriSpatialRelIntersects` and `returnGeometry=false`. FEMA returns a `features[]` array, one entry per polygon containing the point — usually exactly one, occasionally more at polygon boundaries, and zero when the address is outside NFHL digital coverage (roughly 10% of US addresses, mostly rural/remote).

Classification reads both `FLD_ZONE` and `ZONE_SUBTY` together. The subtype is load-bearing — Zone X with the "0.2 PCT" subtype (the 500-year/shaded-X floodplain) is a meaningfully different finding from Zone X with the "minimal hazard" subtype, even though the bare zone code is identical. The full table lives in [`classify.ts`](../lib/habitat/modules/fema-flood-zones/classify.ts):

| FLD_ZONE | ZONE_SUBTY | Severity |
|---|---|---|
| `X` | minimal / null | favorable |
| `X` | `0.2 PCT ANNUAL CHANCE FLOOD HAZARD` | neutral |
| `D` | any | caution |
| `A`/`AE`/`AH`/`AO`/`AR` | any except `FLOODWAY` | concern |
| `A`/`AE` | `FLOODWAY` | critical |
| `V`/`VE` | any | critical |
| no features | — | neutral (no-coverage path) |

Cadence is `once` — FEMA updates the NFHL roughly monthly but a homeowner's mapped flood zone basically never changes within their ownership. The rare LOMA/LOMR cases (NFHL layer 34 carries individual property determinations that supersede the base FIRM) are tracked as a v1.1 idea rather than a recurring check.

Three FEMA quirks the module handles explicitly. (1) `-9999` is FEMA's null sentinel for the numeric fields `STATIC_BFE`, `DEPTH`, `VELOCITY`, `BFE_REVERT`, and `DEP_REVERT`; [`fetch.ts`](../lib/habitat/modules/fema-flood-zones/fetch.ts) coerces those to `null` in `normalizeFloodZone` before the data flows anywhere else — surfacing "-9999 feet" in the UI would be a memorable bug. (2) Multiple overlapping polygons can come back at boundaries; `pickMostSevere` in [`classify.ts`](../lib/habitat/modules/fema-flood-zones/classify.ts) selects the higher-severity zone and the activity log's compute step calls out the selection so the user sees the choice. (3) Empty `features[]` means the address sits outside NFHL digital coverage — the module severity is `neutral` (not `favorable`; we don't claim "all clear" when FEMA doesn't have data), the action shelf drops the FEMA Map Service Center deep-link (FEMA has nothing to render for that area) and keeps just the learn-more link, and the activity log shrinks to 4 steps (rule omitted because there's no zone to apply a rule to).

The module uses the generic finding modal — no `getOverviewCards` or `renderDetail`. Single finding, single zone, no per-item drill-down. The action shelf carries two link chips on the happy path: a deep link to FEMA's Map Service Center pre-populated to the user's address via `?AddressQuery=...` (gives the user a way to see the actual polygon edge for their area), plus a link to FEMA's flood-zone definitions page.

**Three layers of resilience around the FEMA dependency** (issue #172). FEMA's public ArcGIS service has known availability quirks, and the original implementation made one HTTP call and threw on any non-2xx — turning a transient 5xx into a permanent `'failed'` finding the user had to manually refresh. The module now wraps the FEMA call in three layers, each catching a different failure mode:

1. **Retry loop in [`fetch.ts`](../lib/habitat/modules/fema-flood-zones/fetch.ts).** Up to 3 attempts (initial + 2 retries) with exponential backoff (300ms → 900ms) and ±20% jitter. Retries on network errors, 5xx, 429, and AbortError (treats each timeout as one attempt). Does NOT retry on 4xx other than 429 (deterministic bug in the query) or "unexpected response shape" (likely a FEMA schema change that should fail fast). Worst-case wall-clock when every attempt times out is ~46s; the onboarding modal's tolerance comfortably accommodates that. Failures are wrapped in a `NfhlFetchError` carrying the retry classification and final attempt number, so the cache wrapper can read them without re-inspecting the error.
2. **Shared cache at `hearth.fema_flood_zones_cache`** (migration `20260528024130_create_fema_flood_zones_cache.sql`). Keyed by parcel ID when present (one row per parcel, shared across re-checks and duplex/subdivision splits) or rounded lat/lon (5dp ≈ 1m precision) as the fallback. The key prefix (`parcel:` vs `coord:`) is distinct so a future migration could fold coordinate rows into parcel rows without primary-key collisions. **180-day TTL** enforced in app code ([`cache.ts`](../lib/habitat/modules/fema-flood-zones/cache.ts), `CACHE_TTL_DAYS`) — longer than WQA's 90 days and much longer than Superfund's 7 days because FEMA polygons are the most stable upstream data we cache. Same wrapper shape as the WQA WaterSystemCacheStore: a `FloodZonesCacheStore` interface lets tests inject an in-memory store, and every Supabase failure soft-fails to a cache miss so FEMA stays the fallback for the cache itself.
3. **Stale-but-labeled fallback.** When every FEMA retry fails AND a previously cached row exists (even expired), `resolveFloodZones` serves the stale data tagged `source: 'stale'`. The activity log narrates honestly: *"FEMA's flood maps are unreachable right now … so I'm showing your most recent designation from [date]. I'll re-check on your next visit."* The store's `lookupAny` method returns expired rows just for this path; `lookup` continues to enforce the TTL on the happy path. This is the layer that converts "FEMA is down" from a hard failure into a soft one.

When every FEMA retry fails AND no cache row exists at all, `check()` no longer throws — it returns a **neutral `coverage: false` finding** with the `UNREACHABLE_HEADLINE` ("We couldn't reach FEMA's flood maps right now"), the existing FEMA Map Service Center deep-link in the action shelf (MSC is a different FEMA service from the NFHL ArcGIS endpoint that just failed, so it's still a useful next step), and an activity log that mirrors the no-coverage 4-step arc (fetch / compute / decide / finding, no rule step). Severity is `neutral` for the same reason no-coverage is neutral — we don't claim either all-clear or concern when we lack data. The orchestrator persists this as a normal `completed` finding rather than a `failed` row, which means the dashboard tile renders honestly and the next-visit re-run silently recovers as soon as FEMA comes back.

The activity-log fetch step has four variants now, narrated by helpers in [`narration.ts`](../lib/habitat/modules/fema-flood-zones/narration.ts): the default fetch narration on a first-attempt success, `retriedFetchNarration` when more than one attempt was needed ("FEMA's flood maps were slow to respond, so I tried again — that worked"), `cacheHitFetchNarration` on a cache hit, and `staleCacheFallbackNarration` on the stale path. The cache wrapper threads the retry count back through an `onAttempt` callback rather than changing the public return shape of `fetchFloodZonesAtPoint` (which stays a plain `NormalizedFloodZone[]` for backwards compatibility with the existing test surface).

**Test seams.** `index.ts` exports two test-only setters — `__setFloodZonesCacheStoreForTests` and `__setFloodZonesResolveOptionsForTests` — that the test suite uses to inject an in-memory `FloodZonesCacheStore` and a single-shot/no-sleep retry policy so neither real network calls nor wall-clock retry delays leak into the suite. Production code never calls these (they're unset by default; an unset store falls back to `createSupabaseFloodZonesCacheStore`).

### Water Quality Awareness module

The fourth habitat module ([`lib/habitat/modules/water-quality-awareness/`](../lib/habitat/modules/water-quality-awareness/)) and the foundation of the broader Water Quality Awareness initiative (epic issue #165). Phase 1 (issue #166) shipped the system-identity surface — the module resolves a house's coordinates to a Public Water System ID, persists the EPA WATER_SYSTEM inventory record, and decides which of five branches the house falls into. Phase 2 (issue #169) layers EPA SDWIS compliance + lead/copper sample data on top of the Phase 1 surface, populates `compliance_status_short` and a new `lead_copper_summary` block, and drives the finding's severity from real EPA data instead of always-neutral. CCR upload + extraction (WQA-3) and the richer findings view (WQA-4) ship in later phases.

The module is **feature-flagged on `NEXT_PUBLIC_WQA_ENABLED === "true"`** at registry-import time in [`lib/habitat/registry.ts`](../lib/habitat/registry.ts). The `NEXT_PUBLIC_` prefix is load-bearing: the registry is imported by both the server-side workflow and the client-side discovery modal / dashboard tile, so the value has to be inlined into the client bundle. Without the prefix the workflow writes a finding and the client filters the matching tile out as "unknown module". Defaults off in production. Set the env var in Vercel to dogfood. Once WQA graduates to default-on the conditional comes out.

**Branch logic** is the heart of the module. The onboarding-captured `house.water_source` is the **primary signal** — not EPA's map. EPA's national CWS service-area layer covers roughly six of every seven U.S. addresses; the gap is mostly rural fringes, recent annexations, and edge cases like township parcels served by a city utility but mapped just outside the city polygon. When the user has explicitly told Hearth they're on city water during onboarding, treating "no polygon match" as "private well" is the wrong answer.

[`branch.ts`](../lib/habitat/modules/water-quality-awareness/branch.ts) routes on `(waterSource, pwsidResolved, record)`, with "polygon" meaning either the direct point-in-polygon match OR the nearest-polygon fallback (see "Nearest-polygon fallback" below):

| `water_source` | EPA polygon (direct OR fallback) | Envirofacts record | Branch |
|---|---|---|---|
| `well` | (skipped) | (skipped) | `private_well` (user-declared) |
| `shared` | (skipped) | (skipped) | `private_well` (user-declared) |
| `municipal` | no match (both lookups), no nearby utilities | — | `cws_unmapped` |
| `municipal` | no match (both lookups), multiple competing utilities nearby | — | `cws_unmapped` |
| `municipal` | match (verified OR inferred) | active CWS | `cws_no_ccr` |
| `municipal` | match (verified OR inferred) | active TNCWS/NTNCWS | `non_community` |
| `municipal` | match (verified OR inferred) | inactive / missing / weird type | `stale` |
| `unknown` / `null` | no match (both lookups), no nearby utilities | — | `private_well` (EPA-inferred) |
| `unknown` / `null` | no match (both lookups), multiple competing utilities nearby | — | `cws_unmapped` (override) |
| `unknown` / `null` | match (verified OR inferred) | active CWS | `cws_no_ccr` |
| `unknown` / `null` | match (verified OR inferred) | active TNCWS/NTNCWS | `non_community` |
| `unknown` / `null` | match (verified OR inferred) | inactive / missing / weird type | `stale` |

The 'well' and 'shared' short-circuit lives in `check()` itself, not in `branch.ts` — when the user has already told us the answer, we skip the EPA polygon lookup entirely and emit a 3-step activity log. The `shouldSkipEpaLookups` helper in `branch.ts` exists so the module's check() and any future caller (a future polling job, say) agree on the criterion.

The `cws_unmapped` branch is the disciplined answer to a real EPA coverage gap: "you told us you're on city water, but EPA's national map doesn't pinpoint your utility — once you have your annual Water Quality Report, you can upload it manually." Severity is `neutral`. WQA-3 will provide the upload path.

The `cws_with_ccr` branch is reserved for WQA-3 — decided one layer up against the shared CCR cache that ships then. Today nothing produces it from `branch.ts`.

The `private_well` branch carries a source distinction internally — `user-declared` (we believe the onboarding answer) renders confident copy ("Your home is on a private water system"), while `epa-inferred` (we filled in the gap when `water_source` was unknown/null) renders probabilistic copy ("You're likely on a private well"). Both write the same `branch: 'private_well'` payload so downstream UI doesn't need to care.

#### Nearest-polygon fallback (WQA-2 follow-up)

EPA's national CWS Service Areas layer has documented coverage gaps — established residential addresses well inside city limits can sit in holes the layer's digitization missed. The canonical regression case is 604 Norton Dr in Kalamazoo, MI: the exact coords (`42.26496, -85.57231`) return zero features from EPA's point-in-polygon query, but points 250–550 m in any direction return MI0003520 (Kalamazoo PWS) as expected. The MI0003520 polygon's actual edge clips just short of the parcel.

The fallback recovers the correct PWSID in most coverage-gap cases without user action. When [`resolvePwsidAtPoint`](../lib/habitat/modules/water-quality-awareness/sources/cws-service-areas.ts) returns zero features, [`check()`](../lib/habitat/modules/water-quality-awareness/index.ts) runs a second ArcGIS query against a 500 m buffer at the same point via [`resolveNearestPwsid`](../lib/habitat/modules/water-quality-awareness/sources/cws-service-areas.ts). The 500 m radius (`NEAREST_POLYGON_FALLBACK_RADIUS_M`) is tuned to recover 604 Norton's case (~250 m to the nearest in-polygon point) without expanding into adjacent utilities' territory.

Three outcomes:

| Fallback outcome | Resolution | Branch impact |
|---|---|---|
| `single-nearby` (every polygon within 500 m shares one PWSID) | `confidence: "inferred"` — treated as authoritative for SDWIS / CCR fetches | Routes to `cws_no_ccr` / `non_community` / `stale` like a verified PWSID |
| `multiple-competing` (polygons from multiple PWSIDs nearby) | `confidence: "unmapped"` | Routes to `cws_unmapped` regardless of `water_source` — multiple utilities within 500 m is a strong city-water signal even when the user didn't declare it |
| `no-match` (zero polygons within 500 m) | `confidence: "unmapped"` | Falls through to standard `branch.ts` routing — `private_well` for unknown/null water_source, `cws_unmapped` for declared municipal |

The fallback ONLY runs on direct miss. When the direct query matches, the second ArcGIS call is skipped entirely — saves an unnecessary round trip on the happy path. Same fetch + timeout + throw-on-transient-error discipline as the direct query; the fallback's own failures propagate to the orchestrator's `failed`-finding path.

**The `pwsid_confidence` axis on the payload** is separate from the branch axis. The `system_card.pwsid_confidence` field carries `"verified"` (direct match) or `"inferred"` (fallback match) on `cws_no_ccr` / `non_community` / `cws_with_ccr` branches; it's absent on `cws_unmapped` / `private_well` / `stale` (no PWSID to be confident about). Back-compat: a missing value should be read as `"verified"` — the only behavior that existed before the fallback shipped. The intended UI use case is a "we think you're served by X — confirm or correct" affordance on inferred matches, scheduled for WQA-4's findings-view rewrite.

**The activity log gains one step** on direct-miss runs — a separate `fetch` step narrating the fallback outcome ("Every public water utility within 500 meters of your address is the same one — Kalamazoo PWS. I'm going with that, with medium confidence.") between the direct lookup and the branch decision. The direct-miss copy in step 1 also changes to "let me try a wider search" rather than declaring the verdict; the verdict comes in step 2.

**Two data sources, both public and unauthenticated.**

- **EPA Community Water System Service Areas** — an ArcGIS FeatureServer at [`services.arcgis.com/cJ9YHowT8TU7DUyn/.../Water_System_Boundaries/FeatureServer/0`](https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas). Same Esri point-in-polygon idiom as the FEMA NFHL client (`geometry={lon},{lat}` in WGS84, `spatialRel=esriSpatialRelIntersects`); zero features means the address sits outside every CWS polygon — the private-well signal. Implementation in [`sources/cws-service-areas.ts`](../lib/habitat/modules/water-quality-awareness/sources/cws-service-areas.ts).
- **EPA Envirofacts WATER_SYSTEM** — REST endpoint at `https://data.epa.gov/efservice/WATER_SYSTEM/PWSID/{pwsid}/JSON`. Returns a one-element JSON array with the system inventory record (utility name, admin contact, source water, population, owner type, source-water-protection status), or an empty array when EPA has no record. Implementation in [`sources/envirofacts.ts`](../lib/habitat/modules/water-quality-awareness/sources/envirofacts.ts).

**Shared cache, keyed by PWSID.** `hearth.water_systems` (migration `20260526130000_create_water_systems_table.sql`) is the architectural foundation for the rest of the module — one row per utility, **shared across every house on that system**. When two neighbors on Kalamazoo PWS run the module, only the first triggers an Envirofacts call. The 90-day TTL is enforced in [`cache.ts`](../lib/habitat/modules/water-quality-awareness/cache.ts) rather than in SQL — same discipline as the Superfund per-state cache, single constant to tune later. `raw_payload jsonb not null` preserves the full Envirofacts response so future column additions can be backfilled from existing rows without re-fetching from EPA. RLS is globally readable to authenticated users and has no write policies — writes happen exclusively through the service-role workflow path.

**Findings storage.** Per-house findings live on `hearth.habitat_findings` under `module_key='water_quality_awareness'`, same as every other habitat module — no per-module findings table. Issue #166 originally proposed a separate `hearth.water_system_findings` table; we decided against it during implementation to keep the habitat persistence pattern consistent. The persisted payload shape is in [`types.ts`](../lib/habitat/modules/water-quality-awareness/types.ts) (`WqaFindings`): `branch`, an optional `system_card` block (system name, PWSID, description, source type, compliance-status sentinel, latest-CCR sentinel, source-water-protection-since date), and a `branch_metadata` block carrying the admin contact and an optional `diagnostic_note` that surfaces in the activity log on stale/private-well rows.

**Description copy is templated, not LLM-generated.** [`payload.ts`](../lib/habitat/modules/water-quality-awareness/payload.ts) builds the system-card description from inventory fields ("Groundwater system on file with EPA. Serves about 192,992 people across 41,411 service connections. EPA-recognized source water protection program since 2004."). LLM-rewritten descriptions are deferred to WQA-4 (the findings view rewrite) — a stable template reads better than a stale model output, and the cost asymmetry is the same one the radon module's `summary` makes.

**UI surface in Phase 1 is the standard habitat tile + modal pattern.** No custom 3-stat grid, no dedicated SuggestedNext panel. The issue's mockups describe a rich "Your water system" card and a SuggestedNext "find your CCR" surface, but: (a) the SuggestedNext panel doesn't exist anywhere in the codebase yet — it's referenced in this guide as a future thing — and (b) two of the three stat-grid values would render as placeholders in Phase 1 ("Compliance: Not yet checked", "Latest CCR: Not yet uploaded") because the data sources that fill them ship in WQA-2 / WQA-3. The disciplined call was to skip the custom UI scaffolding until the stats actually carry information. The richer surface will land alongside WQA-4 once the payload has real data to show.

**Cadence is `yearly` (bumped from `once` in WQA-2).** SDWIS submissions are quarterly so the data does meaningfully change inside a year; the orchestrator's `cadenceToNextCheck` already handles `'yearly'`. The next-check cron isn't running today — `next_check_due_at` is recorded but the auto-rerun job is deferred — so practical refresh still happens when a user triggers a manual re-check.

**The hero icon under `public/habitat_module_images/water_quality_awareness.jpg` is not yet committed** — the module deliberately omits `iconImage` until the asset lands. The compact tile and modal header both handle a missing icon gracefully (the tile drops the 72px hero column; the modal renders without the thumbnail).

#### SDWIS compliance + LCR (Phase 2, issue #169)

Phase 2 adds two new EPA Envirofacts pulls to the existing branch logic — on the `cws_no_ccr` and `non_community` branches only — and one new compute step that summarizes the results.

**Data sources.** Both public, unauthenticated, same REST family as the Phase 1 WATER_SYSTEM pull.

- **SDWIS VIOLATION** — `https://data.epa.gov/efservice/VIOLATION/PWSID/{pwsid}/JSON`. Every violation EPA has on file for the PWSID since 1993. An empty array is a meaningful positive signal. Client in [`sources/sdwis-violations.ts`](../lib/habitat/modules/water-quality-awareness/sources/sdwis-violations.ts).
- **SDWIS LCR_SAMPLE_RESULT** — `https://data.epa.gov/efservice/LCR_SAMPLE_RESULT/PWSID/{pwsid}/JSON`. 90th-percentile system-rollup lead and copper samples per sampling period. Sparse by design — EPA's sampling schedule rotates systems through the pool. Empty array is common and meaningful ("no_samples_on_file"). Client in [`sources/sdwis-lcr-samples.ts`](../lib/habitat/modules/water-quality-awareness/sources/sdwis-lcr-samples.ts).

**Two new shared caches, both PWSID-keyed.** Same architecture as the Phase 1 `water_systems` cache: service-role-only writes, globally readable to authenticated users, app-code-enforced 30-day TTL (vs. 90 days for inventory — violations and samples change more frequently). Three migrations land together in [`20260527120000_create_water_system_sdwis_tables.sql`](../supabase/migrations/20260527120000_create_water_system_sdwis_tables.sql):

- **`hearth.water_system_violations`** — one row per (PWSID, violation_id). Parsed columns the summarizer reads + `raw_payload` for future widening. FKs to `water_systems(pwsid)`.
- **`hearth.water_system_lcr_samples`** — one row per (PWSID, sample_id). Same shape, different fields. FKs to `water_systems(pwsid)`.
- **`hearth.water_system_data_fetches`** — per-(PWSID, dataset) freshness bookkeeping. Held separately from the collection tables so the cache layer can decide hit/miss/expired without scanning the collection, and so the "EPA returned zero rows" case stays distinguishable from "never fetched". `dataset` is CHECK-constrained to `('violations', 'lcr_samples')`; WQA-3 may add `'ccr_extraction'` via an `alter table … drop constraint … add constraint`.

**Cache wrappers under [`caches/`](../lib/habitat/modules/water-quality-awareness/caches/)**. Phase 2 reorganized the module's cache layer — the original flat `cache.ts` from WQA-1 moved to `caches/water-system-cache.ts`, joined by `caches/violations-cache.ts`, `caches/lcr-cache.ts`, and a small `caches/sdwis-shared.ts` carrying the freshness lookup/upsert helpers both SDWIS caches consume. The two SDWIS wrappers are intentionally parallel rather than abstracted into a generic "SDWIS table cache" — different conflict keys, different consumer shapes, different normalized fields. Two ~200-line files read cleaner than one parametric abstraction we'd have to re-read every time.

**Summarization.** Two pure modules over the cached records:

- [`compliance.ts`](../lib/habitat/modules/water-quality-awareness/compliance.ts) maps violations[] → `ComplianceStatusShort` (`unknown` / `no_active_violations` / `active_violations`) plus a `recent_violations` block covering the last 5 years (`COMPLIANCE_RECENT_YEARS`). "Active" means `rtc_date` is null OR in the future — EPA occasionally writes a future RTC date and treating those as still-active reads more honestly than declaring early resolution.
- [`lcr.ts`](../lib/habitat/modules/water-quality-awareness/lcr.ts) maps samples[] → a discriminated `LeadCopperSummary` union (`no_samples_on_file` / `unavailable` / `available`). The `available` variant carries the most-recent lead and copper 90th-percentile values, plus a count of historical rows. The federal action levels (lead = 0.015 mg/L, copper = 1.3 mg/L) and the 80% approaching-threshold ratio live as named constants for testability and severity input derivation. Two helpers consume the summary: `computeLcrSeverityInputs` is what `deriveSeverity` calls (per-metal `*_above_action` flags + aggregate `any_approaching` / `any_detected` / `any_below_detection`), and `classifyLcrAxis` is the copy-layer sibling — it returns per-metal `above` / `approaching` / `detected` / `below` / `absent` state in a `{ kind: "available" | "unknown" }` discriminated union so the WQA onboarding-line builder can name lead vs. copper precisely without re-implementing thresholds. The five-state classification (added in #188) splits what the pre-#188 code bundled under "below": `detected` means a positive measurement (sign `=` or `>`) below the 80% approaching threshold, while `below` is reserved for `<` (below detection limit) rows. Two non-obvious things about EPA's LCR endpoint, both surfaced by real Kalamazoo data after WQA-2 first shipped: (1) **the contaminant codes are `PB90` and `CU90`**, NOT the general SDWIS `5000` / `1022` codes used in the VIOLATION table — `PB90` literally means "lead 90th-percentile" and is specific to this rollup table; (2) **EPA's JSON endpoint doesn't return `sampling_start_date` or `sampling_end_date`**, so we order by `sample_id` instead (state-prefixed and alphabetically ascending within a state, e.g. `MI207485` → `MI381874` is chronologically oldest to newest). Lead and copper are tracked independently — they're separate row streams in EPA's data, often submitted on different schedules — so the persisted `most_recent_sampling_period` carries the most-recent value for each contaminant independently, not a single physical monitoring round.

**Severity is data-driven** (was always `'neutral'` in Phase 1, refined by #188 to honor Hearth's "any detection is worth knowing" framing). [`payload.ts`](../lib/habitat/modules/water-quality-awareness/payload.ts) → `deriveSeverity` returns:

- `'concern'` when there's an active health-based violation OR an LCR measurement at/above the action level.
- `'caution'` when LCR shows **any detected lead or copper** (sign `=` or `>` with value > 0), regardless of where the measurement sits relative to EPA's action level. Includes the approaching tier by definition. The Hearth framing: EPA action levels are regulatory cutoffs, not health-safety ones — "lead is detected" is the signal we surface, even at 35% of the action level.
- `'favorable'` only when compliance is clean AND every lead/copper sample on file is below the detection limit (`<` rows). A utility with a detected-but-low measurement falls into caution above, not here — "in compliance with X" alone is never enough to call something favorable. The conjunction is deliberate.
- `'neutral'` otherwise (degraded compliance fetch, no LCR samples on file, or any case where we lack a positive signal).

**Monitoring/reporting violations don't drive severity** (#188). The pre-#188 logic treated `has_active_non_health_based` as a caution trigger; this produced confusing "non-health monitoring issue" copy in the discovery modal for utilities a homeowner would consider compliant. The framing decision: paperwork/reporting lapses are EPA-utility administrative business, not homeowner-relevant. The flag is still computed and persisted on `system_card.has_active_non_health_based` because `recommended-actions.ts` and admin/debug surfaces read it, but the dashboard tile severity and the discovery-modal pill no longer fire on it.

**Soft-fail at every level.** Phase 2's load-bearing discipline. The two SDWIS fetches run in `Promise.allSettled` inside `index.ts`, and each failure mode handles cleanly:

- Violations fetch fails → activity log records the failure step, `compliance_status_short` stays `'unknown'`, `recent_violations` is absent from the payload (lets the UI distinguish "we tried and found nothing recent" from "we couldn't tell").
- LCR fetch fails → activity log records it, `lead_copper_summary.status = 'unavailable'`.
- Both fail → both fields degrade independently. The finding still ships with the Phase 1 system-identity surface intact. The module never throws after the initial coordinate-validation guard.

**Contaminant code lookup.** SDWIS rows carry numeric `contaminant_code` values ("5000" = Lead, "2950" = TTHM). There's no EPA endpoint that maps codes to names cleanly, so [`data/contaminant-codes.ts`](../lib/habitat/modules/water-quality-awareness/data/contaminant-codes.ts) ships a hand-maintained table covering the codes that show up in residential drinking-water violations and LCR samples (around 50 codes today, grouped into `inorganic` / `organic` / `dbp` / `microbial` / `radionuclide` / `pfas` / `other`). Unmapped codes render as `"Contaminant code {N}"` and the compute step's activity-log detail counts how many distinct unmapped codes appeared — a coverage diagnostic for filling the table over time.

**Activity log arc on the CWS happy path grew from 4 to 7 steps:** PWSID resolve → WATER_SYSTEM fetch → branch decide → violations fetch → LCR fetch → compliance compute → finding. The two new fetches run in parallel but emit log steps in deterministic order (violations then LCR) for readability.

#### Findings view rewrite (Phase 4, issue #171)

Phase 4 is the UI rewrite. The data layer doesn't change; the modal body does. Two infrastructure pieces land here:

**New `renderOverviewBody` slot on `HabitatModule`.** Optional. When a module implements it, the modal's body between the header and the activity log is replaced entirely with whatever the slot returns — the default banner / recommended-actions / overview-cards / generic-actions layout is bypassed. The slot is `(row) => ReactNode` and runs inside the modal's client render, so no hooks and no fetches; everything has to already be on the persisted finding. Use sparingly — the default generic layout is the right answer for most modules. WQA is the first consumer because its overview is a structured landing page, not a card list. The modal's `getFindingLabel` / `getOverviewBanner` / etc. slots are still readable but ignored when `renderOverviewBody` is set; if a module wants any of them it must include the equivalent inside its own body.

**WQA-specific overview body** at [`components/overview-body.tsx`](../lib/habitat/modules/water-quality-awareness/components/overview-body.tsx). Five sections in order:

1. **Branch-aware header strip** — different framing per branch. `cws_no_ccr` + `verified` gets no strip (the system card carries the framing); `cws_no_ccr` + `inferred` gets a "we think you're served by X — does that look right?" affordance with disabled confirm/correct buttons (the actual wiring lands in a follow-up); `cws_unmapped` gets manual-upload framing with a disabled CCR upload button (wiring in WQA-3); `private_well` / `non_community` / `stale` get their own framings.
2. **Your water system card** — system name + PWSID + 3-stat grid (Compliance / Latest CCR / Source) + the templated description. Inferred-confidence PWSIDs get a small caveat at the bottom.
3. **Recommended for your situation** — reads `findings.recommended_actions` and renders the cards. Two v1 action types: `pitcher_filter` (fires on active health-based violation OR approaching/above-action LCR) and `free_testing` (fires when the utility's admin contact has a phone number). A third type, `maintenance_bridge`, is reserved for WQA-6 and not emitted today.
4. **Detected in your water** — lead and copper rows from the LCR summary with verbal tier cues (`Worth acting on` amber, `Worth knowing` amber, `Context` gray). Each row has a `<details>` disclosure that opens to show the contaminant's description and federal limits from the new water-quality contaminants reference (see below).
5. **Sources block** — status pills for each of the four data sources (EPA WATER_SYSTEM, SDWIS Violations, SDWIS LCR Samples, Consumer Confidence Report) with ok / unavailable / not-yet-uploaded states.

**Where `recommended_actions` comes from.** Built in [`recommended-actions.ts`](../lib/habitat/modules/water-quality-awareness/recommended-actions.ts) from `(compliance, leadCopper, adminContact, systemName)` and persisted into `findings.recommended_actions` by `buildSystemPayload`. The compute happens inside `check()` (not inside the payload builder) so the activity log can narrate the emitted IDs in a dedicated step — `recommendedActionsComputeNarration` in narration.ts. This brings the CWS happy-path activity log to 8 steps (7 from Phase 2 + 1 recommended-actions compute).

**New water-quality contaminants reference** at [`lib/habitat/water-quality/contaminants/`](../lib/habitat/water-quality/contaminants/). Sibling to the existing `lib/habitat/contaminants/` (Superfund) directory, kept separate by design: the two tables are keyed differently (drinking-water uses SDWIS contaminant codes including the LCR-specific `PB90` / `CU90`; Superfund uses EPA SEMS text aliases like `"LEAD"` / `"BENZENE"`) and serve different lookup patterns. Merging them later — when WQA-5's remediation matrix needs both — is a deliberate future step. WQA-4 ships entries for lead and copper only; the rest of the common-CCR contaminant set lands in WQA-3.

The contaminants reference includes per-entry `federal_limits` as a discriminated union (`action_level` / `mcl` / `mclg`) so the disclosure can render multiple limits when relevant (lead has both a 0.015 mg/L action level and a 0 mg/L MCLG, and surfacing both in the same disclosure is the right answer for the "no safe amount of lead" framing).

**What this issue explicitly does NOT do.** The upload-your-CCR affordance is visual only (WQA-3 wires it). The remediation matrix view ("Show me how to filter this") is visual only (WQA-5). The maintenance bridge action card is suppressed until WQA-6. The inferred-PWSID confirm/correct buttons are disabled placeholders; the actual `house.confirmed_pwsid` write path is a follow-up. The cross-module Superfund synthesis is WQA-7. No CCR contaminants, no UCMR overlay, no dedicated route migration — every one of those is a deliberate non-goal for this issue, called out so future readers know the scope was bounded by design.

### `HabitatModule.category`

`HabitatModule.category` is a required field (currently the union `"environmental"`, expandable as new module families ship). The orchestrator writes `category: module.category` into the `running`, `failed`, and `completed` upserts on `hearth.habitat_findings`. The column was added by `supabase/migrations/20260517171126_habitat-findings-module-changes.sql` for dashboard grouping; the migration backfilled existing rows but did not wire the orchestrator, so the field stayed null for new rows until the orchestrator started persisting it.

---

## Maintenance module

Schema foundation landed in issue #122. The **synthesis pipeline** plus the **Build maintenance plan** button on the inventory detail page landed in issue #126. The **direct-event pipeline** that auto-creates renewal tasks from documents carrying `metadata.expiration_date` landed in issue #131. The **"On your plate" panel** (dashboard + inventory detail page) and the **renamed History section** on the inventory detail page landed in issue #133. The **per-use cadence kind** and the **synthesis consolidation pass** landed in issue #135. The **task detail modal**, the **mark-renewed / mark-completed sheets**, and the **complete-task server action** that close an open task and chain the successor landed in issue #137. Still to ship against this schema: the "renewed via document upload" toast (issue #7).

`hearth.maintenance_tasks` is an append-only event log: each row is one occurrence with its own `next_due_at`, `status` (`open` / `completed` / `superseded`), and frozen `reasoning` jsonb. Completion writes `completed_at` + optional `completed_by_document_id` and inserts a successor row whose `predecessor_task_id` points back at it — old rows are never mutated after a terminal status. The `source` discriminator (`direct_event` vs. `synthesis`) is load-bearing: rebuilding a plan supersedes only the open synthesis rows for an inventory item and never touches direct-event rows (so a user's vehicle-registration renewal survives a plan rebuild). Cadence is shaped by `cadence_kind` (`interval` / `seasonal` / `one_time` / `per_use`) with a check constraint enforcing the field combinations; `renewal_options` jsonb carries the term cards (1yr / 2yr, 6mo / 12mo) for the mark-renewed sheet so each row is self-describing even as the per-issuer constants map drifts. `renewal_url` (text, nullable, issue #137) carries the per-issuer renewal-portal deep link — populated by the direct-event pipeline from the classifier's `renewal_url_template` so the detail modal's "Renew now" CTA can render straight off the row. RLS delegates to `hearth.houses.owner_id` through four policies (SELECT / INSERT / UPDATE / DELETE) and the `set_updated_at` trigger fires on UPDATE. Four indexes cover the read and rebuild paths: a partial on `(house_id, next_due_at) where status = 'open'` for the dashboard panel, a partial on `(inventory_id, next_due_at)` for the inventory-detail panel, a full `(inventory_id, created_at desc)` for the History view, and a narrow `(inventory_id) where source = 'synthesis' and status = 'open'` for the rebuild write path.

The `per_use` cadence kind (issue #135) marks tasks coupled to *using* the appliance rather than to calendar dates — "clean lint screen after every load," "check rinse aid before every cycle." Per-use rows have the same null-interval / null-anchor shape as `one_time`; the cross-field CHECK constraint encodes both branches. They keep a `next_due_at` value (today's UTC date is the placeholder the synthesis pipeline writes) because the column is NOT NULL, but no surface reads it — the dashboard panel excludes per-use rows at the query level (it's a date-anchored surface), and the inventory-detail panel folds them into a dedicated "Every time you use it" tier that suppresses the right-side date label. Keeping per-use in the same table preserves the supersede-on-rebuild semantics (`source='synthesis' AND status='open'` finds them), keeps the `kind` discriminator usable across surfaces (a future "want to reorder this?" affordance targets `kind='consumable'` whether the cadence is `interval` or `per_use`), and avoids defensive NULL-handling in every reader.

`inventory_id` is `ON DELETE CASCADE` — deleting an inventory item removes its maintenance tasks atomically. The per-task `reasoning` jsonb embeds the manufacturer/model/serial at row-creation time, so each completed row is self-contained for history views without needing a dangling FK to the live inventory row. Cascade also preserves the cleaner semantic that `inventory_id = null` means "house-scoped task" (gutter cleaning, etc.) rather than "task whose item was deleted out from under it."

`hearth.inventory.last_synthesis_run` (jsonb, nullable) holds the most recent synthesis run's step trace per item, mirroring `habitat_findings.activity_log`. Re-running synthesis overwrites this column; historical traces aren't preserved because the load-bearing decisions are captured in the per-task `reasoning` on each emitted `maintenance_tasks` row. Null means synthesis has never been run for that item — the inventory-detail Build/Rebuild button reads it to decide between "Build" and "Rebuild" copy. The full TypeScript shape (`SynthesisRunLog`) lives in [`lib/maintenance/types.ts`](../lib/maintenance/types.ts).

### Synthesis pipeline

The synthesis half of the maintenance module is a Vercel Workflow (`workflows/maintenance-synthesis.ts`, issue #126) that takes an inventory item's `ai_insights`, the house's habitat findings, the item's linked service receipts, and its install / purchase date, and emits a structured list of recurring maintenance tasks. The tasks are written as `hearth.maintenance_tasks` rows with `source='synthesis'`. The workflow trace is persisted to `hearth.inventory.last_synthesis_run` plus a developer-time debug log at `logs/maintenance-synthesis-prompts.log`.

**Why a workflow, not a request-scoped call.** Synthesis is structurally similar to the Research stream (`/api/inventory/[id]/research`) — it's an AI Gateway call that writes structured output back to `hearth.inventory` — but three things drive the architecture difference. (1) **Background, not streaming.** The user isn't watching tokens emit; they click Build, the button enters an in-flight state, they walk away. (2) **Reasoning model, long latency.** Grok 4.3 reasoning is expected to take 50–60s end-to-end. A request-scoped call that long is fragile across mobile networks, browser tab backgrounding, and Vercel function timeouts. (3) **Multi-row output.** Research writes one jsonb column; synthesis writes N rows to `maintenance_tasks` plus one column on `inventory`, with a supersede step on the rebuild path. The workflow pattern's `"use step"` boundaries match this shape naturally. Same orchestration shape as [`workflows/briefing.ts`](../workflows/briefing.ts) and [`workflows/habitat.ts`](../workflows/habitat.ts); fire-and-forget `start()` from a server action; the workflow runs to completion regardless of whether the client is still connected.

### Files

- **[`lib/maintenance/types.ts`](../lib/maintenance/types.ts)** — `SynthesisRunLog`, `SynthesisRunStep`, `SynthesisInputsSummary`, `TaskReasoning`, `TaskReasoningModifier`, `TaskReasoningAnchor`. Single source of truth for the two jsonb shapes the module persists (`last_synthesis_run` on `hearth.inventory`, `reasoning` on `hearth.maintenance_tasks`).
- **[`lib/maintenance/synthesis-schema.ts`](../lib/maintenance/synthesis-schema.ts)** — Zod schema (`synthesisOutputShape`) that the model is bound to via `generateObject`. The cadence shape's `.refine()` mirrors the `maintenance_tasks_cadence_shape` CHECK constraint in the migration — catching a malformed cadence at the Zod boundary lets the workflow drop the offending task with a clear log line before attempting an insert the DB would reject anyway. One malformed task never costs the others.
- **[`lib/maintenance/synthesis-prompt.ts`](../lib/maintenance/synthesis-prompt.ts)** — `buildSynthesisSystemPrompt()` and `buildSynthesisUserMessage(input)`. System + user split, same pattern as the Research call. The system prompt's "what counts as a task" section is framed around the **discrete-completion test** ("can the homeowner say 'I did that today' at a specific moment?") — that framing is load-bearing for converting the manufacturer's vague "be aware of unusual sounds" guidance into "Listen for unusual sounds during normal operation, every 6 months" rather than dropping it. Two sibling sections shape the output further. The **per-use vs. scheduled** framing (issue #135) tells the model when to emit `cadence.kind = 'per_use'` (every load, every cycle, every refill) instead of forcing those actions into a monthly interval — the canonical fix for the rinse-aid and lint-screen miscoding. The **consolidation pass** (issue #135) is a final discipline that runs after the model drafts its task list, asking "would a homeowner realistically do these in one session?" with the annual-dryer-safety work as the canonical merge case and the furnace-pro-vs-homeowner pair as the don't-over-consolidate anchor. Most items should land between 4 and 8 tasks; hard cap is 20.
- **[`lib/maintenance/synthesis-debug-log.ts`](../lib/maintenance/synthesis-debug-log.ts)** — `writeSynthesisDebugLog(entry)`. Mirrors [`writeInsightsDebugLog`](../app/api/inventory/[id]/research/route.ts) exactly. Writes one block per run to `logs/maintenance-synthesis-prompts.log` (the `logs/` folder is already gitignored). Each block carries the timestamp, model, duration, the pre-prompt input shape *and* the assembled prompts (separate sections — the two together let Todd see "what data went in" alongside "how the prompt assembled it" without re-deriving one from the other), the validated response JSON, and any error. All writes are swallowed in try/catch so a logging failure can never break a synthesis run.
- **[`workflows/maintenance-synthesis.ts`](../workflows/maintenance-synthesis.ts)** — `runMaintenanceSynthesis(inventoryId)`, the orchestrator. Five `"use step"` functions in the happy path: `loadSynthesisInput` (parallel queries against the inventory row, habitat findings filtered to `status='completed'` + non-null severity, and attached `kind='receipt'` documents), `supersedeOpenSynthesisTasks` (idempotent — no-op on first build), `callModel` (env-driven, `generateObject` against `MAINTENANCE_SYNTHESIS_MODEL`), `writeTasks` (single multi-row insert; `next_due_at` stamped as `today + first_occurrence_days_out` in UTC), `persistTrace` (jsonb write to `inventory.last_synthesis_run`, non-fatal on error). Top-level try/catch persists the trace + writes the debug log on failure too, then re-throws so WDK marks the run failed.
- **[`app/actions/maintenance/build-plan.ts`](../app/actions/maintenance/build-plan.ts)** — `buildMaintenancePlanAction(inventoryId)`. RLS-gated SELECT confirms ownership, validates `ai_insights.maintenance` is populated server-side (belt-and-suspenders against a stale or malicious client), surfaces a configuration error inline when `MAINTENANCE_SYNTHESIS_MODEL` is unset, then `start()`s the workflow and returns `{ ok: true }`. The action does not await completion.
- **[`supabase/migrations/20260523193109_inventory_realtime_publication.sql`](../supabase/migrations/20260523193109_inventory_realtime_publication.sql)** — adds `hearth.inventory` to the `supabase_realtime` publication so the inventory detail page's UPDATE subscription receives the workflow's completion write. Same gotcha as the houses publication: without this, `postgres_changes` subscriptions silently never fire.

### Run trace and activity log

`runMaintenanceSynthesis` populates the trace's `steps` array as the workflow progresses, mirroring habitat's per-finding `activity_log`. Step `kind` values: `load`, `consider`, `supersede`, `model_call`, `validate`, `emit_task`, `drop_task`, `skip`, `error`. The trace itself isn't user-visible in this issue — it lands on the column for developer debugging via the Supabase dashboard and powers the future task detail modal's "here's what the model considered when deciding this task" expand. The `inputs_summary` block (insights generated-at, habitat finding count, linked receipt count, install date) and `superseded_count` flow straight into the trace at completion.

### Structured output schema

`synthesisOutputShape` is `{ overall_notes: string | null, tasks: SynthesisTask[] }` capped at 20 tasks. Each task carries `kind` (one of `service` / `inspection` / `consumable` / `seasonal` — `renewal` is reserved for the direct-event pipeline and the prompt explicitly tells the model not to emit it), `title` / `subtitle`, `first_occurrence_days_out` (days, not an absolute date — the workflow stamps `now() + days_out` at insert time so the row's `next_due_at` is anchored to the user's click, not to whenever the model decided), `cadence` (interval / seasonal / one-time / per-use), and `reasoning` (source kind, cadence basis, modifiers, anchor — frozen at row-creation time and the source of the future "Why this task" expand). The `per_use` branch (issue #135) shares the null-interval / null-anchor shape with `one_time`; the workflow's `writeTasks` step writes today's UTC date as the `next_due_at` placeholder for those rows.

### The Build / Rebuild button

`app/(app)/inventory/[id]/inventory-detail-view.tsx` carries a button next to the existing Edit button in the title row's action area. Visibility and label rules:

- **Hidden entirely** when `ai_insights.maintenance` is null or empty. The button doesn't exist on items without a maintenance section in their insights — the future panel surface (issue #5) will show a "Run Research first" empty state in its place.
- **Build maintenance plan** (`btn-primary`, sparkles icon) when `ai_insights.maintenance` is populated and `last_synthesis_run` is null (or carries an error). First build is a call-to-action, so the accent treatment surfaces it as the next step.
- **Rebuild maintenance plan** (`btn-ghost`, refresh-cw icon) when a successful prior run is on the row. Maintenance affordance rather than CTA; the work is already done.
- **Disabled with a spinning icon** during an in-flight run, with the hint "This usually takes about a minute." rendered beneath the title row. Inline error copy appears underneath when the action returns a failure (RLS, missing env var, workflow start failure).

**In-flight detection** is the load-bearing piece of the client interaction. The page subscribes to UPDATE events on `hearth.inventory` for this row via Supabase Realtime — same pattern as `useHouseRealtime`, but inlined since this is the only consumer. Between the click and the first trace write, in-flight state is held in a local React `useState`; when the workflow completes and writes `last_synthesis_run`, the realtime event arrives, the page compares the trace's `completed_at` against a baseline captured at click time, and flips in-flight false. A workflow that errored writes a trace with `error` populated — the page surfaces that string inline rather than leaving the button stuck "Building…" forever.

### Environment variables

- **`MAINTENANCE_SYNTHESIS_MODEL`** — required, no default. The model string passed to `generateObject`. Routes through the Vercel AI Gateway. Set to `xai/grok-4.3` for issue #126 development; the env-driven knob exists so cheaper alternatives can be A/B-tested without code changes. Missing → `buildMaintenancePlanAction` returns the configuration error inline rather than swallowing it as a workflow start failure.

### What's intentionally not in this issue

The synthesis pipeline + the Build/Rebuild button are issue #126's scope. The following surfaces consume the data this issue persists but ship separately:

- The **on-this-item maintenance panel** that renders the resulting tasks. (Issue #5.)
- The **dashboard "On your plate" panel.** (Issue #5.)
- The **task detail modal** that shows per-task reasoning. (Issue #6.)
- The **mark-renewed sheet** that drives task completion + successor-row insertion. (Issue #6.)
- **Auto-completion + warm-fuzzy toast** when a fresh service receipt closes an open task. (Issue #7.)
- **Promoting workflow terminal errors** to non-retryable per the WDK pattern. Dev-time win; can ship later without affecting behavior.

### Direct-event pipeline

The direct-event pipeline is the deterministic, no-LLM half of maintenance task creation. When a receipt document is attached to an inventory item and its `metadata.expiration_date` is populated, the pipeline writes a `hearth.maintenance_tasks` row with `source='direct_event'` and `kind='renewal'`. Distinct from synthesis: direct-event rows survive a "Rebuild maintenance plan" (the supersede step only touches `source='synthesis'` rows), and they exist whether or not the user has ever clicked Build for the related item.

**Hook point.** Lives inside [`app/actions/documents/save-receipt.ts`](../app/actions/documents/save-receipt.ts), called after the document UPDATE that writes `inventory_id` and flips status to `'attached'`. Awaited (not fire-and-forget) so the inventory detail page re-renders with the new task already visible, and so phase 7's "renewed via document upload" toast can consume the returned `{ created_task_id, closed_task_id }` shape off the same call. The pipeline runs against an attached document — abandoning the Smart Uploader's review stage leaves `inventory_id` null and the pipeline never fires. This is the right behavior; we shouldn't auto-create renewal tasks against documents the user hasn't confirmed are theirs.

**Why save-receipt only, not the photo attach path.** Today only the receipt extraction schema carries `expiration_date`. The photo attach path ([`app/actions/documents/attach-document-to-inventory.ts`](../app/actions/documents/attach-document-to-inventory.ts)) has no source for the field, so wiring it there would be dead code. The pipeline's `kind === 'receipt'` gate is a defense-in-depth check rather than the primary mechanism; if a future kind grows expiration support, wire that action's attach point too.

**Why a service-role client.** The work spans `documents → inventory → houses → maintenance_tasks` and `saveReceiptAction` has already RLS-verified ownership of the attached document. The service-role client avoids re-querying ownership at every step. Tests inject a mock client through the optional second parameter to drive the orchestration paths without a real DB.

### Files

- **[`lib/maintenance/renewal-terms.ts`](../lib/maintenance/renewal-terms.ts)** — `classifyRenewalDocument`, `classifyGenericRenewal`, `renderSubtitle`. Pure classification: takes vendor name + linked inventory item context (type / subtype / house state), returns the task title, subtitle template, and term cards for the future mark-renewed sheet. First-match-wins over an array of per-issuer classifier functions. Today's coverage: Michigan SOS vehicle registration (1yr / 2yr, with a `renewal_url_template` deep-link for phase 6's "Renew now" CTA), and major US auto-insurance carriers (6mo / 12mo). Unrecognized issuers fall through to the generic classifier, which produces a `one_time` cadence task with empty term cards — phase 6's mark-renewed sheet will fall back to a date picker for those. The classifiers are functions, not table data, so a future water-utility classifier can discriminate on an `installed_on` date if needed without restructuring the module.
- **[`lib/maintenance/direct-event.ts`](../lib/maintenance/direct-event.ts)** — `processDirectEventTaskFromDocument(documentId, supabaseOverride?)`. The orchestrator. Gates on `kind === 'receipt'`, `metadata.expiration_date` (YYYY-MM-DD shape), `inventory_id` populated, and `status === 'attached'`. Loads the linked inventory + house in parallel, runs the classifier, checks for an existing open renewal on the same inventory item, closes it cleanly when present (with `completed_by_document_id` linking to the new document), then inserts the new task with `predecessor_task_id` chained back. Returns `{ created_task_id, closed_task_id }`. A failed close short-circuits the insert — proceeding would create the duplicate the idempotency check exists to prevent. A failed insert after a successful close is logged loudly but not retried inline; the user can re-trigger by re-attaching the document.

### Cadence and term cards

When the classifier returns `renewal_options` (Michigan registration's 1yr / 2yr, an insurance carrier's 6mo / 12mo), the pipeline writes the longest available term as `cadence_interval_months` with `cadence_kind='interval'` — the recurrence pattern between user-driven completions. Phase 6's mark-renewed sheet overrides per-occurrence when the user picks a shorter term. When the generic fallback applies (empty `renewal_options`), the task is `cadence_kind='one_time'` with both interval / anchor null. Both shapes satisfy the `maintenance_tasks_cadence_shape` CHECK constraint, and `renewal_options` is persisted per-row so each task is self-describing as the constants map drifts.

### Reasoning shape

Direct-event tasks populate the same `TaskReasoning` jsonb the synthesis pipeline writes, with `source_kind = 'document_expiration'` and an `anchor` of `{ kind: 'document_expiration', detail: 'Expires YYYY-MM-DD', document_id }`. `modifiers` is empty for now — phase 6 may pivot to richer reasoning when the user-visible expand surfaces it. Renderers can switch on `source_kind` to decide between synthesis-style "Why this task" copy and a simpler direct-event "Pulled from your registration" treatment.

### Idempotency chain

Re-uploading a fresh registration card (or any receipt with an `expiration_date` for an inventory item that already has an open renewal *of the same stream*) closes the prior open task — `status='completed'`, `completed_at=now()`, `completed_by_document_id=<new document>`, `completion_notes='Renewed via document upload'` — and inserts a new task with `predecessor_task_id` pointing back. The lookup is scoped by `(inventory_id, kind='renewal', title=<classifier-produced title>, status='open')`. The title scoping is load-bearing: a vehicle's auto-insurance and vehicle-registration tasks share `kind='renewal'` on the same `inventory_id`, and a `(inventory_id, kind, status)`-only check would close one when the other was uploaded — independent renewal streams must coexist. Same query is naturally idempotent against double-save retries: the second save closes the just-created task and chains a fresh one. This is intentional but rare; the Smart Uploader's save flow runs once per user click.

The generic-fallback title ("Renewal", from `classifyGenericRenewal`) is the one stream where unrelated uploads could still collide — two different generic-renewal documents on the same item will chain to each other. That's a known limitation of the catch-all branch; the fix is for those issuers to earn their own classifier, not to add another column.

### Smoke-testing the pipeline

The pipeline runs inside `saveReceiptAction`, so the smoke test is a normal receipt upload through the Smart Uploader against an inventory item whose house state and (for state-keyed classifiers) vendor name match a classifier. Verification is by Supabase dashboard inspection of `hearth.maintenance_tasks` — phase 5 will surface the row in the UI, but for this issue the row's existence + shape is the contract. The first Audi-registration upload writes a Michigan-SOS renewal task with `next_due_at` from the document's extracted expiration date; a second upload for the same vehicle closes that task and chains a successor.

### "On your plate" panel (issue #133)

The dashboard's right column and the inventory detail page both host the same `<MaintenancePanel>` client component. The dashboard surface is house-scoped and **count-capped to overdue + the next 6 upcoming rows** under a single "Coming up" tier (the panel is a "what's on plate now" reminder, not a complete log); the inventory-detail surface is item-scoped and uncapped (the user is already inside a single item's context). Each surface has its own server-rendered data wrapper — [`app/(app)/dashboard/maintenance-panel-dashboard.tsx`](../app/(app)/dashboard/maintenance-panel-dashboard.tsx) and [`app/(app)/inventory/[id]/maintenance-panel-item.tsx`](../app/(app)/inventory/[id]/maintenance-panel-item.tsx) — that runs the appropriate Supabase queries and hands the result to the shared panel. Splitting fetch from render means the dashboard wrapper can take the `house_id` route and use the partial index `maintenance_tasks_house_open_by_due_idx` while the inventory wrapper takes `inventory_id` and uses `maintenance_tasks_inventory_open_by_due_idx`, without the rendering component needing to know which query ran. The dashboard query also joins through `inventory_id` to pull the item's `name` so each row can be labelled "DISHWASHER · Check and refill rinse aid" — at a glance the user shouldn't have to guess which appliance a task belongs to. The item wrapper sets `inventoryName: null` per row (the item context is already established by the page).

The dashboard wrapper carries a `.neq("cadence_kind", "per_use")` filter so per-use practices stay off the date-anchored house-scope panel (issue #135). The item wrapper deliberately omits the filter and selects `cadence_kind` alongside the other row fields; the panel partitions per-use out of the date-anchored tiers and renders them as a fourth tier inside the same panel — "Every time you use it" — styled the same as "Later this season" (neutral tone, transparent rows) with the right-side date label suppressed via the row's `relativeMode="none"` branch. PostgREST's `.neq` on the dashboard side is a strict not-equals that excludes nulls — fine for our data because every synthesis-emitted row has a `cadence_kind`. If a future writer ever inserts rows with a null cadence_kind we'd revisit (the filter would silently drop them today). The completed-this-year count and the most-recent-completion footer don't carry the filter: per-use tasks are standing practices that never reach `status='completed'` in the lifecycle sense, so they can't slip into those counts.

**Dashboard cap + the `/maintenance` destination.** The dashboard wrapper fetches every open scheduled task for the house (per-use excluded at the query level via `.neq("cadence_kind", "per_use")`), ordered ascending by `next_due_at`. The panel's `comingUpLimit` mode (set to 6 by the wrapper, see `DASHBOARD_COMING_UP_LIMIT`) shows every overdue row plus the next 6 upcoming rows under a single "Coming up" tier — no Later this season or Every time you use it tier on this surface. The earlier 30-day window cap was replaced by a count cap (issue #135 follow-up) because post-synthesis-improvements the panel was often sparse with the date window; a count cap keeps it consistently informative without growing unbounded. The trailing area of the section header carries a **View all** link in the house-scope branch (the `N total` chip is suppressed there — it would misrepresent the broader open list since the panel is capped). The link points at [`app/(app)/maintenance/page.tsx`](../app/(app)/maintenance/page.tsx), which is a TBD placeholder today. The route is real so the link works; the full content surface (every open task with time-window and per-item filters) lands in a later issue. The item-scope branch keeps the `N total` chip and the full 3-tier + per-use display — that count is honest because the item-scope query is uncapped.

The inventory-detail wrapper is rendered from `app/(app)/inventory/[id]/page.tsx` (server) and passed into [`inventory-detail-view.tsx`](../app/(app)/inventory/[id]/inventory-detail-view.tsx) (client) as the `maintenancePanelSlot` ReactNode prop. This is the canonical Next.js pattern for embedding a server component inside a client boundary — the wrapper keeps its server Supabase client, the view keeps its client-side hooks, and neither has to know about the other's runtime.

**Tier grouping** is a pure helper in [`lib/maintenance/tier-grouping.ts`](../lib/maintenance/tier-grouping.ts) — `groupTasksByTier(tasks, referenceDate)` returns `{ overdue, next30, later }`. Boundaries are calendar-day with the upper bound inclusive: `today` is `next30` (not overdue), `today + 30` is `next30` (boundary inclusive), `today + 31` is `later`. Within each tier, sort is ascending by `next_due_at` so the most-overdue rows surface at the top of the overdue tier and the soonest-due rows surface at the top of the other two. The reference Date is normalized to UTC midnight before comparison so tier boundaries are stable regardless of the user's wall clock at fetch time. Malformed `next_due_at` values are silently dropped rather than crashing the panel — the database constraint prevents this in practice, but the helper is defensive. Unit-covered in [`tier-grouping.test.ts`](../lib/maintenance/tier-grouping.test.ts) across the empty case, each boundary, the most-overdue-first sort, malformed inputs, and timezone edges on both sides of UTC midnight. The helper's date thresholds drive the item-scope display directly; on the dashboard the panel collapses `next30 + later` into a single "Coming up" tier sliced to `comingUpLimit` rather than displaying the two as separate tiers, so the helper's bucketing is reused even though only two of the three tiers are visible.

**The visual hierarchy is doing real work** and is reflected in the row component's `tone` prop (`danger` / `caution` / `neutral`):
- **Overdue · Take action.** Red left rail, `surface-raised` background, optional accent badge (`CRITICAL` at ≥ 90 days late, `N MONTHS LATE` at 30–90 days, the right-side "X days late" string carries the message under 30 days so the badge stays meaningful). Loudest because real-consequence items belong here.
- **Coming up · Next 30 days.** Calm `surface` cards with a date pill on the right (`Jun 2`, `Jun 14`). "You should know about these."
- **Later this season.** Transparent rows with reduced contrast and relative-time labels (`~6 weeks`, `~4 months`). Aware, not actionable.

**Rows are real `<button>` elements**, not styled divs. Phase 6's task detail modal wires into the existing `onClick`; today it logs `[maintenance-row] tapped task <id>` so the acceptance criteria smoke test can confirm click wiring without any user-visible action. Each row uses a `kind` → icon mapping (`renewal: car`, `service: tool`, `inspection: search`, `consumable: refresh-cw`, `seasonal: leaf`). Source (`direct_event` vs `synthesis`) is not visually distinguished in the row — both are just "things on your plate"; the future detail modal differentiates.

**The `GoodStewardFooter`** ([`components/maintenance/good-steward-footer.tsx`](../components/maintenance/good-steward-footer.tsx)) renders beneath the tiers when `completedThisYear > 0`, showing the count and the most-recent completion's title and date. It returns null otherwise — the empty house empty state never includes the footer, and the dashboard wrapper queries the count + most-recent in parallel (`head: true` count + a `limit(1).maybeSingle()`) to keep the read cheap.

**Empty-state taxonomy:**
- **House empty state** — no open tasks across the entire house. Renders the panel's section header on its own and a one-line "open an inventory item and tap Build maintenance plan" message. If the user has completed any tasks this year, a quiet "you've completed N task(s) this year" line shows beneath.
- **Item empty state, `kind: "needs_research"`** — the inventory item has no `ai_insights.maintenance`. Renders the "Run Research on this item first" message; no primary CTA (the page's Research panel above already has that). Used for appliances / systems / exterior items only.
- **Item empty state, `kind: "no_plan_yet"`** — `ai_insights.maintenance` is populated but no synthesis run yet. Renders the "build a plan" message pointing at the existing Build button in the title row, rather than duplicating the action inline (the title-row button is the single source of truth for the action). Used for appliances / systems / exterior items only.
- **Item empty state, `kind: "property_no_documents"`** — the item is a property row (`type === "property"`). Property doesn't participate in the Research / synthesis pipeline (mirrors `PropertyInsightsPlaceholder` taking the slot where `ResearchPanel` would render); its maintenance comes from documents the user uploads with an expiration date, processed by the direct-event pipeline. The empty state points the user at the "Add document" button above, and the copy branches on `propertyKind` (`vehicle` / `pet` / `other_property`) so vehicles call out registration / insurance by name, pets call out vet records, and generic property gets the broader framing.

The page.tsx server component passes the inventory item's `type` and `subtype` to the wrapper alongside `hasActionableInsights`; the wrapper picks the discriminator (property rows short-circuit to `property_no_documents` regardless of the insights state) and hands the resulting `ItemEmptyState` to the panel. The panel chooses the empty branch over the populated branch when the tasks array is empty.

### History section on the inventory detail page (issue #133)

The earlier "Maintenance & history" placeholder section is replaced by a real "History" section that reads from `hearth.maintenance_tasks` filtered to `status='completed'` for this inventory item, with `installed_on` and `purchased_on` milestones interleaved chronologically. Data fetch happens in `app/(app)/inventory/[id]/page.tsx` (the same parallel block that loads rooms / docs / receipts) and the merged event list is sorted by date descending and handed to the view. Each event renders as a `<TimelineItem>` — the existing primitive in `components/ui.tsx` — using the same kind→icon mapping the maintenance rows use, so a "Vehicle registration" completed task renders with a `car` icon and a "Furnace service" completed task renders with a `tool` icon. Milestones use `circle-dot`.

The disabled "Log maintenance" placeholder button is gone — task creation flows through synthesis or the direct-event pipeline now, and per-task completion is handled by the detail modal's CTAs (issue #137). When the item has no completed tasks and no install/purchase dates yet, the section falls back to a single "No history yet" timeline row rather than rendering an empty `<ol>`.

### Task detail modal and completion sheets (issue #137)

The panel rows on the dashboard and the inventory detail page open into [`<MaintenanceTaskModal>`](../components/maintenance/maintenance-task-modal.tsx) — the "seeing" surface where every per-task reasoning field finally renders for users. The primary CTA on that modal opens a sub-sheet that closes the task and writes the successor row.

**The trigger + modal pattern.** [`<MaintenanceTaskRow>`](../components/maintenance/maintenance-task-row.tsx) stays presentational — it forwards `onClick` + `ref` to the underlying `<button>` — and [`<MaintenanceTaskTrigger>`](../components/maintenance/maintenance-task-trigger.tsx) is the client wrapper that owns modal state and the return-focus ref. The panel renders triggers instead of rows directly; the trigger renders the row and, while open, mounts the modal. Mirrors the `HabitatFindingTrigger` / `HabitatFindingModal` pattern.

**Detail modal data fetch.** The modal pulls its full payload via a `taskId` round trip rather than receiving everything through props. The panel's row only carries the subset needed for rendering (id, title, subtitle, due-date, kind, source, inventory_name, cadence_kind); fattening that query for fields most opens won't read would over-fetch on every dashboard render. The modal selects the full row plus the joined inventory + room, then conditionally fetches the anchor document by the `reasoning.anchor.document_id` so the thumbnail can render alongside the artifact link.

**Three modals share one shell.** [`<MaintenanceModalShell>`](../components/maintenance/maintenance-modal-shell.tsx) wraps the detail modal and both completion sheets. The shell owns scroll-lock, the focus trap, ESC-to-close, return-focus on unmount, and the surface-ai chrome. Extraction was justified by three callers in the same module (the codebase's stated extraction threshold) and would have been ~120 lines of duplicated mechanics otherwise. When a completion sheet opens on top of the detail modal, both shells coexist in the same portal layer at `z-50`; the sheet's later-mounted document-level keydown listener captures ESC and Tab first, which is the behaviour the user expects from "I opened a sub-action, ESC should close that, not the parent." The shell also tracks whether other dialogs are still in the tree before removing `scroll-locked` so closing the inner sheet doesn't release scroll lock on the parent.

**The instructions callout — the primary content.** The task's `subtitle` (the actual maintenance instruction prose — "Vacuum blower housing, clean exhaust duct, inspect gas connector") is rendered as a focal callout block at the top of the modal body via the `TaskInstructionsCallout` helper in [`<MaintenanceTaskModal>`](../components/maintenance/maintenance-task-modal.tsx): surface-raised background, accent-colored left stripe, small tool icon, primary text color at weight 500 (issue #177). The treatment echoes the modifier rows inside `WhyThisTaskExpand` at lower intensity — accent presence without accent fill — so the user's eye lands on "what to do" before "when" (the due-date pill follows the callout, not the other way around). The same callout serves per-use rows, with the fallback string "Every time you use it." when `subtitle` is null.

**The reasoning expand — brand-thesis-made-visible.** [`<WhyThisTaskExpand>`](../components/maintenance/why-this-task-expand.tsx) is the modal's headline surface. Defaults **open** as of issue #177 — the brand-thesis of "we explain our recommendations" only lands when the explanation is visible by default. Users who want the calmer view can still tap to collapse, and the open state is local component state (the next open of the modal starts from the default again). The collapsed label switches between "Why this task" and "Why this practice" via a `variant` prop so per-use rows read naturally. When the task has modifiers, a small accent-chip count ("2 adjustments") appears on the label so the user can tell a habitat-adjusted task apart from a vanilla one at a glance. The open state renders `source_kind` in plain words, the `cadence_basis` prose, the cadence in plain language (Monthly / Every 6 months / Annually / Every 2 years), each modifier as a tinted row with a "See finding" link when `finding_module_key` is populated (the link uses the `/dashboard#habitat` hash anchor — habitat tiles don't have individual deep-link routes yet, the dashboard anchor is good enough for v1), and the anchor detail.

**History chain.** [`<TaskHistoryList>`](../components/maintenance/task-history-list.tsx) walks the `predecessor_task_id` chain backwards from the current task in two queries per step (one to read the cursor's predecessor pointer, one to read the predecessor's full row) with a defensive bound of 10 prior occurrences — chains are short in practice and the modal opens infrequently. Each row shows the completion date, whether it was closed by a document upload or marked manually, and the optional completion notes. A future recursive-CTE Postgres function could collapse this to one round trip; not now.

**The complete-task action.** [`completeTaskAction`](../app/actions/maintenance/complete-task.ts) is the user-driven analogue of the direct-event pipeline. It runs through the cookie-bound (RLS-enforced) Supabase client — no service role — because it's the user acting on their own task. Sequence: load the current row → guard against `status !== 'open'` → flip status to `'completed'` with `completed_at` anchored at UTC noon on the user's chosen calendar day → compute the successor's `next_due_at` via [`computeSuccessorDueDate`](../lib/maintenance/successor-task.ts) → insert the successor row with `predecessor_task_id` chained back, carrying through the prior task's `cadence_kind` / `cadence_interval_months` / `cadence_seasonal_anchor` / `renewal_options` / `renewal_url` / `subtitle` so the next occurrence is fully self-describing. The successor's `reasoning` carries `source_kind: 'manual_completion'` and an anchor of `{ kind: 'manual_completion', detail: 'Anchored from <date> completion.', document_id: null }`, with modifiers copied through from the prior task so habitat-driven cadence adjustments don't reset on every completion. The two new TypeScript literals are additive on the `TaskReasoning` type — the jsonb column accepts any shape, so no migration was required for them. `revalidatePath` fires for both `/dashboard` and `/inventory/[id]` so the panel reflects the close + new row on the next render.

**The mark-renewed sheet.** [`<MarkRenewedSheet>`](../components/maintenance/mark-renewed-sheet.tsx) is the user-acting surface for renewal-kind tasks. Renders `renewal_options` as a 2-column card grid; each card shows the projected expiration date inline ("12 months · May 24, 2027") so the user sees the consequence of their choice on the card itself. The longest term is pre-selected by default — matches the direct-event pipeline's longest-term-as-cadence rule, so the most common case is one-tap. An "Enter a different date instead" escape hatch is always available when term cards are offered, for the case where the user knows the actual expiration date doesn't match any term (the Michigan birthday-anchor quirk is the canonical case; the sheet surfaces a small warning block for Michigan registrations explaining that the term cards are approximate and nudging the user toward the document-upload path for the clean version). The save call goes through `completeTaskAction({ taskId, completedOn, newExpiration, notes })`; the `newExpiration` argument wins over the cadence math in `computeSuccessorDueDate`.

**The mark-completed sheet.** [`<MarkCompletedSheet>`](../components/maintenance/mark-completed-sheet.tsx) is the simpler sibling for service / inspection / consumable / seasonal tasks. The cadence is fixed by the task itself, so the user only picks a completion date and optionally enters notes; the successor's `next_due_at` is computed server-side from `cadence_interval_months`. For `one_time` cadences the helper returns null and no successor is inserted — the closed task is the terminal record. The sheet title swaps per kind (Mark serviced / Mark inspected / Mark refilled / Mark done).

**The successor-due-date helper.** [`computeSuccessorDueDate`](../lib/maintenance/successor-task.ts) is the only pure logic in the completion flow worth extracting and testing in isolation. Three branches: an explicit `newExpirationOverride` always wins (renewal sheet's user-chosen date); `one_time` / `per_use` cadences return null; otherwise the result is `completedOn + cadence_interval_months` via `Date.UTC` so the calendar-day output is stable across local time zones. JavaScript's `Date.UTC` clamps an overflowed day forward — Feb 29 + 12 months becomes Mar 1 of the next year — and that's the behaviour the mark-renewed sheet's projected-expiration preview uses, so the user sees the rolled date before they confirm. [Unit-covered](../lib/maintenance/successor-task.test.ts) across the override, the cadence branches, malformed inputs, and the leap-year rollover.

**Completed task openings.** The modal renders the same shell with the CTA hidden when the task is `status='completed'`. Most opens are read-only ("what is this task?"); a completed-task open is the same shape with the chain extended one step further. This is also the surface the History section's items will route into when that section moves from `<TimelineItem>` to clickable rows in a follow-up.

### InventoryPreview preservation

The dashboard's earlier `InventoryPreview` server component (recently-attached appliance tiles) is preserved at `app/(app)/dashboard/_unused/inventory-preview.tsx`. Next.js' private-folder convention (`_`-prefixed segments) excludes it from the route tree; nothing in the active build imports it. The header comment in the moved file documents the reason for keeping it: a future inventory-list-page sidebar surface could reuse the same visual shape. Free to modify or delete if it becomes clear we'll never reuse it.

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Public-records sources beyond EPA radon, EPA Superfund proximity, and FEMA flood zones** — BS&A assessor data, lead-disclosure heuristics, water-system violations, etc. Each is a new habitat module under `lib/habitat/modules/<key>/`; the orchestrator already iterates the registry, so adding a module is a contained change. The finding detail modal renders these out of the box from the generic `HabitatFinding` shape; richer per-module structured content (flood-history timeline, soil testing panels, etc.) is deferred until a module forces a slotted-shell contract.
- **Description synthesis** — for v1 we show `description_source` (Zillow's raw copy) as `description`. A future LLM step will rewrite `description` in Hearth's voice while leaving `description_source` intact.
- **Free-tier upsell surface.** When a free user has one house and would otherwise see an "Add a property" action, the action is gated off entirely. Showing an upsell prompt in its place is its own focused work.
- **Inventory CRUD**. Schema exists; the Smart Uploader (#51) covers the create path through photo capture, the `/inventory/[id]` detail route (#53) covers the read path with hero photo, structured pills, and the Research panel, the edit / delete modal (#54) covers update + destroy, and the `/inventory` list page (#67) covers browse across all items. The `/entities/[id]` and `/documents/[id]` routes are vestigial placeholder shells from the original dashboard mockup — kept around because nothing references them anymore.
- **OCR + extraction routing for non-nameplate documents** (receipts, manuals, permits, invoices) — the `kind` discriminator and Grok pipeline are in place from phase 1.3, but the Smart Uploader only writes `nameplate` / `photo` today. The disabled "Document or receipt" and "Emergency procedure video" entries on the path-picker exist as the future surface for those flows.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --linked` (against the remote-linked project) is wired into the workflow, it'll replace the hand-typed row.
