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
    appliances/            # Inventory list
    documents/[id]/        # Document detail view
    entities/[id]/         # Inventory item detail view
  auth/                    # Supabase auth route handlers
    callback/              # OAuth callback exchange
    confirm/               # Magic-link verification
    signout/               # Server-side sign-out POST
  login/                   # Public sign-in page (OTP + Google)
  layout.tsx               # Root html/body shell, font wiring
  page.tsx                 # Public landing; redirects authed users to /dashboard
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
public.profiles               (shared; references auth.users)
  └─ hearth.houses            (1 user → many houses; one for now)
       ├─ hearth.rooms        (default 9 seeded by trigger on house insert)
       ├─ hearth.inventory    (room_id NOT NULL; Exterior holds outdoor items)
       │    └─ hearth.documents  (inventory_id nullable; many-to-one)
       └─ hearth.documents    (house_id required; can exist unattached)
```

Key facts about each table:

- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `lot_size_acres`, `bedrooms`, `bathrooms`, `heating_summary`, `cooling_summary`, `parcel_id`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. `lot_size_sqft` and `lot_size_acres` are intentionally redundant: Zillow displays one or the other depending on lot size, and downstream queries want sqft for sorting while UI rendering prefers acres for large lots; the briefing validator derives whichever isn't returned. `heating_summary` / `cooling_summary` are short free-form strings ("Forced air, Gas", "Central") — untyped because Zillow's vocabulary isn't constrained enough to justify an enum yet. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. Generated-image columns (`generated_image_url`, `generated_image_prompt`, `generated_image_created_at`) hold the storage path + prompt + timestamp for the architectural-sketch placeholder (see "Generated house illustration" below). RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
- **`hearth.rooms`** — physical spaces inside a house. `kind` is `indoor | outdoor | utility`. The **`houses_seed_default_rooms`** trigger fires `after insert on hearth.houses` and inserts a 9-room default set (Kitchen, Living Room, Primary Bedroom, Primary Bathroom, Basement, Attic, Garage, Laundry, Exterior). The Exterior room exists so outdoor inventory has a non-null home.
- **`hearth.inventory`** — every appliance, system, and exterior element. `type` is `appliance | system | exterior` and drives UI grouping. `room_id` is NOT NULL with `ON DELETE RESTRICT`. Identification fields (manufacturer/model/serial), install/service dates, status, and an optional hero photo path round it out.
- **`hearth.documents`** — every user-captured asset attached to a house: photos today, PDFs and compressed videos in later phases. `kind` is the discriminator that drives extraction routing and UI treatment (`nameplate`, `photo`, `receipt`, `manual`, `permit`, `warranty`, `invoice`, `inspection`, `emergency_procedure_video`, `other`); phase 1 writes only `nameplate` and `photo`, and the other values are reserved so future phases don't need a schema change. `status` is the lifecycle column — `analyzing → analyzed → attached`, with `failed` as the terminal-error state — driven by the Smart Uploader's early-INSERT pattern (the row exists from the moment storage uploads succeed). `storage_path` holds the 1920px display version and `thumbnail_path` holds the 600px thumb; **the original uncompressed file is intentionally not stored** — only the resized versions land in the bucket. `content_hash` is the SHA-256 of the pre-resize bytes for per-house dedup (partial unique index on `(house_id, content_hash)`), but the bytes themselves are discarded after the Canvas reads them. `house_id` is `NOT NULL` with `ON DELETE CASCADE` — deleting a house removes its documents. `inventory_id` is nullable with `ON DELETE SET NULL` — documents exist before the user attaches them in the review stage, and deleting an inventory item later reverts its documents to unattached rather than destroying them. `uploaded_by` references `auth.users` with `ON DELETE SET NULL` so documents survive user deletion. AI provenance lives in `ai_extraction` (jsonb, kind-specific schema in app code), `ai_model`, `ai_confidence` (0..1), and `analyzed_at`. RLS scopes through house ownership identical to `hearth.inventory` — four policies (SELECT/INSERT/UPDATE/DELETE) all delegating to `hearth.houses.owner_id = auth.uid()`.

All four tables use a shared `hearth.set_updated_at()` trigger function defined in the houses migration.

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

`hearth.documents` is the table-of-record for every user-captured asset attached to a house. The `hearth-documents` bucket is its storage counterpart. Together they back the Smart Uploader (photos today; PDFs and compressed videos in later phases) and any future Documents UI.

The bucket is **private** — `public = false` on `storage.buckets`. There is no permanent URL for an object; the Smart Uploader and future Documents UI derive a signed URL at render time, same pattern as `house-images` and `house-photos`.

### Storage path layout

Objects within the bucket follow:

```
{house_id}/{document_id}/optimized.jpg     -- 1920px JPEG for photos
{house_id}/{document_id}/thumb.jpg         -- 600px thumbnail
```

The `{document_id}` directory makes cleanup-on-retake trivial — one `.remove()` against the directory wipes both files for the doc. The first path segment is the `{house_id}` uuid, which is what storage RLS keys on.

Future video documents will store the compressed MP4 at `optimized` and a poster-frame JPEG at `thumb`. Future PDF documents will store the PDF at `optimized` and a page-1 raster at `thumb`. The two-path shape stays constant across kinds.

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
- **`upload.ts`** — `uploadDocumentFiles({ supabase, houseId, documentId, optimized, thumbnail })` uploads both files to the `hearth-documents` bucket in parallel with `upsert: false` and `cacheControl: "31536000, immutable"`. On partial failure it best-effort-removes whichever upload succeeded so the bucket never accumulates orphaned bytes from a half-completed Smart Uploader flow, then re-throws the original error. Takes a browser Supabase client; storage RLS does the actual ownership enforcement.

These helpers don't insert the `hearth.documents` row — that's a server action handled separately so the row insert can be a single atomic write with the storage paths already known. The `{document_id}` segment is generated client-side via `crypto.randomUUID()` before any storage round-trip, which is what makes the upload-then-insert ordering possible; the same UUID becomes the row's primary key. The trade-off is that an upload can succeed without a row existing — the Smart Uploader's `useEffect` cleanup handles "user closed the modal mid-flow", and a periodic sweep of orphaned bytes is deferred to a later phase.

---

## Server actions and the Grok analyze pipeline

The Smart Uploader's server-side surface is seven `"use server"` actions under `app/actions/documents/` plus the Grok 4.3 vision wrappers in `lib/documents/ai/`. The modal in phase 1.4 is the orchestrator — every action below is callable in isolation and returns the project's standard `{ data, error }` shape. None of them bypass RLS via the service-role client; ownership enforcement is the load-bearing job of `hearth.documents` and `hearth.inventory` policies, both of which delegate through `hearth.houses.owner_id = auth.uid()`.

The row type for `hearth.documents` is hand-typed in [types/document.ts](../types/document.ts) (`DocumentRow`, plus the `DocumentKind` / `DocumentStatus` unions and the `AiExtraction` discriminated union used for the `ai_extraction` jsonb column). Same pattern as `types/house.ts` — kept in sync with the migration until `supabase gen types typescript` replaces it.

### The seven actions

All under `app/actions/documents/`, all use `createClient` from [lib/supabase/server.ts](../lib/supabase/server.ts), all return `Promise<{ data, error: null } | { data: null, error: string }>`.

- **`checkDocumentDuplicateAction`** — looks up an existing `hearth.documents` row in the given house by SHA-256 `content_hash`. Used by the Smart Uploader before insert so a byte-identical re-upload jumps to the existing-row branch instead of tripping the partial unique index. Returns `{ exists: false, existingDocument: null }` or `{ exists: true, existingDocument: <row> }`.
- **`createPendingDocumentAction`** — inserts a `hearth.documents` row with `status='analyzing'`. The storage uploads have already completed by this point; the action takes the pre-allocated client-side UUID and the storage paths and writes the row. `uploaded_by` is set from `supabase.auth.getUser()`. An optional `inventoryId` parameter pre-attaches the document for the "open Smart Uploader from inventory detail" entry point.
- **`analyzeNameplateAction`** — the only action with non-trivial business logic. Loads the row, mints a 5-minute signed URL against the `hearth-documents` bucket via `createSignedUrl()`, calls either `classifyImage` (when no `existingInventoryData`) or `deltaImage` (when present), normalizes the result into the `AiExtraction` shape, writes back `ai_extraction` / `ai_model` / `ai_confidence` / `analyzed_at` and flips `status` to `analyzed`. On any throw from the Grok call the row flips to `status='failed'` and the action returns the error message — the modal renders this as the "couldn't read that, try again?" branch.
- **`findMatchingInventoryAction`** — case-insensitive `ilike` lookup on `hearth.inventory.name` within a house. Returns zero or more `{ id, name, type, room_id }` rows. The review stage decides between "create new" and "link to existing" based on this result.
- **`createInventoryFromDocumentAction`** — inserts a new `hearth.inventory` row using the user-confirmed values, then attaches the document to it (`inventory_id` set, `status='attached'`). Two sequential queries rather than a Postgres function — simple enough that a function isn't justified yet. Inventory columns are `manufacturer` / `model_number` / `serial_number` / `installed_on` / `notes` (the schema's actual column names, not the prompt-draft `model` / `serial`).
- **`attachDocumentToInventoryAction`** — attaches a document to an *existing* inventory row, optionally merging accepted AI-extracted fields (`acceptedFields`) into that inventory row first. The merge runs before the document UPDATE so a merge failure leaves the document in its prior state — the user can retry rather than ending up with an attached document whose inventory row doesn't reflect their accepted edits.
- **`cleanupDocumentAction`** — used by the modal's retake / cancel paths. Best-effort `storage.remove()` of the two known object paths (optimized + thumbnail) followed by an authoritative `DELETE` of the row. A failed storage removal does not block the row delete; orphaned bytes are deferred to a future periodic sweep, same pattern as the Smart Uploader's upload-orphan trade-off documented in the client-side library section.

### Grok 4.3 via the Vercel AI Gateway

[`lib/documents/ai/`](../lib/documents/ai/) holds the model wiring. Three files:

- **`schema.ts`** — Zod schemas for `generateObject`. `classificationSchema` is a `z.discriminatedUnion("photo_kind", […])` of three branches (`nameplate`, `appliance_photo`, `not_useful`); the discriminator lets the model pick exactly one shape. `deltaSchema` is a `{ deltas: Record<string, { currentValue, proposedValue }>, confidence }` object. Both are the contract between Grok and the rest of the system — the AI SDK rejects any model output that doesn't validate, so getting these right is load-bearing.
- **`prompt.ts`** — `buildClassifyPrompt()` returns the static classify-and-extract system prompt; `buildDeltaPrompt({ existingInventoryData })` returns the delta prompt with a JSON-serialized existing-data block appended. Separated from `analyze.ts` so they're easy to iterate on and easy to unit-test against ("the assembled string contains the existing-data block", "all three photo_kinds are named", etc.).
- **`analyze.ts`** — `classifyImage(input)` and `deltaImage(input)`, both thin wrappers around `generateObject({ model, schema, system, messages })` from the `ai` package. The image part of the user message is `{ type: "image", image: new URL(input.imageUrl) }` — the action passes a Supabase storage signed URL rather than loading bytes into the Node process. Throws on missing `NAMEPLATE_PRIMARY_MODEL`; the calling server action catches and surfaces.

The two modes correspond to the two ways a homeowner photographs an item. Mode A is "I don't know if you've seen this before, look at it fresh" — three `photo_kind` outcomes (`nameplate` with extracted fields, `appliance_photo` with classification only, `not_useful` to prompt a retake). Mode B is "you already know this item, here's another angle" — return only the fields where the photo adds or contradicts.

### Kind demotion

A row inserted with `kind='nameplate'` can be demoted to `kind='photo'` when the AI classifies the image as `appliance_photo`. The demotion is one-directional: rows inserted as `photo` from the dashboard's generic entry point stay where they are even if the AI judges them to be label shots. The `not_useful` path leaves `kind` untouched — the caller's next move is almost always `cleanupDocumentAction`, so the column's value stops mattering immediately.

### Environment variables

Both read at call time so the model can be swapped without redeploying:

- **`NAMEPLATE_PRIMARY_MODEL`** — required. The model string passed to `generateObject`. Routes through the Vercel AI Gateway; the gateway forwards to xAI using the project's BYOK Grok credentials. Default in development: `xai/grok-4.3`. Missing → `analyzeNameplateAction` returns the configuration error.
- **`NAMEPLATE_CONFIDENCE_THRESHOLD`** — float in `[0, 1]`. The Smart Uploader's review stage shows a low-confidence branch when `ai_confidence < threshold`. Default `0.6`. Consumed server-side in 1.3 only as a documented contract; the modal in 1.4 reads it via the analysis result, so neither value needs `NEXT_PUBLIC_` exposure.

These are populated in `.env.local` via `vercel env pull` and configured in the Vercel dashboard for preview / production environments.

---

## Inventory detail page and AI insights

The inventory detail page at `app/(app)/inventory/[id]/page.tsx` is the page-level destination behind every dashboard inventory tile. Two AI surfaces live here: **structured pills** (discrete `{label, value}` facts pulled from the nameplate at upload time, rendered in the title area) and **Research this model** (an on-demand Perplexity Sonar lookup that produces a "what we know about [things] like yours" panel). Both store their output as jsonb columns on `hearth.inventory` and are independently regeneratable.

### Page, not modal

The detail page is a real Next.js route, not a modal. Deep links work, browser refresh works, and any future "Add another photo / re-analyze" entry point can ride the same URL. The earlier mockup floated a modal — we explicitly chose a page so the surface can grow over time without fighting modal mechanics. The page lives at `/inventory/[id]`; the older `/entities/[id]` placeholder still exists from the dashboard mockup and is intentionally untouched in this phase.

### Schema additions

Migration `20260519153348_add_inventory_ai_columns.sql` adds two nullable jsonb columns to `hearth.inventory`:

- **`ai_pills`** — `Array<{ label: string, value: string }>`. Populated at row-creation time by `createInventoryFromDocumentAction`, which copies the source document's `ai_extraction.extracted.pills` through. Nameplate-classification documents are the only path that produces pills; appliance_photo and not_useful documents leave the column null.
- **`ai_insights`** — single object: `{ headline, overview, service_life, maintenance, source_urls, found_specific_model, generated_at, model_used }`. The three content sections (`overview` / `service_life` / `maintenance`) are independently nullable so the model can populate the parts it can ground and leave the rest null. Populated on-demand by `researchInventoryModelAction` and overwritten in place on re-run, which is what lets Todd iterate on the prompt during development without extra plumbing. The column is jsonb (application-defined shape), so the section split landed without a migration; legacy rows written before the split carry a stale `body` field and render as if no sections are populated — the user clicks "Research again" to regenerate.

Both columns are additive and forward-only; no backfill is needed.

### Pills extraction

`lib/documents/ai/schema.ts` extends the nameplate branch's `extracted` shape with `pills: z.array(pillSchema)`, where `pillSchema = { label: string min 1 max 40, value: string min 1 max 120 }`. Bounded lengths exist because the detail-page chip cluster can't render unbounded text without breaking the layout. The `appliancePhotoBranch` does **not** get pills — appliance photos by definition have no readable label.

The classify-and-extract prompt in `lib/documents/ai/prompt.ts` gains a section that explains the pills array, gives 5–6 worked examples (Capacity / BTU Input / Fuel / Manufacture Date / Voltage / Max Pressure), and codifies two rules the prompt enforces: skip industry-internal codes (certification numbers, factory codes), and skip facts already captured as named extracted fields (manufacturer / model_number / serial_number) — those have their own structured place.

The Smart Uploader review stage (`components/smart-uploader/stages/ReviewNewStage.tsx`) renders the extracted pills as a read-only chip cluster beneath the editable fields ("Also captured: …"). This is deliberate: users shouldn't discover the pills surface for the first time on the detail page. Pills are not editable in this phase.

### Research this model pipeline

The `lib/inventory-insights/` module mirrors `lib/briefing/` in shape and intent — Perplexity Sonar via the Vercel AI Gateway is the right tool for "research a specific physical product on the live web" the same way it's the right tool for the Zillow lookup. Four files:

- **`prompt.ts`** — two builders. `buildResearchSystemPrompt()` returns the general framing that applies to every call (search strategy, honesty rules, output structure, the 1200-char per-section ceiling); `buildResearchUserMessage(input)` returns the per-item ask, embedding the item's known data (type / name / manufacturer / model_number / pills / notes) and three numbered asks — one per output section. Splitting system from user message gave the model an explicit cadence to follow; the earlier single-string prompt with a thin user message produced responses that populated only the first ask. The pills block and the notes block in the user message are each omitted cleanly when their source is null or empty so the prompt never carries dangling "Details from the nameplate:" headers with nothing beneath them.
- **`prompt.test.ts`** — covers the field-presence permutations on the user message and the load-bearing system-prompt content (output field names, "Use web search multiple times" guidance, "return null for that section" honesty rule, character caps).
- **`research.ts`** — `researchInventoryModel(input)` wraps a `generateObject` call against `INVENTORY_INSIGHTS_MODEL ?? BRIEFING_PRIMARY_MODEL`, validating output against `insightsSchema`. The schema's three content sections (`overview` / `service_life` / `maintenance`) are independently nullable with `.min(1)` on each — empty string is invalid, so the only way to skip a section is `null`, which forces the model into a binary "I have something grounded" decision per section. The function is pure — it does not write to the database — which keeps it easy to test and easy to swap providers in isolation.
- **`research.test.ts`** — covers the schema's null-vs-empty-string semantics, the per-section length cap, and the "missing key vs explicit null" distinction (Zod requires the field present in the object even when its value is null).

The server action `app/actions/inventory/research-model.ts` is the only caller. It loads the inventory row (RLS-scoped through `hearth.houses.owner_id`), invokes `researchInventoryModel(...)`, writes the result (headline + three nullable sections + provenance fields) into `ai_insights`, and `revalidatePath`s the detail page so the client's `router.refresh()` after the action completes pulls the updated server-rendered panel into view. **No streaming for v1** — Sonar with web grounding typically takes 5–15 seconds, which is fine for a button-click flow with a clear loading overlay.

### On-demand, not auto

Research runs only when the user clicks the Research button. We deliberately did not auto-run on inventory creation: the prompt is still evolving, the model choice may change, and burning Gateway credits on every new row before we know the output is what we want would be wasteful. Auto-running on save is a future enhancement; the column shape supports it (regeneratable) so we won't have to re-shape data when it lands.

### Detail page surfaces

- **Hero photo** comes from the most-recently-attached document for the inventory item (same query shape as the dashboard's `InventoryPreview`), signed at the optimized 1920px storage path rather than the 600px thumbnail since the detail page isn't space-constrained.
- **Stat tiles** (Installed / Last Serviced / Next Due) always render all three. Tiles with no underlying date show "Unknown" in tertiary text and drop the relative-time meta line. Layout stays stable across items, and the field is discoverable for the future edit-from-detail flow.
- **Pill cluster** renders the serial number first as the brighter accent pill (`chip chip-ai chip-mono` — the serial is the load-bearing identifier for the physical unit) followed by the AI-extracted spec pills in the order the model returned them, using the muted base `chip` treatment so they don't compete with the SN for attention. The cluster doesn't render at all if both sources are empty.
- **"What we know" panel** is the home for the Research surface. The button is disabled (with a tooltip) when manufacturer or model_number is missing, and is always available when insights already exist so a re-run is one click away. Insights render as up to three subsections (`Overview` / `Service life` / `Maintenance`) with their own eyebrow labels; a section the model returned `null` for simply doesn't render. If all three are null, a small caption explains that no detail was found and invites a re-run. When `found_specific_model: false`, a category-level disclaimer renders above whatever sections came back. The panel's empty state, loading overlay, and error path are co-located in `inventory-detail-view.tsx`.

### Deliberately deferred

These appear in the page layout but are intentionally **not wired to real data** in this phase:

- The **Documents** panel — wiring it to `hearth.documents` (per-inventory attachments) is its own focused work.
- The **Notes & photos** panel — depends on a notes data model that doesn't exist yet.
- The **Maintenance & history** panel — depends on a maintenance-log table that doesn't exist yet. The single timeline row showing `installed_on` is the only real data point on the panel today.
- **Editing inventory fields from the detail page** — view-only in v1. Edit-from-detail-page is its own follow-up.
- **The "Add another photo / re-analyze" flow** — the disabled Add photo button is the placeholder for the future Smart Uploader entry point keyed to a known inventory id.
- **A `/inventory` list page** — still deferred. Tiles on the dashboard remain the primary surface.

---

## Smart Uploader modal and dashboard wiring

The Smart Uploader is the user-visible composition of phase 1's plumbing — the modal that homeowners actually interact with when they tap **+ Add** in the top nav. It owns the path-picker → capture → process → analyze → review → save flow end-to-end, calls the seven server actions in [app/actions/documents/](../app/actions/documents/), and writes nothing to storage or to `hearth.documents` that the client-side library helpers and server actions didn't already own.

### Entry point

The top-nav `+ Add` button (`components/top-nav.tsx`) opens the modal. The same button is rendered twice — once as a labeled button on `md+` viewports, once as an icon-only button on small viewports — so it survives the mobile breakpoint without a separate mount. Both invocations share state. The button is disabled until the user has a house (`(app)/layout.tsx` passes the house row through `AppShell`); during onboarding the user can't open the uploader because there's no `houseId` to attach to. Other entry points are intentionally not wired in phase 1.4 — the future "Add another photo" affordance from `/inventory/[id]` will set `targetInventoryId` on the same component when that detail page lands.

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
    ├── CaptureStage.tsx       # file input, preview, retake/analyze
    ├── ProcessingStage.tsx    # spinner with phase-specific status copy
    ├── DuplicateStage.tsx     # short-circuit when content_hash already exists
    ├── ReviewNewStage.tsx     # nameplate / appliance_photo / manual-entry form
    ├── NotUsefulStage.tsx     # AI said the photo doesn't show an appliance
    └── AnalysisFailedStage.tsx # any thrown error → retake or enter manually
```

