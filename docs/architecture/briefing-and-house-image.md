# Onboarding discovery modal and house image

The first-run experience that narrates Hearth's lookups for a newly created house, plus the dashboard hero image surface (user photo when present, static SVG illustration otherwise). Originally this spoke also documented the Day One Briefing — a workflow that scraped Zillow via Perplexity Sonar and stamped facts onto `hearth.houses` — but issue #210 removed that pipeline. The first row of the discovery modal is now a static "home is set up" confirmation, and the dashboard's hero illustration is a hand-authored SVG instead of an AI-generated sketch.

Read this spoke when working on the discovery modal, the house-image surface, or the user-photo upload flow.

The Realtime publication migration and the service-role client that the habitat workflow uses live in [data-and-auth.md](data-and-auth.md#realtime-publication).

---

## What onboarding does now

When a user submits an address through onboarding:

1. **Insert the house row** — `app/(app)/onboarding/actions.ts` writes `hearth.houses` and, if the insert succeeds, updates `public.profiles.active_house_id` to point at the new row.
2. **Redirect to `/dashboard`** — no background workflow fires from this action.
3. The dashboard mounts, sees that no `habitat_findings` rows exist for this house, and shows the **discovery modal**.
4. The modal walks through a short timer beat that resolves the first row to "Your home has been set up." and then prompts the user for the two property-situation answers (water source, basement). Saving or skipping that prompt is what fires the habitat workflow via `triggerHabitatRecheck`.
5. The user clicks **Start Managing my Home** and lands on the populated dashboard.

There is no Zillow lookup, no Perplexity call, and no image-model spend on a new house. The only background work is the habitat orchestrator, which kicks off later in the modal's lifecycle (Save/Skip) so it runs with the user's property-situation answers in hand.

### Files

- **`app/(app)/onboarding/actions.ts`** — house insert + `active_house_id` write + `revalidatePath("/", "layout")` + `redirect("/dashboard")`. No workflow start; no awaited side effects beyond the writes themselves.
- **`app/(app)/dashboard/page.tsx`** — server component that loads the house row, passes it through `<DashboardLive initialHouse={...}>`, and mounts the realtime hook.
- **`lib/hooks/use-house-realtime.ts`** — subscribes to UPDATE events on the row over Supabase Realtime and exposes an imperative `refetch`. The pre-#210 polling fallback that ran while `briefing_status` was non-terminal is gone — the column no longer transitions, so there's nothing to poll for. Write paths inside the hook's subtree call `refetch()` after their own writes; write paths outside the subtree dispatch `HOUSE_UPDATED_EVENT`.

---

## Discovery modal

The dashboard's first-time experience is a streaming modal that narrates Hearth's lookups in real time, rather than the quiet inline skeletons used on the steady-state dashboard. The intent is for the user to see *what Hearth is doing for them* — a "home setup" beat, then each habitat module — instead of watching empty cards.

- **Lives at `app/(app)/dashboard/onboarding-discovery-modal.tsx`** and is mounted by `dashboard-live.tsx` when the first-run preconditions hold.
- **First-run precondition**: no `habitat_findings` rows exist for this house *at all*. Once any row exists (even one upserted to `status='running'`), the modal is gone for good. Issue #210 dropped the previous `briefing_status` / `briefing_generated_at` conditions — those columns no longer transition, so the habitat-row check is the only signal still needed. The probe checks row existence rather than `status='completed'` because the orchestrator upserts each row to `status='running'` before the check runs; filtering by completed would re-open the modal mid-refresh for established users.
- **sessionStorage** is a re-mount safety net keyed by `houseId` (`onboardingDiscoveryDismissed:<id> = "1"`), so a fast nav back to the dashboard immediately after dismissal doesn't briefly flash the modal back open while the habitat read catches up. It is not the source of truth.
- **Row count is fixed from first paint.** The modal renders one row per applicable check (one home-setup row + one row per applicable habitat module) from the moment it mounts, with not-yet-reached rows held in a muted `idle` state (hollow circle, `--color-text-tertiary` label). Each row advances `idle → checking → done` as its phase activates. This keeps the modal surface from growing or re-centering as results stream in — adding a new habitat module to `HABITAT_MODULES` does not re-introduce jumping because the row list always equals `1 + applicableModules.length`. The pure `buildRowList` mapping from `(phase, applicable modules, accumulated copy, accumulated severities)` to rendered rows lives in `app/(app)/dashboard/onboarding-discovery-rows.ts` and is unit-tested in the sibling `.test.ts`.
- **Source eyebrow above each row.** Every card renders an 11px/uppercase eyebrow above the glyph + lead block ("HOME SETUP" for the first row, "EPA RADON CHECK" / "FEMA FLOOD ZONE CHECK" / etc. for habitat modules) so each tile self-identifies its data source from intro through done. Habitat-module rows read the label from an optional `sourceLabel` field on `HabitatModule` (`lib/habitat/types.ts`); when a module omits it the row falls back to `module.name.toUpperCase()`. The home-setup row has no module, so its label lives as `BRIEFING_SOURCE_LABEL` next to `buildRowList` in `onboarding-discovery-rows.ts`. Idle rows dim the eyebrow's opacity in lockstep with the lead line so not-yet-started tiles still read as muted.
- **Home-setup row content is static.** The first row reads "Setting up your home…" during the brief `briefing-checking` beat, then "Your home has been set up." for every later phase. No facts, no secondary line, no severity. The pacing rhythm (`idle → checking → done`) is preserved so the user still sees Hearth do something, but the row no longer waits on a workflow.
- **Card rows with severity awareness.** Each habitat-module row renders as a bordered card with a 14px/500 lead line and an optional 13px secondary line beneath it. Done-state rows derived from a habitat module carry the module's persisted `severity` and drive three things from it: the glyph (alert triangle in the severity colour for flagged severities — caution / concern / critical — and a green check otherwise), the card border (a warm `color-mix` of `--color-warning` and `--color-border-subtle` when flagged, plain subtle otherwise), and a right-aligned "Worth knowing" relevance pill wrapped in the project `Tooltip` primitive so hover, keyboard focus, and screen readers all reach the same explanation. The pill label is uniform across every flagged severity — the visual differentiation already lives in the glyph + border, and the tone-of-voice escalation lives in the tooltip body ("we'll surface this on your dashboard with our findings and suggested follow-ups." for concern/critical, "worth being aware of. You'll find this on your dashboard with the full details." for caution). The pure derivation helpers (`isFlaggedSeverity`, `discoveryRowGlyph`, `pillLabelForSeverity`, `pillTooltipForSeverity`) live in `components/habitat-severity.tsx` alongside `SEVERITY_COLOR`, so the modal never invents a parallel severity vocabulary and the helpers can be reused by the dashboard tiles and detail modal in the future. The home-setup row never carries a severity — it always renders as a green-check, non-flagged card. The subtitle slot beneath the headline stays mounted in every phase so the surface height is stable; in non-`done` phases it carries the existing copy ("This typically takes 20 to 30 seconds." / property-questions help text) and in `done` it carries a summary chip — "{total} facts found · {N} worth a closer look" with a `--color-warning` dot — where `N` is the number of flagged habitat findings shown (the home-setup row never counts toward `N`) and the chip omits the second clause when `N === 0`.
- **The Refresh button on the dashboard does not re-open the onboarding modal.** Once any habitat module has completed once, the first-run precondition is false; the refresh-mode modal mounts instead (see "Refresh mode" below).

### Phase machine

```
intro (500 ms)
  → briefing-checking (500 ms timer beat; no row to wait on)
    → briefing-result (500 ms)
      → property-questions (onboarding only — user-driven Save/Skip
        fires triggerHabitatRecheck and advances)
        → module-checking[0] → module-result[0] → … (gated on each
          habitat_findings row reaching a terminal status with
          checked_at > sessionStartedAt in refresh mode)
            → done
```

Phase advances are timer-driven for the first two beats (`briefing-checking` and `briefing-result`) — issue #210 removed the row-status wait, so the modal paces the home-setup row with `RESULT_DISPLAY_MIN_MS` (500 ms) holds rather than blocking on `briefing_status` transitions.

### Refresh mode

The dashboard's **Refresh** button mounts the same modal with `mode="refresh"`. The differences are:

- The `property-questions` phase is skipped — those answers were captured during the user's original onboarding and don't need to be re-asked on refresh.
- Module-row advances are gated on `finding.checked_at > sessionStartedAt`, where `sessionStartedAt` is captured at click time (before the server action fires). Without that gate the modal would see the previous run's terminal findings the moment it mounted and skip straight through.
- Copy is swapped for the refresh framing ("Refreshing your home" vs. "Setting up your home"; "Done" vs. "Start Managing my Home").
- The action fired is `refreshBriefing` in `app/(app)/dashboard/actions.ts`, which now kicks off the habitat orchestrator only (the Zillow workflow it used to fire alongside is gone). The function name and shape are preserved for callsite stability.

### `HabitatModule.getOnboardingMessage`

The modal's per-module result line is authored by each module via an optional `getOnboardingMessage(finding) => string` on the `HabitatModule` contract (`lib/habitat/types.ts`). The string should lead with what was found, not what was checked, because the modal already renders "Checking <module.name>…" before this fires. Modules that don't implement it get a generic "Checked <name> for your area" fallback. The radon module's implementation lives alongside its `check()` in `lib/habitat/modules/epa-radon-zone/index.ts` and branches three ways on zone — Zone 1 leads with concern, Zone 2 with moderate, Zone 3 with positive framing. Unit-tested in `index.test.ts`.

The WQA module's onboarding line is a richer case: it has *two* independent axes (EPA compliance violations and Lead and Copper Rule sample results) and the severity is the worse of the two. The pre-#186 implementation read only the compliance axis, which produced a contradictory row in the discovery modal whenever LCR alone pushed severity to `caution` ("no active compliance issues." next to a warning glyph and a "Worth knowing" pill). Issue #186 replaced that with a pure builder at [`lib/habitat/modules/water-quality-awareness/onboarding-message.ts`](../../lib/habitat/modules/water-quality-awareness/onboarding-message.ts) that reads `finding.severity` + `system_card.compliance_status_short` + `classifyLcrAxis(lead_copper_summary)` and produces a two-clause sentence — clean axis as reassurance, flagged axis as the honest call-out. Issue #188 expanded the model so any detected lead/copper drives caution (not only ≥80% of the action level) and dropped monitoring/reporting violations from severity, so the builder now has three caution tiers — `above` (concern, "at or above the action level"), `approaching` ("approaching the action level. We'll flag this for follow-up."), and `detected` ("recent samples have detected lead. Any presence is worth knowing about."). The voice across all flagged-caution branches leads with "they're in active compliance with EPA" — celebrating the regulator-side positive — and pairs it with the actual LCR-axis call-out. Lead vs. copper is distinguished when a single metal is responsible; "lead and copper" appears only when both axes are at the same tier. Favorable only fires when every sample is below the detection limit and reads as "no detectable lead and copper." The builder is unit-tested per-row in `onboarding-message.test.ts`. The non-CWS branches (private well / cws_unmapped / stale / non_community) stay shaped by their own copy and don't go through this builder.

---

## Onboarding milestones panel

A **separate, post-modal** surface (issue #216). Once the discovery modal closes, a new user is alone with a mostly-empty dashboard; this panel sits above the hero and nudges them toward the handful of high-value first actions, then retires permanently once they're done. It is *not* part of the discovery modal's phase machine — the two share no state.

- **Lives at `app/(app)/dashboard/onboarding-milestones-panel.tsx`** (client) with pure derivation helpers in `onboarding-milestones.ts` (unit-tested in the sibling `.test.ts`, mirroring the `onboarding-discovery-rows.ts` split). Mounted at the top of `app/(app)/dashboard/page.tsx`'s `flex flex-col gap-6` wrapper, above `<DashboardLive>`, keyed on house id so a property switch recomputes against the new house's signals.
- **Four milestones, in fixed order:** add a home photo (`YOUR HOME`), record an emergency video (`EMERGENCIES`), add a first appliance (`INVENTORY`), review habitat findings (`HABITAT`). Each card is a **full-bleed image tile** modeled on the Emergency panel's `PrimaryTile` (issue #218) — a portrait `3/4` card with full-bleed category art, a prominent ~56px top-left glyph chip over the art, a bottom gradient scrim, white overlay text (area eyebrow, awareness-framed lead title, secondary line), and a solid amber CTA pill with a trailing arrow as the brightest element. The grid runs `md:grid-cols-4` → `sm:grid-cols-2` → `grid-cols-1`; the whole tile is the click target (matching `PrimaryTile` / `InventoryTile`), with the pill as the visible affordance. Each milestone carries an optional `imageSrc` on the content map; when absent the art layer is skipped and the glyph sits over a flat warm `--color-bg-surface-raised` field, so the layout ships before commissioned art does and a missing asset never shows a broken image. Today only `emergency_video` is wired to art — it reuses the emergency Water category image (`/document_icons/emergency_water.jpg`) so the milestone visually rhymes with the Emergencies panel it points at; the other three use the flat-field fallback. A milestone that has just flipped to `complete` (the only state in which a complete tile renders, since the panel filters to the pending subset) shows the "you did it" beat before leaving on the next load: the art desaturates and dims, the glyph chip goes green, and the amber CTA is replaced by a muted-green check pill (`Added` / `Recorded` / `Reviewed`).

### Detect, don't track

Each milestone's done-state is **derived from data that already exists**, not a separate completion table or a checklist the app keeps in sync. This mirrors the lazy-reanalysis principle — let the real data be the source of truth, so a milestone can never drift out of sync (a user who added an appliance before this panel shipped still gets credit; a direct DB insert or future bulk-import can't leave the panel lying).

| Milestone | Completion signal | Source |
| --- | --- | --- |
| Home photo | `user_image_url is not null` | `hearth.houses` row (already in hand) |
| Emergency video | ≥1 row, `kind='emergency_procedure_video'` | `hearth.documents` (`head:true` count) |
| First appliance | ≥1 row, this house | `hearth.inventory` (`head:true` count) |
| Review habitat | `onboarding_state->>'habitat_reviewed' = 'true'` | `hearth.houses` row (already in hand) |

`page.tsx` computes the four booleans server-side — two cheap `head:true` counts run in parallel; the photo and habitat signals read off the house row already fetched — and hands them to `buildMilestones(signals)`, which resolves each card's `pending`/`complete` state. The panel renders only the pending subset. Completion is one-way: a completed milestone is never re-surfaced even if the underlying data later changes (the learning moment already happened); there is no per-card dismiss.

### Why only habitat needs stored state

*Viewing* habitat findings is not a write, so it has no natural data signal. That one milestone reads `habitat_reviewed` off the **`hearth.houses.onboarding_state jsonb`** column (migration `20260530180000_add_onboarding_state_to_houses.sql`, `not null default '{}'`). The blob is reserved strictly for view-event milestones — write-event milestones are deliberately *not* stored there, because deriving them is self-healing while a JSONB stamp every add-path has to remember is a drift risk. The shape is open-ended (`{ habitat_reviewed?: boolean }` today) so future view-event milestones extend it without another migration.

The stamp is set by [`app/actions/houses/mark-habitat-reviewed.ts`](../../app/actions/houses/mark-habitat-reviewed.ts) — a fire-and-forget, idempotent server action (skips the write when already true) wired into `HabitatFindingTrigger` via an optional `onFirstOpen` callback. The dashboard's `HabitatPreviewPanel` passes `() => markHabitatReviewedAction(houseId)`; the generic trigger stays decoupled from the onboarding action, and the modal opens immediately without awaiting the write. Opening *any* finding counts as having reviewed them (per the issue's lean: requiring an expand risks a milestone that feels stuck).

