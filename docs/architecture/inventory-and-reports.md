# Inventory and reports

The inventory detail page — where structured pills, AI Insights, photo / receipt galleries, and the edit/delete + property surfaces all live — plus the custom date and month pickers used inside the edit modal, and the Reports hub UI mockup.

Read this spoke when working on inventory detail rendering, the edit/delete modal, the property subtype (vehicles, pets), the date pickers, or the Reports page.

The serial-number decode pipeline that pairs with the Research panel lives in [ingestion.md](ingestion.md#serial-number-decode-pipeline). The Smart Uploader that fronts inventory creation, the dashboard inventory tile list, and the home inventory list page also live in [ingestion.md](ingestion.md#smart-uploader-modal-and-dashboard-wiring).

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

- **`prompt.ts`** — two builders. `buildResearchSystemPrompt()` returns the general framing that applies to every call (grounding definition, honesty rules, output structure, the 300–500 char target with a 1200-char hard ceiling, and an explicit instruction *not* to decode the serial number — that lives in a separate pipeline, see [ingestion.md → Serial-number decode pipeline](ingestion.md#serial-number-decode-pipeline)); `buildResearchUserMessage(input)` returns the per-item ask, embedding the item's known data (type / name / manufacturer / model_number / serial_number / notes) and three numbered asks — one per output section. Splitting system from user message gave the model an explicit cadence to follow; the earlier single-string prompt with a thin user message produced responses that populated only the first ask. Pills are intentionally **not** included in the user message — they tended to be noisy (every BTU rating, every voltage spec) and didn't materially improve output quality, so the prompt stays lean.
- **`prompt.test.ts`** — covers field-presence permutations on the user message and load-bearing system-prompt content (output field names, "return null for that section" honesty rule, character caps).
- **`research.ts`** — narrow on purpose. Exports `insightsSchema` (the Zod schema both the route and the client's `useObject` hook validate against) and `getInventoryInsightsModel()` (env-driven selector). The schema's three content sections (`overview` / `service_life` / `maintenance`) are independently nullable with `.min(1)` on each — empty string is invalid, so the only way to skip a section is `null`, which forces the model into a binary "I have something grounded" decision per section. `source_urls` uses `z.string().refine(...)` rather than `z.string().url()` because Zod's `.url()` emits `"format": "uri"` in the generated JSON schema, which OpenAI's structured-outputs subset rejects — refine keeps the runtime URL validation without putting `format` in the schema sent to the model.
- **`research.test.ts`** — covers schema's null-vs-empty-string semantics, the per-section length cap, the missing-key vs explicit-null distinction (Zod requires the field present even when null), and the URL refine behaviour.

The route handler at `app/api/inventory/[id]/research/route.ts` is the only caller. It authenticates via `createClient()` (cookie-based Supabase session), loads the inventory row (RLS-scoped through `hearth.houses.owner_id`), composes the prompts, and calls `streamObject({ model, schema, system, messages, onFinish })`. The stream is piped to the client via `result.toTextStreamResponse()`; `onFinish` runs server-side once the model finishes and writes the structured result (headline + three nullable sections + provenance fields) into `ai_insights`, calls `revalidatePath` so any future SSR reflects the new data, and appends a debug entry to `logs/ai-insights-prompts.log` (gitignored — see "AI Insights debug log" below).

**Streaming, not blocking.** The earlier `researchInventoryModelAction` server action returned the full result after a 20–60s wait; the streaming route returns the response body as soon as the model emits its first token (typically 1–3s for the headline). The client's `useObject` hook reads partial-object updates from the stream and the panel populates field-by-field — headline first, then `overview`, then `service_life`, then `maintenance`. The user is reading content within seconds instead of staring at a spinner.

**Navigation-away trade-off.** Both the streaming call and the DB write live inside the request lifecycle. Vercel Fluid Compute propagates client cancellation to the function, so if the user closes the tab mid-stream the call is killed and `onFinish` never fires — the partial result is discarded and nothing is persisted. Re-clicking from a fresh page load re-runs cleanly. A fully decoupled implementation (Phase 2) would lift the call into Vercel Workflow (see [`workflows/briefing.ts`](../../workflows/briefing.ts) for the pattern), which runs to completion regardless of connection state. Phase 2 is deferred until there's a use case beyond single-click-per-item — e.g. "research all unprocessed items" or auto-research at OCR ingest time.

### On-demand, not auto

Research runs only when the user clicks the Research button. We deliberately did not auto-run on inventory creation: the prompt is still evolving, the model choice may change, and burning Gateway credits on every new row before we know the output is what we want would be wasteful. Auto-running on save is a future enhancement; the column shape supports it (regeneratable) so we won't have to re-shape data when it lands.

### The `"unknown"` model_number convention

Items captured without a model number on the label (radon systems, custom-built equipment, generic exterior assets) would otherwise be locked out of the Research lookup forever — `canResearch` is gated on `manufacturer && model_number`, and the AI prompt has plenty to ground on even when the specific model is missing. To resolve this without weakening the gate, the project writes the literal sentinel string `"unknown"` (lowercase) to `hearth.inventory.model_number` whenever the user-submitted value is null or empty.

The substitution is owned by [`lib/inventory/model-number.ts`](../../lib/inventory/model-number.ts) — `normalizeModelNumberForCreate(value)` runs server-side inside [`createInventoryFromDocumentAction`](../../app/actions/documents/create-inventory-from-document.ts) before the row insert. The Smart Uploader review stage does **not** pre-fill the user-visible input with `"unknown"` — the displayed UI stays honest about what the photo captured, and the sentinel only appears in the persisted row.

Display surfaces filter the sentinel back out via `displayModelNumber(value)` from the same module, which returns `null` for the sentinel (case-insensitive, whitespace-tolerant — `"unknown"`, `"Unknown"`, `"  UNKNOWN  "` all collapse). Three surfaces combine manufacturer + model_number into an item identifier and all use this helper:

- The detail page title at [`inventory-detail-view.tsx`](../../app/(app)/inventory/[id]/inventory-detail-view.tsx) — falls back to `item.name` when the model is the sentinel.
- The dashboard inventory tile meta line at [`dashboard/inventory-preview.tsx`](../../app/(app)/dashboard/inventory-preview.tsx) — falls through to the manufacturer-only branch.
- The home inventory list detail line at [`inventory/page.tsx`](../../app/(app)/inventory/page.tsx) — same manufacturer-only fall-through.

The convention is **create-time only**. The edit modal does not re-normalize on update — if a user explicitly clears the model field after creation, that's respected, and they'll see the Research gate re-engage. They can re-type `"unknown"` themselves if they want it unblocked again. No backfill of legacy null model_number rows; those continue to render `item.name` as the title since the truthy check already handles the null case.

### Detail page surfaces

- **Hero photo + lightbox** — the server component fetches every `hearth.documents` row with `status='attached'` and `kind IN ('nameplate', 'photo')` for the inventory item, ordered `analyzed_at desc nullsLast, created_at desc`, and passes the full set as `photos: { id, storagePath, thumbnailPath }[]` to `InventoryDetailView`. When `inventory.hero_document_id` is non-null the server reorders the array so that document lands at index 0 — every read site (the hero `<button>`, the lightbox, the modal's photo strip) keeps the simple "`photos[0]` is the hero" contract, so nothing downstream needs to know about the new column. The hero slot renders `photos[0].thumbnailPath` (600px — the same asset the dashboard tile already cached, so the cross-surface navigation typically resolves from sessionStorage). The hero is wrapped in a `<button>` with a `zoom-in` cursor and a small "N" badge in the corner when more than one photo exists; clicking it mounts the `<PhotoLightbox>` defined in [`photo-lightbox.tsx`](../../app/(app)/inventory/[id]/photo-lightbox.tsx) at slide index 0. The lightbox wraps `yet-another-react-lightbox` (which owns keyboard nav, swipe gestures, and focus management), signs the 1920px `storage_path` for every slide on open through `createCachedSignedUrl`, and themes the chrome via the library's `--yarl__*` CSS custom properties to match Hearth's surfaces. The Counter plugin shows "N of M" only when more than one slide exists. While a known-present photo's URL is still resolving on a cache miss, a neutral skeleton occupies the slot so the "Add photo" placeholder never briefly flashes for an item that already has one. The dashboard inventory tile and the `/inventory` list also honour `hero_document_id` when present, falling back to the most-recent rule otherwise — the same fall-through fires automatically when the FK is `SET NULL`'d after the chosen photo is deleted.
- **Stat tiles** (Installed / Last Serviced / Next Due) always render all three. Tiles with no underlying date show "Unknown" in tertiary text and drop the relative-time meta line. Layout stays stable across items, and the field is discoverable for the future edit-from-detail flow. The first tile has a fallback rule that swaps its eyebrow to **Manufactured** and shows the decoded manufacture date when `installed_on` is null and the serial-decode pipeline has landed a high-confidence date — see [ingestion.md → Serial-number decode pipeline](ingestion.md#serial-number-decode-pipeline) for the selector logic and the precision-to-display formatting.
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

`EditInventoryItemModal` reuses the conventions of [`EditHomeDetailsModal`](../../components/edit-home-details-modal.tsx) — scroll-lock, focus-trap, ESC, return-focus, the `surface-ai` shell, the `FieldText` / `FieldSelect` helpers, and the shared `<DatePicker>` and `<MonthPicker>` components for any date input (see "Custom date and month pickers" further down). The parent (`inventory-detail-view.tsx`) mounts the modal **conditionally on `editOpen`** rather than mounting it permanently and gating with the `open` prop. This is the deliberate alternative to a reset-in-effect: every reopen is a fresh React mount, so `useState(initial)` re-initializes from the latest `item` snapshot without tripping `react-hooks/set-state-in-effect`. The same conditional-mount discipline applies to the nested delete-confirm modal — it mounts only while `deleteOpen` is true, so the "Also delete linked documents" checkbox is freshly defaulted to checked on every open.

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

In addition to the inventory row, [`/inventory/[id]/page.tsx`](../../app/(app)/inventory/[id]/page.tsx) fetches the house's rooms (`id, name`, ordered by `sort_order`) for the Room select, a `count: 'exact', head: true` query on `hearth.documents` filtered by `inventory_id` for the cascade-checkbox copy ("Also delete N linked documents"), and the photo list (the same `documents` query the hero / lightbox use, now selecting `id` alongside `storage_path` / `thumbnail_path` so the modal can persist a chosen hero). All three queries fan out in `Promise.all` alongside the single-item load — no client-side fetching shim added.

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

The classify-and-extract prompt at [`lib/documents/ai/prompt.ts`](../../lib/documents/ai/prompt.ts) treats `property` as a fourth valid `type` value, with explicit guidance: vehicles photographed at the VIN plate or the car badge land as `type='property'` with `subtype='vehicle'` and the VIN in `serial_number`; pets photographed as identifying documents (vet records, microchip cards, registrations) land as `subtype='pet'`. Generic property (TV nameplate, computer service tag, stereo back panel) stays `subtype=null`. The Zod schema at [`lib/documents/ai/schema.ts`](../../lib/documents/ai/schema.ts) carries the `subtype` field on every classification branch — required, nullable.

The Smart Uploader's review stage extends the Type select with a "Property" option and reveals a "Property kind" sub-select when property is chosen. The review stage save flow passes `subtype` into `createInventoryFromDocumentAction`; the action defensively coerces `subtype` to null whenever `type !== 'property'` so stale UI state can't produce semantically-wrong rows.

The room-fallback table at [`components/smart-uploader/match-room.ts`](../../components/smart-uploader/match-room.ts) maps `property → Garage`. That's a deliberate vehicle-leaning default — the VIN is the most VIN-shaped photo a homeowner is likely to capture first, and a vehicle in the Garage is the unsurprising place to find it. A pet or TV will land there too; the user can pick a different room from the dropdown.

### Detail page rendering

The inventory detail page at [`app/(app)/inventory/[id]/inventory-detail-view.tsx`](../../app/(app)/inventory/[id]/inventory-detail-view.tsx) is type-aware:

- **Breadcrumb / eyebrow.** Property rows show "Property" in the breadcrumb; the eyebrow above the title shows the subtype word (Vehicle / Pet) when one is set, falling back to "Property" otherwise.
- **Title.** Non-vehicles still use the existing Manufacturer + Model display rule. Vehicles use the row's `name` as the title — for a Toyota Land Cruiser the name is already "Toyota Land Cruiser" and synthesizing "Toyota Land Cruiser" again from Manufacturer + Model would just duplicate it.
- **StatTiles.** Property rows drop the Last serviced / Next due / Installed tiles (none apply) and replace them with Purchased / Estimated value / [Model year for vehicles | Acquired for pets]. The "Manufactured" decode fallback is also dropped for property — the model year for a vehicle lives in `metadata.model_year`, not the manufacture-date pipeline.
- **PillCluster.** For vehicles the existing serial-number pill is relabeled "VIN" and a second `[state] Plate · [plate]` chip surfaces when plate metadata is set. For pets and generic property the pill cluster works exactly as before.
- **PropertyDetailsBlock.** A new component below the pill cluster surfaces subtype-specific content. For vehicles it carries the "Decode VIN" button (with re-decode affordance after a successful decode) and the decoded NHTSA facts (body class, engine cylinders, fuel, drive, country of manufacture) as chips. For pets it surfaces a chip cluster of species/breed/color/sex/microchip/vet.
- **Research panel.** Replaced for property with a `PropertyInsightsPlaceholder` that explains depreciation / replacement-value (for vehicles), the dedicated pet experience (for pets), or generic property follow-ups are on the roadmap. The "Research this model" lookup is tuned for appliances and systems and doesn't apply to property today.

### VIN decode pipeline

The "Decode VIN" action on a vehicle posts to [`/api/inventory/[id]/decode-vin`](../../app/api/inventory/[id]/decode-vin/route.ts). The route is deterministic — no LLM, no API key, no model selection — it just calls NHTSA's free DecodeVinValues endpoint at `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json` and writes the trimmed result into the row.

**Endpoint choice is load-bearing.** NHTSA has two siblings: `/DecodeVin/` returns `Results: [{ Variable, Value }, ...]` where `Variable` is the human-readable label ("Model Year" with a space). `/DecodeVinValues/` returns `Results: [{ flat camelCase object }]` where keys are `ModelYear`, `EngineCylinders`, etc. Hearth uses the values endpoint so the field names are self-consistent end-to-end. The first cut of this code used the labelled endpoint with camelCase field names; Make and Model worked (single-word labels match either shape) but ModelYear silently fell through because the underlying Variable was "Model Year" with a space. Don't switch back.

The module at [`lib/vin-decode/decode.ts`](../../lib/vin-decode/decode.ts) owns the wire format and parsing:

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

The date picker wraps [`react-day-picker`](https://react-day-picker.dev) v10 in single-selection mode with the displayed month controlled externally (`month` + `onMonthChange`) and a custom `MonthCaption` component that renders the month name alongside a `<YearSelect>` chip. `startMonth` / `endMonth` are bounded to 100 years back / 10 years forward from today, which is also the range the YearSelect uses. The library's own stylesheet is **not imported** — the `.rdp-*` classes the library emits are styled from scratch in [app/globals.css](../../app/globals.css) so the day grid, navigation chevrons, weekday headers, today indicator, and selected-day fill all match Hearth's palette. The selected day uses `var(--color-accent)` as a solid fill; today (when not selected) gets an inset accent-tinted ring; out-of-month cells are dimmed.

The custom caption skips react-day-picker's `captionLayout="dropdown"` mode on purpose — that mode uses native `<select>` elements whose popups (a) ignored the document's dark color-scheme on older Chromium builds and rendered white-on-everything, (b) couldn't be padded or sized, and (c) showed all 110 years in a skinny full-viewport column. The `<YearSelect>` chip uses the same trigger styling the native dropdown would have had but opens a custom Hearth-themed list (see "YearSelect" below).

Local-time conversion is owned in `date-picker.tsx` so a `new Date("2025-10-24")`-style UTC parse doesn't cause display dates to shift back a day in negative-UTC time zones. The picker speaks `YYYY-MM-DD` strings via `dateFromIso` / `isoFromDate` helpers that use local-time accessors (`getFullYear`, `getMonth`, `getDate`).

Two footer affordances live below the day grid: **Clear** (writes `""` and closes) and **Today** (selects today and closes). Both are styled as accent-colored text buttons via `.picker-popover-link`.

### MonthPicker

The month picker is custom (no library). The popup is a year header — `◀ 2026 ▼ ▶` — above a 4×3 grid of month cells (`Jan` through `Dec`). The center element is the same `<YearSelect>` chip the date picker uses; the flanking chevrons handle ±1 year nav with `disabled` states at the bounds. Same 100-back / 10-forward year range as the date picker. Selected month cells fill with the accent; today's month-year combination gets the same inset accent ring as today's day in the date picker; hover/focus on any cell brightens it with the accent-tinted background mix the rest of the surface-ai surfaces use.

### YearSelect

`<YearSelect>` ([year-select.tsx](../../components/year-select.tsx)) is the shared year picker used inside both the date picker's custom caption and the month picker's header. Trigger is a chip showing the current year + chevron-down; clicking it opens a 92px-wide, 240px-tall list of years (descending — recent on top) anchored below the trigger. The selected year is auto-scrolled into view on open and receives focus so keyboard users can navigate immediately.

Two ownership decisions that matter:

- **Close mechanics live in YearSelect, not PickerPopover.** The component owns its own outside-click and ESC handlers and does **not** `stopPropagation`. If the click was inside the calendar popover (but outside the year list), only the year list closes. If the click was outside the calendar popover entirely, the YearSelect closes here and the popover's own overlay handler still fires to close the calendar — the natural cascade.
- **The list renders as an absolute child of the popover card, not a portal.** The `surface-ai` card it lives in doesn't clip, so portal-mounting would add complexity for no gain. The list's `position: absolute` + `top: calc(100% + 4px)` sits right under the trigger.

`parseValue` accepts the three legacy shapes from the manufacture-date pipeline: `YYYY-MM` (preferred, exact), `YYYY` (decoded values from the serial-decode pipeline — rendered as January of that year), and anything else (notably ISO `YYYY-Www`) as no selection. `onChange` always emits a canonical `YYYY-MM` string, or `""` when cleared. The year header is initialized from the selected year (or the current year if no value) on every open, so prior navigation on one open doesn't bleed into the next.

Footer affordances mirror the date picker: **Clear** and **This month** (which writes the current calendar month and closes).

### Why custom over the native widgets

The native `<input type="date">` / `<input type="month">` popup is a Chromium dialog — `accent-color` reaches some selection cells but the popup's panel chrome (square corners, system font, panel background, "This month" link color) is fundamentally not stylable from CSS. The shim in `globals.css` that tried to invert the calendar-picker-indicator icon and tint the accent was the proof of what *isn't* achievable with the native widget. Replacing the widget entirely is the only path to a popup that visually matches the rest of the surface — and once the popup is custom anyway, the trigger becomes a styled button instead of a faux-input, which sidesteps the empty-state "dashes" problem the month input has on Chromium without needing the CSS overlay trick #105 introduced.

The `react-day-picker` dependency is the only third-party UI dep added by this work. The month picker is intentionally custom: a 4×3 grid of buttons doesn't need a library's worth of abstraction, and keeping it in-house means we own the visual contract for the most-touched picker in the inventory edit flow.

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

**Deliberately not yet present.** Per-report generation engines for every card *except* the Water Quality Report (see below), premium / free tier gating, analytics, distribution flows (email, share links). Each is its own focused project tracked outside this issue.

## The Hearth Reporting pipeline (`lib/reports/`)

Issue #207 made the first card real and, with it, built the **shared PDF-rendering primitive** every future report inherits. The pipeline is deliberately report-type-agnostic — nothing water-specific lives in the shared layer.

- **`lib/reports/theme.ts`** — the shared print theme + document shell. `buildReportDocument({ title, address, bodyHtml, templateCss })` wraps a template's page-composition HTML in a full standalone document: a **white print palette** built from Hearth's warm light-theme tokens (the report is printed and forwarded, so it uses a white background with minimal ink rather than the app's dark mode, while staying recognizably Hearth), the three fonts pulled from Google Fonts via `@import` (Chromium renders outside Next's font pipeline), `@page` geometry (Letter, an oversized bottom margin to reserve the footer band), and the **running attribution footer**. `REPORT_COLORS` exports the palette for templates.
- **Running attribution footer (shared, every page).** A single muted line — `Hearth — Home Awareness · Generated for {address} · Powered by ToddTech` — rendered via Puppeteer's **native footer** (`displayHeaderFooter` + `footerTemplate`, built by `buildReportFooterTemplate`). This is the only mechanism that reserves space on every page: a CSS `position: fixed` footer is content-box-relative in Chromium's paged mode and flowing content paints behind it (there's no per-page CSS space reservation), which caused a real overlap bug. The native footer renders inside the reserved bottom page margin (set via the renderer's `margin.bottom`), so it never collides with content no matter how far the matrix overflows. Tradeoff: the native footer is a separate render context (inline styles, generic `monospace`, and its `<a>` isn't a guaranteed-clickable annotation), so a **guaranteed-clickable** "Powered by ToddTech" link also rides once in the document body (`inFlowCredit` in `buildReportDocument`); the per-page footer carries the same brand text so the soft-referral survives page separation regardless. Constants in `lib/reports/constants.ts`.
- **`lib/reports/render.ts`** — `renderReportPdf(html)`. Headless Chromium via `@sparticuz/chromium` + `puppeteer-core`. Dual launch path: the bundled brotli Chromium on Vercel/Lambda, a **system-installed Chrome/Edge/Chromium on local dev** (the @sparticuz binary is Amazon-Linux-only and won't run on Windows/macOS, where Todd tests). Override the auto-detected local browser with `REPORT_CHROME_EXECUTABLE`. Server-only. `next.config.ts` carries the load-bearing `serverExternalPackages` + `outputFileTracingIncludes` for `/api/reports/water-quality` — without the latter the brotli binary doesn't ship and the route fails at runtime with "Could not find Chromium."
- **`lib/reports/signature.ts` + `lib/reports/cache.ts`** — generated-PDF persistence. A report is a pure function of its persisted inputs, so the first generation uploads the PDF to the private `hearth-reports` bucket and records a pointer in `hearth.report_exports` (generic, keyed by `(house_id, report_type)`); later downloads serve the stored file until the **signature** changes. The signature (`computeReportSignature`, kept out of the `server-only` graph so templates stay unit-testable) is an opaque hash of the finding's content version + a static reference-data version + the template version — so a new CCR / SDWIS refresh (which moves `habitat_findings.checked_at`), a reference-data bump, or a template bump each regenerate; nothing else does. Every cache function is **non-fatal**: a missing migration/bucket degrades to a miss and the route still renders and serves a fresh PDF. Bytes are served back through the RLS-bound route (no public URL is ever issued), which is strictly owner-scoped.

### Water Quality Report — the first live card (`lib/reports/water-quality/`)

`buildWaterQualityReport(input)` composes the report **awareness → agency → involvement** (the homeowner ends on what to *do*, not what to *fear*) and is pure (no I/O, no LLM — every number, tier, and explanation is deterministic; the one orienting sentence is templated):

1. **Awareness** — themed header + "Detected in your water": the `ccr_findings.contaminants` list in the summarizer's existing order (the report consumes it as-is), each row carrying its verbal tier cue (concern → "Worth acting on", caution → "Worth knowing", context → "Context"), its level vs. the MCL, its one-line why-it-matters (the existing `description` field), and its EPA reference link (the existing `learn_more_url`) — both resolved via `findWqaContaminantByAlias`. **PFAS analytes are folded into one family card** (`groupPfasFamily`, issue #234): when 2+ PFAS rows are detected, they collapse — at the position of the first PFAS row — into a single card with one family explanation (sourced from the family-level `PFAS` reference entry in `data.ts` — `canonical_name: "PFAS"`, family-level aliases only so it never shadows an individual analyte lookup), one EPA link, and each analyte listed beneath by its printed name and level/limit. The warm heading ("PFAS — the 'forever chemicals'") is a presentation string shared from the grouping module. `groupPfasFamily` + the heading live in [`lib/habitat/water-quality/contaminants/pfas-grouping.ts`](../../lib/habitat/water-quality/contaminants/pfas-grouping.ts) (extracted in #239 so the **findings modal shares the exact same grouping** — they can't drift); it reuses `PFAS_NAME_HINTS` from `ccr.ts` so it never drifts from the summarizer's PFAS classification either. It's a **presentation-layer** grouping: it deliberately does NOT touch `buildDisplayedCcrContaminants` or the matrix's `deriveDetectedContaminants`, which must keep reading the CCR sections unmerged (#224 contract). A lone PFAS analyte renders as a normal single card. The module can't live in `report.ts` because the modal is a client component and `report.ts` transitively imports `node:crypto` (via the cache signature).
2. **Agency** — the recommended-combination callout (`recommendRemediationCombination`) + the full WQA-5 remediation matrix (`personalizeRemediationMatrix`), detected rows amber-highlighted, all four cell states rendered distinctly (the unreliable-vs-none distinction — carbon-and-PFAS is "unreliable," not "none" — never shares a glyph or color). The `distillation`/`uv` columns collapse to one "Distill / UV" via `betterEffectiveness`.
3. **Involvement** — learn → act → involve, the free-testing affordance (only when `ccr_findings.free_testing_offer` is present), the utility contact block (utility name + spelled-out PWSID + point of contact), and the once-at-the-end disclosure: a methodology paragraph, a "Where this data comes from" bullet list (the uploaded CCR with provenance — year, and "uploaded by {name} on {date}" when the uploader is the current user, resolved from `water_system_reports` + auth metadata — plus EPA's SDWIS, acronyms spelled out for a general audience), and the "awareness, not a substitute for testing" close.

The route handler at `app/api/reports/water-quality/route.ts` loads the active house + the WQA finding (RLS-bound), requires CCR-derived data (422 otherwise — the card surfaces the message), computes the signature off `checked_at`, serves the cached PDF on a hit, else renders → persists best-effort → serves.

On `/reports`, the **"Your home's habitat"** group now **leads** the page (it's first in `GROUPS`) so the one live report is the first thing a visitor sees; the planned Superfund and FEMA reports join the same group. The water-quality card (`live: true`) gets a distinct **`FeaturedReportCard`** treatment — the WQA module thumbnail (`/habitat_module_images/WQA.jpg`) as a full-bleed hero banner with the title set over a scrim, then the description and a client `WaterQualityGenerateButton` (fetch → spinner → blob download). It has no "Coming soon" chip and no stub preview placeholder. Every other card across all four groups keeps the mocked `ReportCardView` (medallion + placeholder + disabled button).

---

## Lifecycle outlook (dashboard capital-planning teaser)

The dashboard hero's right column hosts the **Lifecycle outlook** panel ([`app/(app)/dashboard/lifecycle-outlook-panel.tsx`](../../app/(app)/dashboard/lifecycle-outlook-panel.tsx), issue #212), beneath the property facts cards and the "About your house" card. It answers the question a homeowner doesn't know to ask — "what expensive thing is quietly aging out?" — by ranking the user's big-ticket inventory by how close each item is to the end of its typical service life. It is an **awareness** surface, never imperative ("Approaching end of life," not "Replace your roof"), and is deliberately distinct from the maintenance "On your plate" panel: lifecycle outlook is a *replacement horizon*, maintenance tasks are *recurring upkeep*. The two must not be conflated. The panel is read-only — no writes, no migration — and is the front door to the future `/maintenance` capital-planning timeline (the "See the full timeline" link, the same View-all relationship the maintenance panel has).

### Derivation — two pure, tested modules

- **[`lib/inventory/service-life.ts`](../../lib/inventory/service-life.ts)** — a static typical-service-life table (`ServiceLifeEntry = { label, typicalYears }`) resolved from the item's free-text `name` by keyword match. `resolveServiceLife(name)` runs the name through the shared [`normalizeInventoryName`](../../lib/inventory/match-name.ts) (so its synonym aliases — "Hot Water Heater" → "water heater", "Fridge" → "refrigerator", "AC" → "air conditioner", "Gas Furnace" → "furnace" — come for free) and then matches keywords against the normalized result, returning the matched entry or null. Single-number residential estimates (roof ~22 yr, furnace ~18, central AC ~15, water heater ~11, …). The LLM `service_life` insight prose is intentionally **not** read here — it's prose, not a structured number; the seam to research-derived, confidence-banded per-item estimates belongs to the full timeline page. Items whose name matches no tracked category aren't rankable and drop out.
- **[`lib/inventory/lifecycle-outlook.ts`](../../lib/inventory/lifecycle-outlook.ts)** — `buildLifecycleOutlook(items, referenceDate)`. For each **active** item with a usable `installed_on` and a service-life match it computes `ageYears` and `fractionOfLife = ageYears / typicalYears`, ranks descending, and returns the top three plus `rankableCount` and `bigTicketCount`. The return shape is a struct (not the bare `LifecycleOutlookEntry[]` the issue sketched) so the null-install exclusion + count stays in the pure, tested layer rather than being re-derived in the component. Signal bands: `>= 1.0` past typical lifespan, `>= 0.75` approaching end of life, else on track. **Tie-break:** on equal fraction the longer-lived category wins — which is exactly "older absolute age wins," since equal fraction means age is proportional to typical life, so comparing `typicalYears` avoids depending on the rounded display age. The reference date is normalized to UTC midnight (mirrors [`tier-grouping.ts`](../../lib/maintenance/tier-grouping.ts)) so wall-clock time never shifts the result. Items with null/malformed install dates are excluded from ranking but counted, so the panel can nudge "N of M big-ticket items have an install date." Both modules are unit-covered in their sibling `*.test.ts` files (age math, ranking, tie-break, top-3 slice, null-install handling, status filter, UTC normalization, signal bands).

### Surface contract

The panel is a server component that runs an RLS-scoped `hearth.inventory` read (`status='active'`, select `id, name, installed_on, status`) and is passed into the client `DashboardLive` as the `lifecycleOutlookSlot` ReactNode prop from `page.tsx` — the same server-component-inside-client pattern the inventory detail page uses for its maintenance panel slot. A query error surfaces an inline message rather than collapsing into a silent empty state. Below `MIN_RANKABLE` (2) rankable items the panel renders an awareness nudge (add big-ticket systems / add their install dates) instead of a list. Rows reuse the maintenance row tone palette (danger past-life / caution approaching / neutral on-track) so the dashboard stays visually coherent: item name + matched category, a quiet "Installed YYYY · ~N yr typical life" line, and a right-aligned signal pill. The presentational markup is kept inline in the wrapper — one caller, and the project's rule is no extraction until there are two.