### Stage state machine

`SmartUploader.tsx` holds a discriminated union over `stage.name` in a single `useState`. Transitions are driven by two sources: user action (advance from path-picker → capture → analyze) and the `useDocumentUpload` hook's published state (the modal `useEffect`-watches `uploadState.phase`/`.duplicate`/`.analysis` and translates them into the corresponding user-facing stage). Keeping the user-facing state machine separate from the pipeline phases lets each evolve independently — the hook can grow new sub-phases (e.g. for video uploads) without churning the modal's branches.

The five reachable post-processing branches are:

- **Duplicate** — `checkDocumentDuplicateAction` returned `exists: true`. No new row is created, no storage is uploaded, no cleanup is needed.
- **Review-new (nameplate)** — AI classified the photo as a nameplate and extracted manufacturer/model/serial/installed.
- **Review-new (appliance_photo)** — AI classified the photo as a generic equipment shot. Same review form, no extracted-fields panel.
- **Not-useful** — AI returned `not_useful`. Both buttons (Cancel / Try a different photo) call `cleanupDocumentAction` before transitioning.
- **Analysis-failed** — any action returned an error. Retake calls cleanup and returns to capture; "Enter manually" advances to a `manual-entry` variant of `ReviewNewStage` (same form with empty defaults and no AI-driven headline) so the user can still capture the item by hand against the photo that's already stored.