### CTA deep-links

The CTAs route to each action's surface. The two upload milestones open the **Smart Uploader** directly (hosted as a single instance in the panel — emergency video pre-routes to `initialEmergencyEntry="category-picker"`; first appliance lands on the path-picker), since those surfaces are modals with nowhere to scroll. The photo and habitat CTAs **scroll** to their inline surfaces (`#dashboard-hero`, where `HouseImageSurface` owns the photo picker, and `#dashboard-habitat`, where opening a finding modal stamps the milestone). After a Smart Uploader save the panel calls `router.refresh()` so the completed card drops without a manual reload.

### Retire beat

When the final pending milestone completes, the panel shows a single quiet "foundation set" reward line on that load before retiring — gratitude/noticing, no badges/points/streaks (the rewards principle). It's gated by a per-session `sessionStorage` flag (`hearthMilestonesRetireBeat:<houseId>`), not persisted server state — re-showing it in a brand-new session is an accepted non-goal. The panel starts assuming the beat was already seen so SSR and the first client render agree (both `null` when all-complete), then an effect reveals it once. With everything complete and the beat already shown, the panel renders nothing — no layout hole.

---

## House image surface

The dashboard's hero image renders one of two assets:

- **User-uploaded photo** (`hearth.houses.user_image_url`, bucket `house-photos`) — the user's own photo of their house. Takes priority when present.
- **Static SVG illustration** (`components/static-house-illustration.tsx`) — a stylized house-at-dusk scene rendered as inline SVG. The default placeholder until the user uploads a photo. Issue #210 replaced the previous AI-generated architectural sketch with this; the visual contract is the same ("not a photo of your home") but it costs nothing per render and pushes the user toward the real win, which is uploading their actual photo.