The low-confidence variant of review-new fires when `ai_confidence < NAMEPLATE_CONFIDENCE_THRESHOLD` (currently `0.6`). The threshold is mirrored as a constant in `ReviewNewStage.tsx` and the technical-guide contract is that the server-side env var and the client-side constant move together — bumping one without the other will silently mis-classify a band of photos.

The "you already have a Furnace" banner is `ReviewNewStage`'s opt-in to the link-to-existing path: when `findMatchingInventoryAction` returns one or more matches, a banner appears above the form with one button per match (capped at 3) that calls `attachDocumentToInventoryAction` and short-circuits the create path entirely. The "Create new" button dismisses the banner and falls through to the regular form. The first call wins — `saving` disables both paths during the round trip.

### `useDocumentUpload` orchestration

`hooks/use-document-upload.ts` is the client-side pipeline. It exposes `start(file)`, `state`, and `reset()`. Subtle ordering inside `start` is load-bearing and worth describing in one place:

1. `crypto.randomUUID()` mints the document id client-side. The same id becomes the row PK *and* the `{documentId}` storage directory segment, which is what makes upload-before-row-insert safe.
2. `phase = "hashing"` — `computeContentHash(file)` runs on the original bytes. This is intentionally before any Canvas resize so the dedup index fires on byte-identical re-uploads even when the user has already tried once.
3. `checkDocumentDuplicateAction` short-circuits the pipeline. The modal's `duplicate` branch renders without ever touching storage.
4. `phase = "uploading"` — `processImage(file)` resizes to optimized + thumbnail; `uploadDocumentFiles(...)` writes both in parallel via the RLS-bound browser client.
5. `phase = "creating-row"` — `createPendingDocumentAction(...)` writes the row with `status='analyzing'` and `kind='nameplate'`. The kind may be demoted to `'photo'` by the analyze step.
6. `phase = "analyzing"` — `analyzeNameplateAction(...)` either returns the persisted row (with `ai_extraction` populated and `status='analyzed'`) or sets `status='failed'` and returns an error.
7. `phase = "matching"` — `findMatchingInventoryAction(...)` looks for existing inventory in the house with a matching name. Skipped for `not_useful` (no name to match against) and `delta` (delta-mode never matches; the inventory id is already known by the caller).
8. `phase = "done"` — terminal success. The modal moves into duplicate / review-new / not-useful based on what the hook surfaced.