The two assets co-exist as long as the SVG is component-local — the user can remove their photo and revert to the SVG without any storage cleanup. The user-photo bucket has owner-scoped RLS; users write directly to it.

**The "not a photo of your home" framing is load-bearing whenever the SVG is on screen.** It is wrong to imply the illustration depicts the actual property. The disclaimer beneath the image ("Stylized illustration — not a photo of your home.") and the deliberately generic scene (a generic gable house with a glowing window, not era/style detail keyed to the row) both encode this contract. The disclaimer is intentionally dropped only when a real user-uploaded photo replaces the SVG — at that point the figure caption reads "Your photo." instead. Any change that makes the SVG look more "real" or removes the disclaimer is a regression.

### Files

- **`components/static-house-illustration.tsx`** — the inline SVG. 4:3 viewBox so it fills the hero container cleanly; uses CSS variables (`--color-bg-base`, `--color-bg-surface`, `--color-accent`, `--color-text-tertiary`) for every fill and stroke so the illustration tracks the theme tokens automatically.
- **`app/(app)/dashboard/dashboard-live.tsx`** — `HouseImageSurface` renders the active image (user photo if present, otherwise the SVG component) via a signed URL for the photo path, plus the figcaption row whose copy + actions swap based on which image is on screen. The component also owns the hidden `<input type="file">` and triggers it via a ref from either the prominent "Upload your own photo" button (SVG state) or the "Replace" affordance (user-photo state). `accept="image/*"` (no `capture` attribute) lets mobile browsers offer both camera and photo-library natively. Upload and remove handlers live in `DashboardLive` and call Supabase Storage + `hearth.houses` UPDATE directly from the browser; RLS on both surfaces is the load-bearing ownership check.
- **`lib/house-image/downscale.ts`** — downscales the picked image to ~1200 px wide and re-encodes as JPEG before upload. Keeps the bytes that leave the browser to a few hundred KB regardless of the original file size.
- **`lib/house-image/signed-url.ts`** — `createCachedSignedUrl(supabase, bucket, path, stamp)` issues a signed URL for any supported private bucket and caches the resulting URL string in `sessionStorage` keyed by `(bucket, path, stamp)`. Also exports `HOUSE_IMAGE_CACHE_CONTROL = "31536000, immutable"`, used as the `cacheControl` on every upload so the bytes themselves stay forever-cacheable behind the stable URL. Still used by the user-photo path and by `useCachedSignedUrl` for inventory and emergency-video surfaces.
- **`lib/house-image/use-cached-signed-url.ts`** — React hook wrapper around `createCachedSignedUrl`. Used by `InventoryDetailView` and the dashboard's `<InventoryThumbnail>`; `HouseImageSurface` uses the underlying helper directly because it tracks more state.

### Storage layout

One private bucket for user photos:

- **`house-photos`** — Path layout `{house_id}/photo` (no extension; the stored content-type is the source of truth for the MIME). One object per house. Owners can read, insert, update (upsert), and delete via RLS. The "Remove photo" affordance deletes the object and clears the row columns; deletion is best-effort while the row update is authoritative (an orphan object will be overwritten on the next upload).

The `house-images` bucket and the `hearth.houses.generated_image_*` columns survive in the database but are vestigial — nothing writes to them, nothing reads from them. They're left in place because post-beta data cannot be wiped; a follow-up cleanup migration will drop both. See [Vestigial columns and buckets](#vestigial-columns-and-buckets) below.

The `house-photos` bucket follows the standard upload contract: `upsert: true` so a replace overwrites in place (no version history), and `cacheControl: '31536000, immutable'` so the bytes carry a Cache-Control header the browser respects for one year. The stable storage path combined with the immutable header lets the browser HTTP cache hit reliably across navigations once the signed URL string is itself stable (see "Signed URL caching" below).

RLS on `storage.objects` for `house-photos`: SELECT / INSERT / UPDATE / DELETE all scoped to the owner of the matching `hearth.houses` row, using a folder-name → house_id → owner_id join. The dashboard uses the browser's RLS-bound client for every operation; no service-role path exists for user photos.