Any throw lands in the catch and sets `phase = "error"` with the message. A `runningRef` prevents double-fire from React strict-mode effect re-runs or a rapid double-tap on Analyze. The hook owns no cleanup logic — the modal calls `cleanupDocumentAction` directly when the user retakes, cancels, or closes mid-flow, with the document id the hook published in state.

### Save and close paths

Two save paths exist:

- **Create new** — `createInventoryFromDocumentAction(...)` inserts a `hearth.inventory` row and attaches the document. Used by the "Save furnace" button in review-new (including the manual-entry variant).
- **Attach to existing** — `attachDocumentToInventoryAction(...)` attaches the document to an existing inventory row without creating a new one. Used by the match-banner's per-match buttons. No `acceptedFields` payload in phase 1.4 — the user picks an inventory item and the AI fields are not merged in this entry-point's UI. That payload is plumbed for the future inventory-detail "Add another photo" entry point.

Both fire `onSaved({ inventoryId })`. The modal then drops into the `success` stage for `SUCCESS_DISMISS_MS` (600ms — long enough to read "Saved!" and short enough not to feel like waiting) before calling `onOpenChange(false)`.

Close-mid-flow cleanup: the modal tracks the currently-displayed stage and the current document id in a ref. On close, if the stage is one where a row was created but not attached (`review-new`, `manual-entry`, `not-useful`, `analysis-failed`), it fires `cleanupDocumentAction` so the row and its storage objects don't linger. Duplicate doesn't need cleanup — the row we'd be removing belongs to the previous, legitimate upload. Path-picker / capture / processing close paths don't have a document id yet (or the in-flight upload's id never reached the database before close) — the hook's own `runningRef` and the modal's `reset()` on next open handle the in-memory cleanup, and any orphaned storage bytes from a half-completed upload land in the same future periodic sweep documented elsewhere.

### Refresh on save

`onSaved` calls `router.refresh()` from inside `TopNav` — the same pattern the home-details edit modal uses. `router.refresh()` re-runs server components without a full page reload, which means the dashboard's `InventoryPreview` server component re-queries `hearth.inventory` and the new item appears in the tile list automatically.

The home-details modal *also* dispatches the `HOUSE_UPDATED_EVENT` because `useHouseRealtime` is unreliable in some browsers (see "Cross-tree refresh signal" elsewhere in this guide). Smart Uploader does *not* dispatch a custom event because the dashboard's inventory tiles are server-rendered, not driven by a Realtime hook — a server-component re-render is the only signal the surface listens for, so `router.refresh()` is sufficient.

### Dashboard inventory tiles

`app/(app)/dashboard/inventory-preview.tsx` is the server component that renders the dashboard's inventory tile list. It replaces the dashboard's earlier hardcoded mock APPLIANCES array. Queries `hearth.inventory` filtered by `house_id` with a `PREVIEW_LIMIT` of 6 items in created-date-descending order. The accompanying tile renderer is co-located inline; it's only used here and pulling it into `components/ui.tsx` would be premature.

Hero photos: a follow-up query fetches every `hearth.documents` row with `status='attached'` and `inventory_id IN (...)` ordered by `analyzed_at desc`, then picks the most-recent per inventory id client-side. All the resulting thumbnail paths are signed in one `createSignedUrls` call against the `hearth-documents` bucket with a 1-hour TTL — long enough that the dashboard's signed URLs survive a typical browsing session, short enough that they're not effectively-permanent if logs ever pick them up. Items with no attached document get a type-based fallback icon (appliance → fridge, system → flame-burner, exterior → home).

The component handles the empty-inventory case inline with a soft hint pointing the user at the `+ Add` button. There is no separate `/documents` list page or per-inventory detail page in this phase — the tiles link to `/entities/[id]`, which is still the placeholder route from earlier work.

---

## Auth and routing

### Sign-in surfaces

- `/login` — public page with two paths: Supabase **magic-link OTP** (`signInWithOtp` → emailRedirectTo `/auth/confirm`) and **Google OAuth** (`signInWithOAuth` → redirectTo `/auth/callback`).
- `/auth/callback` — OAuth code exchange handler.
- `/auth/confirm` — OTP token verification handler.
- `/auth/signout` — POST route that calls `supabase.auth.signOut()`.

### Route protection: `proxy.ts` → `lib/supabase/proxy.ts`

The proxy runs on every non-static request and does three things in order:

1. **Refresh session** via `supabase.auth.getUser()`. Cookie reads/writes are mirrored into the response so the session stays warm across navigations.
2. **Auth gate**: if there is no user and the route is not public (`/`, `/login`, `/auth/*`), redirect to `/login`.
3. **Onboarding gate**: if there is a user, the route is protected, and the path is not `/onboarding`, run a `select id, count exact, head true` against `hearth.houses`. If the count is zero, redirect to `/onboarding`.

The onboarding gate adds one cheap COUNT query to every protected request. It's intentionally simple for now; revisit (cache, move to a layout, or set a flag on the user) if it shows up in perf work.

### Authenticated layout

The `app/(app)/layout.tsx` mounts a single `<AppShell>` (top nav, bottom nav on mobile, desktop sidebar) around every authenticated route. Onboarding lives inside this shell intentionally — the user is signed in, and the navigation chrome is the same surface they'll use after they finish.

---

## Onboarding flow

The first end-to-end data flow in the product: a signed-in user with no house lands on `/onboarding`, captures their address via Mapbox, and is redirected to `/dashboard`.

### Files

```
app/(app)/onboarding/
  page.tsx                  # Server component; double-checks house count, renders form
  address-form.tsx          # Client component; Mapbox AddressAutofill + confirmation
  actions.ts                # Server action: validates session, extracts, inserts, redirects
  extract-address.ts        # Pure helpers (extractCounty, extractAddress)
  extract-address.test.ts   # Vitest coverage of the pure helpers
```

### What runs where

- **`page.tsx`** (server) — Reads the current user, queries `hearth.houses` count. Redirects to `/login` if not signed in, `/dashboard` if a house already exists. Otherwise renders the hero text and mounts `<AddressForm>`.
- **`address-form.tsx`** (client) — Wraps a single street-address input in `<AddressAutofill>` from `@mapbox/search-js-react`. Hidden inputs for `address-level1/2`, `postal-code`, `country`, and `address-line2` are present so Mapbox can auto-populate them and the confirmation minimap can render full context. On user selection the full feature is stashed in component state. Submit is disabled until a feature is captured. On submit, `useConfirmAddress({ minimap: true, skipConfirmModal: high-confidence })` shows a modal with a minimap; the user can confirm or adjust. The (possibly adjusted) feature is then handed to the server action via `useTransition`.
- **`actions.ts`** (`"use server"`) — `createHouseFromMapboxFeature(feature)`. Verifies the session, calls `extractAddress(feature)`, inserts into `hearth.houses` with `owner_id = user.id` and `mapbox_raw = feature`. On Postgres unique-violation (code `23505`) the user already has this house — redirect to `/dashboard` rather than surface a SQL error. On success, `redirect("/dashboard")`. The `houses_seed_default_rooms` trigger seeds the 9 default rooms — no app code needed.
- **`extract-address.ts`** (pure) — `extractCounty(context)` finds the `district.*` entry, strips a trailing `" County"` (case-insensitive), and returns the bare name or null. `extractAddress(feature)` maps Mapbox properties onto our canonical column shape, including `[lng, lat]` → `(latitude, longitude)` reordering, and throws on missing required fields. Covered by `extract-address.test.ts`.

### Mapbox configuration

- Product: **Address Autofill** (not Search Box, not raw Geocoding). Session-based pricing — one onboarding equals one billable session regardless of keystrokes.
- Token: `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, set in Vercel and pulled locally via `vercel env pull`. URL-restricted to `http://localhost:3000`, `https://hearth.toddtech.llc`, and the Vercel preview wildcard.
- TypeScript note: `@mapbox/search-js-react@1.5` types `AddressAutofill`'s `children` as `React.ReactChild`, which was removed in `@types/react` v19. `address-form.tsx` re-types the component locally with `React.ReactNode` children to keep TSC happy. `@mapbox/search-js-core` is only a transitive dependency, so the retrieve-response shape is inlined rather than imported.

### Multi-house (intentionally not yet)

The schema supports it — `houses` is keyed by `owner_id` with a unique-per-Mapbox-id constraint. Onboarding is gated to "first house only" by the proxy redirect rule. When multi-house ships (premium feature) the gate will change to "redirect only if no houses exist and no explicit `?add=true` intent" or similar.

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

`components/app-shell.tsx` composes `TopNav`, `BottomNav`, and `DesktopSidebar` into the authenticated app frame, capped at `--content-max` (1200px) with safe-area-aware bottom padding for mobile nav. The `(app)` layout fetches the user's first house row once and passes it through `AppShell` to `TopNav` — both the address chip and the home-details edit modal read from that same snapshot, so opening the modal does not re-query.

`components/document-modal.tsx` provides the document-viewer modal and a `DocumentTrigger` to launch it. Body scroll-lock is handled via the `.scroll-locked` class in globals.css.

`components/edit-home-details-modal.tsx` is the only edit surface for the user's house facts. It is triggered from the top-nav account menu (no sidebar or bottom-nav entry) and writes directly to `hearth.houses` via the RLS-bound browser client. After a successful save it dispatches `hearth:house-updated` (see "Cross-tree refresh signal" below) so the dashboard hero refetches immediately, and also calls `router.refresh()` so the top-nav address — which is server-rendered — picks up the new value. Address fields are read-only (sourced from public records during onboarding); editable fields are `year_built`, `living_area_sqft`, `lot_size_sqft`, `bedrooms`, `bathrooms`, and `purchase_date`. Modal mechanics (scroll-lock, focus trap, ESC, backdrop close, return focus) match `HabitatFindingModal`.

### Cross-tree refresh signal

`useHouseRealtime` is the dashboard's live data source for a single house row. Realtime UPDATE broadcasts are the primary path, with a polling fallback that's only active while `briefing_status` is non-terminal. When realtime is blocked at the browser layer (extensions, tracking-prevention — see "Realtime and the browser" below) and briefing has already completed, the hook would otherwise go silent for any subsequent write.

To stay robust against that, write paths inside `DashboardLive`'s subtree (photo upload/remove, regenerate-image, refresh-briefing) call `refetch()` directly after they finish — the hook is in scope. Write paths *outside* the subtree (today: the home-details edit modal mounted under `TopNav`) instead dispatch the `HOUSE_UPDATED_EVENT` (`hearth:house-updated`) custom event via the `dispatchHouseUpdated(houseId)` helper exported from `lib/hooks/use-house-realtime.ts`. The hook listens for that event and calls `refetch()` when the `houseId` matches. The event is idempotent against Realtime — if both fire, the second update is a no-op.

Any future house-mutating UI that's not a descendant of `DashboardLive` should dispatch this event after its write completes, instead of trying to plumb the hook's `refetch` through a context.

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
- **`app/(app)/dashboard/actions.ts`** — `refreshBriefing(houseId)` is the server action behind the dashboard's Refresh affordance. It verifies the session, confirms the house exists for the signed-in user (RLS is the load-bearing check; the explicit lookup gives a clean error message), short-circuits if `briefing_status` is already `running`, and calls `start(runBriefing, [houseId])`. The client component disables its button while the action is pending and while the realtime row reports a non-terminal status, so double-starts are guarded both client- and server-side.
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
- **First-run preconditions** (both must be true): `houses.briefing_generated_at IS NULL` or `briefing_status` is `pending`/`running`, AND no `habitat_findings` rows exist with `status = 'completed'` for this house. Once either flips false, the modal is gone for good — no schema column tracks "dismissed," because the data conditions already do.
- **sessionStorage** is a re-mount safety net keyed by `houseId` (`onboardingDiscoveryDismissed:<id> = "1"`), so a fast nav back to the dashboard immediately after dismissal doesn't briefly flash the modal back open while the habitat read catches up. It is not the source of truth.
- **Sequencing is visual only.** The briefing and habitat workflows are already running in parallel — the modal just waits for each piece of data to land and paces the reveal. A short `RESULT_DISPLAY_MIN_MS` keeps fast modules (radon resolves sub-millisecond) on screen long enough to read.
- **The Refresh button on the dashboard does not re-open the modal.** Once any habitat module has completed once, the preconditions are false; the existing inline-skeleton flow takes over for re-runs.

### `HabitatModule.getOnboardingMessage`

The modal's per-module result line is authored by each module via an optional `getOnboardingMessage(finding) => string` on the `HabitatModule` contract (`lib/habitat/types.ts`). The string should lead with what was found, not what was checked, because the modal already renders "Checking <module.name>…" before this fires. Modules that don't implement it get a generic "Checked <name> for your area" fallback. The radon module's implementation lives alongside its `check()` in `lib/habitat/modules/epa-radon-zone/index.ts` and branches three ways on zone — Zone 1 leads with concern, Zone 2 with moderate, Zone 3 with positive framing. Unit-tested in `index.test.ts`.

### Briefing message helper

`lib/briefing/getBriefingMessage.ts` is the pure helper that turns a persisted house row into the modal's briefing-result line ("Found your home data — built in 1934, 2,210 sq ft, 3 bed / 3 bath"). Degrades gracefully when individual fields are null and falls back to "Looked up your home's public records" when nothing concrete came back. The function is unit-tested across field-presence permutations in `getBriefingMessage.test.ts`. It's not persisted — the modal computes the string client-side from the realtime row at the moment of transition into the result phase.

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
  └─▶ start(runHabitatChecks, [houseId])
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
- **`lib/house-image/signed-url.ts`** — `createCachedSignedUrl(supabase, bucket, path, stamp)` issues a signed URL for either house-image bucket and caches the resulting URL string in `sessionStorage` keyed by `(bucket, path, stamp)`. The cache is what gives the browser a stable URL across navigations — without it, a remount of the dashboard would mint a fresh signed URL on every visit, and the browser's HTTP cache (which keys on URL) would miss the previous bytes. The signed URL TTL is 7 days; cache entries expire at 90% of that. The module also exports `HOUSE_IMAGE_CACHE_CONTROL = "31536000, immutable"`, used as the `cacheControl` on every upload so the bytes themselves are forever-cacheable behind the stable URL.
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

Footer behaviour follows the pane: in the overview the "View source" link points to the row's `source_url`; in the detail pane it points to the active card's `sourceUrl` (with the row's `source_url` as fallback when a card doesn't provide one). Activity log stays in overview — the log narrates module-wide reasoning, not per-item context. Per-item reasoning lives inside whatever the module renders in its detail pane (Superfund's "Why this severity" disclosure is the reference example).

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

### Public methodology page — `/how-it-works`

The `/how-it-works` route at `app/how-it-works/page.tsx` is Hearth's public-facing methodology document. Each habitat module's classification logic — the table that maps raw data into a Hearth severity — is documented there alongside the upstream sources and any model-vs-authority note where Hearth's interpretation diverges from the original publisher. Every habitat finding's activity log cites this page from its `decide` (and, for Superfund, `rule`) step.

The page is reachable without authentication so the transparency layer works for both signed-in users clicking through from a finding and anonymous direct hits. Public-route exception is configured in `lib/supabase/proxy.ts`.

Anchor IDs on the page (`#radon`, `#superfund`, `#flood-zones`) are load-bearing — they're embedded verbatim in the `activity_log` JSONB of every existing `habitat_findings` row, frozen-in-time. The slug version of the module key (without the `epa_` or `fema_` source prefix) is the convention for future modules. Old findings persisted with the prior `/about/classification#<anchor>` URL still resolve via a permanent redirect rule in `next.config.ts`; browsers carry the anchor through the redirect automatically, so no per-anchor rules are needed.

**Governance principle (load-bearing).** Modifying a habitat module's classification logic without updating its corresponding section in `/how-it-works` is a regression. The page is Hearth's public methodology, and the activity log on every finding tells users they can read this page to understand how the finding was produced. If the page is out of date with the code, users get inaccurate transparency, which is worse than no transparency at all. Module PRs that change classification thresholds, severity mappings, or data sources must include corresponding edits to `app/how-it-works/page.tsx` and update the "Last updated" date for that module's section.

### `HabitatModule.iconImage`

Each module may declare an optional `iconImage` (a root-relative path under `/public`). When present, the dashboard's compact tile renders it as a 72px square hero on the left of the tile. Module definitions stay serializable — we use string paths, not imported asset modules. Module hero images live under `public/habitat_module_images/` (e.g. `radon.jpg`).

### EPA Superfund Proximity module

The second shipping habitat module (`lib/habitat/modules/epa-superfund-proximity/`). It hits EPA Envirofacts SEMS at [`https://data.epa.gov/efservice/sems.envirofacts_site/...`](https://www.epa.gov/enviro/envirofacts-data-service-api) to pull every NPL-relevant Superfund site in the house's state (left-joined to `sems.envirofacts_contaminants`), measures haversine distance from the home to each site's EPA-provided point, and applies a three-tier proximity model based on EPA's standard 1- and 3-mile community-impact rings:

- **Tier 1** (≤ 0.5 mi) includes any NPL status — Final (F), Proposed (P), Part of NPL site (A), or Deleted (D).
- **Tier 2** (0.5–2 mi) includes only F and P.
- **Tier 3** (2–5 mi) includes only F.

Severity maps from tier + NPL status: Tier 1 + F/P → `concern`; Tier 1 + A/D → `caution`; Tier 2 + F/P → `caution`; Tier 3 + F → `neutral`; zero qualifying sites within 5 mi → `favorable`. The top-level finding severity is the worst across qualifying sites; `findings.sites` is sorted severity-desc then distance-asc.

Cadence is `yearly` — the NPL list and statuses do change but slowly. There is intentionally no caching layer in MVP: the module fetches EPA every time `check()` runs. At single-digit beta volume the per-onboard latency cost is acceptable, and the `habitat_sites` cache table has been deliberately tabled past MVP. The finding payload uses a `{ site, context }` per-entry shape (place-in-the-world facts vs per-house relationship) so a future cache migration is mechanical.

Three EPA quirks the module handles explicitly. (1) Many sites arrive with `null` coordinates and are filtered out before any distance math, with the dropped count surfaced in the activity log. (2) Every text field arrives ALL CAPS, so site names, addresses, and contaminants flow through a `titleCase()` helper that preserves initialisms like `LLC`, `DOT`, `USN`, `PCB`, renders business suffixes like `INC` as `Inc.`, and collapses spaced hyphens (EPA returns `"GEORGIA - PACIFIC CORPORATION"` with surrounding spaces; the module renders it as `Georgia-Pacific Corporation`). (3) The joined `sems.envirofacts_contaminants` table exposes its contaminant in the `preferred_contaminant_name` column — *not* `contaminant_name`. The site's own `name` rides along on every joined row, and an earlier implementation that fell back to `name` reported the site's own name as its contaminant; the picker now reads only `preferred_contaminant_name` (with `contaminant_name` as a defensive fallback against future schema renames).

Some SEMS records aggregate multiple physical locations into one row (Allied Paper, Inc./Portage Creek/Kalamazoo River is the canonical example — a single record covering 80 miles of river and several landfills). The module flags those at qualification time: a site whose `name_original` contains a `/` gets a `precision_note` string on its `findings.sites[].context`, and when at least one qualifying site carries the caveat, the activity log gains a conditional `compute` step between the distance and the tier-filter steps that names the flagged sites. Single-location-only result sets leave the log at 6 steps and produce no `precision_note` fields. Polygon-edge distance and cleanup-milestone enrichment from `sems.envirofacts_site_milestone` are deliberate v2 deferrals.

The tier model is Hearth's, not EPA's. The activity log's `rule` step cites our own `/how-it-works#superfund` page rather than `epa.gov/superfund` — EPA's published guidance uses 1- and 3-mile rings in community-involvement work, but does not publish a "community-impact rings" standard. Citing it as if it did would overstate provenance.

The Superfund module is also the first consumer of the modal's slotted shell (see "Tile + trigger + modal" above). It implements `getOverviewCards(row)` to return one card per qualifying site — eyebrow is `Tier N · D mi BEARING`, headline is `name_display`, subtitle is `address.street · npl_status.label`, severity is the per-site severity, and `sourceUrl` is the EPA Cumulis profile URL. It implements `renderDetail(row, cardId)` to mount `lib/habitat/modules/epa-superfund-proximity/components/site-detail.tsx`, which keeps the module-specific UI co-located with the module rather than leaking into the shared modal. The detail body lays out: site name + metadata pills (NPL status, distance/bearing, tier, severity word); an address card whose right column is a quick-facts block (NPL listing, Site status, EPA Region, and — only when true — Federal facility) and whose left column carries the street address plus a link to the EPA profile; the `precision_note` block when present; the contaminants list (see "Canonical contaminants table" below); and a "Why this severity" `<details>` disclosure. `index.ts` stays a `.ts` file by passing the component through `createElement` rather than JSX — the SiteDetail component is the only place in this module that imports React JSX. Per-site payload shapes live in `./types.ts` so `index.ts` and `site-detail.tsx` can both consume them without forming an import cycle.

The persisted per-site shape (`findings.sites[].site`) carries two SEMS fields that aren't surfaced anywhere else in the module: `archived_date` (the EPA-supplied ISO date string, present only when `archived` is true) and `epa_region_code` (the zero-padded region code, e.g. `"05"`). Both arrive from `SemsSiteRow` and are passed through verbatim; the display layer parses them via `formatArchivedDate` and `formatEpaRegion` in [`format.ts`](../lib/habitat/modules/epa-superfund-proximity/format.ts). Both fields are nullable on the row contract and absent on rows persisted before the quick-facts block landed — the display component renders gracefully in either case (Site status falls back to bare `"Archived"` without a date, and the EPA Region row is omitted entirely). Rows backfill naturally on the next yearly cadence run; no migration is needed.

### Canonical contaminants table

`lib/habitat/contaminants/data.ts` is the single source of truth for how Hearth talks about chemical contaminants — canonical spelling, observed EPA aliases, three-stop concern level (`high` / `moderate` / `low`), one short Hearth-voice description, and an authoritative EPA / ATSDR link per entry. `lib/habitat/contaminants/lookup.ts` exposes `findContaminantByAlias(raw)`, the case-insensitive whitespace-trimmed resolver against the aliases lists. The Superfund detail pane consumes the table to render enriched contaminant rows: high-concern entries bold, moderate normal weight, low muted, each with description and "Learn more" link. Unknown EPA strings fall through to a grouped "Other contaminants detected" section that renders the raw (chemistry-aware-formatted) string with no enrichment. A site with an empty `contaminants` array — Georgia-Pacific's Cumulis record is the canonical example — gets explanatory copy noting that EPA hasn't published an inventory for that site rather than an empty section. Future modules (water-system violations, soil testing) consume the same table; the source of truth never gets duplicated into individual modules.

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

### `HabitatModule.category`

`HabitatModule.category` is a required field (currently the union `"environmental"`, expandable as new module families ship). The orchestrator writes `category: module.category` into the `running`, `failed`, and `completed` upserts on `hearth.habitat_findings`. The column was added by `supabase/migrations/20260517171126_habitat-findings-module-changes.sql` for dashboard grouping; the migration backfilled existing rows but did not wire the orchestrator, so the field stayed null for new rows until the orchestrator started persisting it.

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Per-inventory hero column**. `inventory.hero_photo_path` exists in the schema for per-appliance / per-room hero images. The dashboard's inventory tiles now derive a hero from the most-recent attached document's thumbnail (via `InventoryPreview`), so the explicit `hero_photo_path` column is unused for now; promote when a user wants to *pin* a specific photo as the hero independent of upload chronology.
- **Public-records sources beyond EPA radon, EPA Superfund proximity, and FEMA flood zones** — BS&A assessor data, lead-disclosure heuristics, water-system violations, etc. Each is a new habitat module under `lib/habitat/modules/<key>/`; the orchestrator already iterates the registry, so adding a module is a contained change. The finding detail modal renders these out of the box from the generic `HabitatFinding` shape; richer per-module structured content (flood-history timeline, soil testing panels, etc.) is deferred until a module forces a slotted-shell contract.
- **Description synthesis** — for v1 we show `description_source` (Zillow's raw copy) as `description`. A future LLM step will rewrite `description` in Hearth's voice while leaving `description_source` intact.
- **Multi-house** UI. Schema supports it; onboarding gate currently locks to one house per user.
- **Inventory CRUD**. Schema exists; the Smart Uploader (#51) covers the create path through photo capture, and the new `/inventory/[id]` detail route (#53) covers the read path with hero photo, structured pills, and the Research panel. The `/appliances`, `/entities/[id]` (legacy placeholder), and `/documents/[id]` routes are still placeholder shells. Edit and delete flows are not built yet — the detail page is read-only in this phase.
- **OCR + extraction routing for non-nameplate documents** (receipts, manuals, permits, invoices) — the `kind` discriminator and Grok pipeline are in place from phase 1.3, but the Smart Uploader only writes `nameplate` / `photo` today. The disabled "Document or receipt" and "Emergency procedure video" entries on the path-picker exist as the future surface for those flows.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --linked` (against the remote-linked project) is wired into the workflow, it'll replace the hand-typed row.