### Path vs URL

`user_image_url` on `hearth.houses` holds a storage **path** within `house-photos`, not a public URL — the bucket is private, and a permanent URL doesn't exist. The dashboard derives a signed URL whenever the active `(path, stamp)` tuple changes; the path is stable across replaces but the stamp (`user_image_uploaded_at`) moves, which forces a fresh signed-URL fetch and a new cache-key when the user genuinely wants to see different bytes.

### Signed URL caching

The signed URL is what the browser actually uses as the `<img src>` — but Supabase's `createSignedUrl()` returns a fresh URL string every time it's called (a new JWT signature). On a dashboard remount the helper would otherwise mint a brand-new URL, and the browser's HTTP cache (keyed on the full URL) would miss the bytes from the previous visit.

`createCachedSignedUrl` solves this by caching the issued URL string in `sessionStorage` under `hearthSignedUrl:{bucket}:{path}:{stamp}` with an explicit expiration timestamp. A remount with the same `(bucket, path, stamp)` reads the cached URL string synchronously — the browser sees the same URL it saw before, the HTTP cache hits the previously-downloaded bytes, and the image renders without a network round trip. When the row's stamp moves (a photo replace), the cache key changes and the helper mints (and caches) a fresh URL.

Two values are tuned together here: a 7-day signed-URL TTL so the cached URL stays valid through a long active session, and `cacheControl: '31536000, immutable'` on the bucket objects so the bytes themselves stay in the browser cache for the cached URL's whole lifetime. Either alone would still miss; together they give effectively-forever caching for the duration of normal usage.

`sessionStorage` (not `localStorage`) is the right scope because it dies with the tab — which avoids accumulating dead URLs forever and bounds the worst-case staleness to a single browsing session.

The same caching contract applies to the `hearth-documents` bucket, which backs every appliance / inventory hero photo and thumbnail. The dashboard inventory tiles and the inventory detail page sign client-side via the `useCachedSignedUrl` hook so the same URL is reused across navigations. For `hearth-documents` the cache key's `stamp` is `null`: each path embeds a `{document_id}` segment that is unique per upload, so the path itself is the version key.

---

## About-your-house description

`hearth.houses.description` used to be populated by the Zillow workflow as a raw scrape of the listing's "About this home" copy (and `description_source` held the same string for provenance). Issue #210 removed that pipeline and repurposed the column as a **user-authored paragraph** edited through `EditHomeDetailsModal`:

- The modal exposes an "About your home" textarea (`FieldDescription` in [components/edit-home-details-modal.tsx](../../components/edit-home-details-modal.tsx)), soft-capped at 2000 characters with a live remaining-count.
- The dashboard surface is `AboutYourHouseCard` in [dashboard-live.tsx](../../app/(app)/dashboard/dashboard-live.tsx). When `description` is non-null it renders a plain `surface` card (NOT `surface-ai` — the content is user-authored now, so the sparkles eyebrow would be misleading) with `white-space: pre-line` so the user's paragraph breaks survive. When null it renders a dashed-border empty-state card that prompts the user to add a description and includes an "Add a description" button that opens the edit modal directly.
- `description_source` is now meaningless (the column held Zillow's raw copy verbatim) and joins the vestigial list below — nothing reads or writes it.

---

## Vestigial columns and buckets

Issue #210 removed the Day One Briefing workflow and the AI-generated sketch but left their database surfaces in place. The schema and storage state below is no longer written or read by the application — flagged here so a future reader doesn't mistake "this column exists" for "this code path runs."

- `hearth.houses.briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error` — Originally tracked the Zillow lookup's lifecycle. The application no longer transitions these columns or reads them; the default value sits on new rows untouched. A follow-up cleanup migration will drop them.
- `hearth.houses.description` — Was briefly a user-authored "About your home" paragraph (issue #210), surfaced on the dashboard and editable in `EditHomeDetailsModal`. Issue #214 removed both surfaces; the column is retained for a possible future re-introduction but is currently unread and unwritten.
- `hearth.houses.description_source` — Originally held Zillow's raw "About this home" copy as provenance for `description`. With `description` no longer surfaced, provenance is meaningless and the column is unread.
- `hearth.houses.generated_image_url`, `generated_image_prompt`, `generated_image_created_at` — Originally held the storage path + prompt for the AI-generated architectural sketch. Nothing reads or writes them now; the dashboard hero falls back to `components/static-house-illustration.tsx` instead.
- `house-images` bucket and its `storage.objects` RLS policies — Originally held the generated sketches. Empty for new houses post-#210; the cleanup migration will drop the bucket alongside the columns.
- **`BRIEFING_PRIMARY_MODEL`, `BRIEFING_FALLBACK_MODELS` env vars** — Originally selected the Perplexity Sonar model for the Zillow lookup. The briefing workflow is gone, but `lib/inventory-insights/research.ts` and `lib/habitat/modules/epa-superfund-proximity/portfolio-summary/generate.ts` still read `BRIEFING_PRIMARY_MODEL` as a fallback after their feature-specific env vars (`INVENTORY_INSIGHTS_MODEL`, `SUPERFUND_SUMMARY_MODEL`). The name no longer matches the use; a future cleanup should rename it to a feature-neutral default or scope each consumer to its own env var.

The post-beta wipe constraint means dropping the columns and bucket is its own deliberate migration pass, not part of #210 — but the columns should be treated as read-only "ignore me" from this point on.
