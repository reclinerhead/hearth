# Data and auth

Platform plumbing: how Hearth's Supabase schema is laid out, the rules that keep it isolated from the project we share with, the auth surfaces and proxy gate that guard every route, the onboarding flow that brings a new user up to a populated dashboard, and the Realtime + service-role wiring the dashboard depends on.

This spoke is loaded together with the hub on any task that touches database migrations, RLS, auth, the proxy gate, onboarding, account state, multi-house, or Realtime.

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
- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `lot_size_acres`, `bedrooms`, `bathrooms`, `heating_summary`, `cooling_summary`, `parcel_id`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. Two property-situation columns landed in issue #142 — `water_source` (text with a CHECK constraint enforcing `well | municipal | shared | unknown`) and `basement_present` (nullable boolean) — both captured as an interstitial phase inside the OnboardingDiscoveryModal (see "Property-situation prompt" below) and editable from the home-details modal; the application treats null and `unknown` as "we can't reason about this — suppress findings rather than guess." `water_source` uses a CHECK-constrained text column rather than a Postgres ENUM so the value set can evolve via migration without `alter type` rewrites. `lot_size_sqft` and `lot_size_acres` are intentionally redundant: Zillow displays one or the other depending on lot size, and downstream queries want sqft for sorting while UI rendering prefers acres for large lots; the briefing validator derives whichever isn't returned. `heating_summary` / `cooling_summary` are short free-form strings ("Forced air, Gas", "Central") — untyped because Zillow's vocabulary isn't constrained enough to justify an enum yet. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. Generated-image columns (`generated_image_url`, `generated_image_prompt`, `generated_image_created_at`) hold the storage path + prompt + timestamp for the architectural-sketch placeholder (see [briefing-and-house-image.md](briefing-and-house-image.md)). `onboarding_state` (jsonb, `not null default '{}'`, issue #216) carries milestone state for *view-event* onboarding milestones that have no natural data signal — today just `{ habitat_reviewed?: boolean }`; write-event milestones (photo, emergency video, first appliance) are derived from their own tables and never stored here (see the onboarding-milestones panel in [briefing-and-house-image.md](briefing-and-house-image.md#onboarding-milestones-panel)). RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
- **`hearth.rooms`** — physical spaces inside a house. `kind` is `indoor | outdoor | utility`. The **`houses_seed_default_rooms`** trigger fires `after insert on hearth.houses` and inserts a 9-room default set (Kitchen, Living Room, Primary Bedroom, Primary Bathroom, Basement, Attic, Garage, Laundry, Exterior). The Exterior room exists so outdoor inventory has a non-null home.
- **`hearth.inventory`** — every appliance, system, exterior element, and **property** item the homeowner owns. `type` is `appliance | system | exterior | property` and drives UI grouping. The conveyance line maps cleanly: the first three convey at sale; `property` (vehicles, electronics, instruments, art, pets) leaves with the owner — same line the insurance industry draws between dwelling and contents. `subtype` is a nullable discriminator within `type`; v1 recognizes `vehicle` and `pet` as concrete property subtypes (other property stays `subtype=null`), and other top-level types always carry `subtype=null`. `room_id` is NOT NULL with `ON DELETE RESTRICT`. Identification fields (manufacturer/model/serial), install/service dates, and status round it out. Two property-friendly columns added with the property type — `purchased_on date` (broadly meaningful across all inventory types but populated primarily for property) and `estimated_value_cents bigint` (user-entered, in cents to avoid float drift; `bigint` not `integer` so high-value art / jewelry don't overflow). `metadata jsonb not null default '{}'::jsonb` is the open-shape bucket for subtype-specific fields — for `vehicle` it carries `license_plate`, `license_plate_state`, `model_year`, `purchase_price_cents`, `purchased_from`, and any `vin_decode` payload; for `pet` it carries `species`, `breed`, `microchip_number`, `vet_name`, etc. New subtypes extend through `metadata` rather than new columns; promotion-to-column happens only when a real cross-row query pattern emerges. Validation lives in [`lib/inventory/metadata-schemas.ts`](../../lib/inventory/metadata-schemas.ts) as per-subtype Zod schemas with a `parseVehicleMetadata` / `parsePetMetadata` resolver that returns `{}` for any input the schema rejects — old or future shapes never crash the renderer. `hero_document_id` is a nullable FK into `hearth.documents` with `ON DELETE SET NULL`; when set, the detail page, dashboard inventory tile, and home inventory list all promote that document's thumbnail to the hero slot, falling back to the existing "most-recently-attached photo" rule when null. Two AI surfaces hang off this table — `ai_pills` / `ai_insights` from the Research pipeline (see [inventory-and-reports.md](inventory-and-reports.md)), and the manufacture-date columns (`manufacture_date`, `manufacture_date_precision`, `manufacture_date_confidence`, `manufacture_date_decoded_at`, `manufacture_date_model`, `manufacture_date_reasoning`) from the parallel serial-decode pipeline. The two precision and confidence columns are check-constrained to their enum values (`year|month|week` and `high|medium|low`); only high-confidence decodes ever populate these columns, since the user-visible tile fallback shouldn't surface a confidently-wrong date. The edit modal also writes user-entered manufacture dates through the same six columns with `model='user-entered'` and `confidence='high'`, so the detail page's "Manufactured" tile fallback flows through unchanged for both decoded and user-asserted values.
- **`hearth.documents`** — every user-captured asset attached to a house: photos and multi-page receipts today, PDFs and compressed videos in later phases. `kind` is the discriminator that drives extraction routing and UI treatment (`nameplate`, `photo`, `receipt`, `manual`, `permit`, `warranty`, `invoice`, `inspection`, `emergency_procedure_video`, `other`); current code writes `nameplate`, `photo`, and `receipt`, with the rest reserved so future phases don't need a schema change. `status` is the lifecycle column — `analyzing → analyzed → attached`, with `failed` as the terminal-error state — driven by the Smart Uploader's early-INSERT pattern (the row exists from the moment storage uploads succeed). `storage_path` holds the 1920px display version and `thumbnail_path` holds the 600px thumb; **the original uncompressed file is intentionally not stored** — only the resized versions land in the bucket. For multi-page receipts, `storage_path` / `thumbnail_path` hold page 1 only; pages 2+ live in `hearth.document_pages` (see below) so every existing single-page reader keeps working unchanged. `content_hash` is the SHA-256 of the pre-resize bytes for per-house dedup (partial unique index on `(house_id, content_hash)`), but the bytes themselves are discarded after the Canvas reads them. `house_id` is `NOT NULL` with `ON DELETE CASCADE` — deleting a house removes its documents. `inventory_id` is nullable with `ON DELETE SET NULL` — documents exist before the user attaches them in the review stage, and deleting an inventory item later reverts its documents to unattached rather than destroying them. `uploaded_by` references `auth.users` with `ON DELETE SET NULL` so documents survive user deletion. AI provenance lives in `ai_extraction` (jsonb, kind-specific schema in app code), `ai_model`, `ai_confidence` (0..1), and `analyzed_at`. `metadata` (jsonb, default `'{}'`) is the open-shape bucket for kind-specific structured fields — currently populated for receipts (vendor / date / totals / line items / referenced serials, parsed via `receiptMetadataSchema` in [`lib/documents/metadata-schemas.ts`](../../lib/documents/metadata-schemas.ts)), reserved for future kinds. Same column-vs-jsonb philosophy as `hearth.inventory.metadata`: promote to a column only when a cross-row query pattern earns it. RLS scopes through house ownership identical to `hearth.inventory` — four policies (SELECT/INSERT/UPDATE/DELETE) all delegating to `hearth.houses.owner_id = auth.uid()`.
- **`hearth.document_pages`** — pages 2+ of multi-page documents (issue #117). Page 1 stays on `hearth.documents.storage_path` / `thumbnail_path` so every existing single-page reader (signed-URL helpers, dashboards, detail-page galleries) keeps working unchanged; only multi-page documents need the child table. Columns: `document_id` (FK with `ON DELETE CASCADE` so a parent delete atomically removes every page), `page_number` (CHECK `>= 2` — page 1 is implicit on the parent), `storage_path` / `thumbnail_path` (same 1920px + 600px shape as the parent), `content_hash` for in-session per-page dedup, plus the usual size / MIME / filename fields. Unique on `(document_id, page_number)`. Three policies (SELECT/INSERT/DELETE) all delegating through the parent document's house ownership; no UPDATE policy — pages are immutable, the user retake flow deletes the row + storage objects and inserts a fresh row instead of mutating in place. Cleanup-on-cancel uses `documentDirectoryPath` and `.list()` against the bucket so a single sweep removes both single-page and multi-page documents without the caller knowing which.

All four tables (houses, rooms, inventory, documents) use a shared `hearth.set_updated_at()` trigger function defined in the houses migration. `hearth.document_pages` is intentionally not in that set — pages are immutable, so the trigger has nothing to write.

`hearth.water_systems` (issue #166) is a per-utility shared cache keyed by `pwsid`, not tied to any single house — multiple houses on Kalamazoo PWS resolve to the same row. RLS is globally readable to authenticated users with no write policies (writes happen exclusively through the service-role workflow path). `raw_payload jsonb not null` preserves the full Envirofacts response so future column additions can be backfilled from existing rows. See "Water Quality Awareness module" in [habitat.md](habitat.md) for the full pattern.

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

### Realtime and the `hearth` schema (load-bearing)

Supabase Realtime evaluates a subscription's RLS policy as the JWT-identified role (`authenticated` for signed-in users, `service_role` for system work). The RLS check only runs *after* that role has SELECT permission on the table at the Postgres catalog level. Supabase auto-grants the API roles SELECT on `public` but not on custom schemas like `hearth` — without an explicit grant, the realtime broadcaster sees zero rows when it looks up which subscribers to notify, and every UPDATE / INSERT / DELETE event silently disappears. The subscription handshake still succeeds; you just never get events. Migration `20260523201949_fix-realtime-servicerole-perms.sql` grants `usage` + `select on all tables` to `anon`, `authenticated`, and `service_role` on the `hearth` schema, plus an `alter default privileges` clause so future tables in the schema inherit the same grant automatically. **Any new schema we introduce must repeat this pattern**, or realtime on that schema will silently break. Row-level access stays gated by the per-table RLS policies as before — the schema-level grant just lets the realtime broadcaster ask the question.

### Realtime publication

Supabase Realtime only broadcasts changes for tables explicitly added to `supabase_realtime`. The publication is enabled by migration `20260514180500_houses_realtime_publication.sql` for `hearth.houses` and by `20260515165033_create_habitat_findings_table.sql` for `hearth.habitat_findings`. Future tables that the dashboard subscribes to need a similar migration. RLS continues to enforce scope — only the row's owner receives the events.

### Service-role client

`lib/supabase/service.ts` exports `createServiceClient()` for background work that has no session cookie (workflow steps, cron jobs). It uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS, so every call must filter by the right id. Never use it from a server action or route handler under a user session — those keep using the cookie-bound client in `lib/supabase/server.ts` so RLS keeps doing its job.

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

Phase sequence inside [`onboarding-discovery-modal.tsx`](../../app/(app)/dashboard/onboarding-discovery-modal.tsx):

```
intro → briefing-checking → briefing-result → property-questions
      → module-checking ↔ module-result (per module) → done
```

The `property-questions` phase has no auto-advance timer — the user's Skip / Save click is what drives the transition to the first module. The briefing and habitat workflows have already been running in parallel the whole time; the phase pauses only the visual reveal, not the underlying work. Skip and Save both transition to the same next phase (first applicable module, or `done` when none apply). Save also runs an RLS-bound UPDATE against `hearth.houses` through the browser Supabase client to persist the chosen values.

**Habitat kickoff moved to the property-questions phase (issue #144).** An earlier design had the briefing workflow's persist step fire `runHabitatChecks` directly, so habitat started running the moment Zillow finished. That created a timing race: habitat ran with the still-null `water_source` / `basement_present` defaults, finished before the user could answer the property-situation questions, and any module whose output depends on those values (today: the Superfund recommended-actions logic) computed against the wrong inputs. Double-firing habitat to recover would have wasted 10–15 s of compute per onboarding.

The fix moves habitat kickoff out of the briefing workflow entirely and into the callers:

- **New-property onboarding** — the discovery modal's property-questions Save AND Skip handlers each call [`triggerHabitatRecheck`](../../app/(app)/dashboard/actions.ts) once the user has answered (Save) or explicitly opted out (Skip). The houses UPDATE on the Save path completes first, so the workflow's `loadHouseContext` step sees the freshly-saved values. The Skip path fires habitat too — without it, users who skip the questions would dismiss the modal without ever getting habitat findings.
- **Refresh House Facts** — [`refreshBriefing`](../../app/(app)/dashboard/actions.ts) now fires briefing AND `runHabitatChecks` in parallel. Returning users already have their answers persisted, so the timing hazard doesn't apply and parallel-fire is the cheapest path.
- **Briefing workflow** — [`workflows/briefing.ts`](../../workflows/briefing.ts) no longer fires habitat from its persist step. The comment block there explains the why so a future contributor doesn't reintroduce the race by re-adding the call.

Soft-fail at every kickoff site: a `start()` failure is logged but doesn't block the modal phase advance / briefing return. The "Refresh House Facts" button is the manual recovery path for any edge case (user closes browser mid-modal, transient workflow start failure, etc.).

On the briefing-failure path the prompt is skipped entirely — the failure message is the last thing the user sees before the "Start" button enables, and adding a form prompt right after a failure message would compound the friction. Those users can fill the fields in later via the home-details edit modal.

Pure logic for the phase belongs to the row builder in [`onboarding-discovery-rows.ts`](../../app/(app)/dashboard/onboarding-discovery-rows.ts): during `property-questions` the briefing row stays `done` and every module row stays `idle`, identical to the `briefing-result` phase. The interactive form (segmented controls + Skip / Save buttons) is rendered separately in the modal body, beneath the row list.

The form region itself is a thin wrapper around the shared [`components/property-situation-fields.tsx`](../../components/property-situation-fields.tsx), which also powers the home-details edit modal so the question copy and segmented-control shape stay in sync across surfaces. Users who skip during onboarding (or who onboarded before this prompt landed) can populate the fields later via the edit modal — the same `<PropertySituationFields>` block lands there under a "Property situation" section.

### Mapbox configuration

- Product: **Address Autofill** (not Search Box, not raw Geocoding). Session-based pricing — one onboarding equals one billable session regardless of keystrokes.
- Token: `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, set in Vercel and pulled locally via `vercel env pull`. URL-restricted to `http://localhost:3000`, `https://hearth.toddtech.llc`, and the Vercel preview wildcard.
- TypeScript note: `@mapbox/search-js-react@1.5` types `AddressAutofill`'s `children` as `React.ReactChild`, which was removed in `@types/react` v19. `address-form.tsx` re-types the component locally with `React.ReactNode` children to keep TSC happy. `@mapbox/search-js-core` is only a transitive dependency, so the retrieve-response shape is inlined rather than imported.

### Multi-house

The schema supports many houses per owner. The UI surfaces evolved across two issues: #98 wired the data layer (profile fields, helpers, query swap) while shipping no user-visible change; #100 added the switcher dropdown, the `/houses/new` flow, and the proxy gate split that lets premium / admin users actually use the feature.

**User-facing noun is "property", not "house".** Cleaner business word that extends to condos / rentals naturally. The data model still uses `house` / `hearth.houses` — only the user-visible copy changed.

**Pieces:**

- **`public.profiles` carries user state** — `plan_tier`, `role`, `is_admin`, and `active_house_id` (see the profiles bullet in the schema map). RLS lets a user read/update only their own row, and the UPDATE policy pins plan/role/admin to current values so the client can only ever write `active_house_id`.
- **Active-house resolution** — [`lib/houses/active-house.ts`](../../lib/houses/active-house.ts) exports `resolveActiveHouseId(supabase)`. It reads `profiles.active_house_id`, verifies the referenced house is still owned by the user (RLS handles the ownership check), and falls back to the **most recently created** owned house when the stored value is null or stale. Most-recent rather than oldest is deliberate: when a user adds a second house, the natural default is to land on the new one. Returns null only when the user has zero houses. The (app) layout, dashboard, and `/inventory` all call this helper instead of the old `.order("created_at", asc).limit(1)` pattern, so any future surface that needs "the user's current house" picks up the user's actual selection automatically.
- **Capability gate** — [`lib/houses/capabilities.ts`](../../lib/houses/capabilities.ts) exports `resolveUserCapabilities(supabase)`, called once per request from the (app) layout. Returns `{ canCreateAdditionalHouse, canSwitchHouses, isAdmin, planTier }`. `canCreateAdditionalHouse = isAdmin || planTier === "premium"` is the single chokepoint surfaces that need it (the "Add a property" entry in the switcher / account menu, the `/houses/new` page, the proxy gate) all consult. `canSwitchHouses` is purely "does the user have ≥ 2 houses" so the switcher can render as a static chip vs. an interactive dropdown. When trial / referral / contractor-gets-N-free policies land, `resolveUserCapabilities` is the only file that changes.
- **Switcher dropdown** — [`components/property-switcher.tsx`](../../components/property-switcher.tsx) replaces the old static address chip in the top nav. Three render states: legacy static chip when the user can neither switch nor add (free user, one house), button-shaped trigger + dropdown otherwise. The dropdown lists every owned house (most-recent first), marks the active one with a `circle-check` icon, and surfaces a divider plus "+ Add a property" entry when `canCreateAdditionalHouse` is true. Clicking an inactive row fires [`setActiveHouseAction`](../../app/actions/houses/set-active-house.ts) and renders a spinner where the checkmark would go until the server-action redirect navigates away. The component is `hidden md:block` — mobile parity is provided by the account-menu submenu (see "Mobile parity" below).
- **`/houses/new` flow** — [`app/(app)/houses/new/page.tsx`](../../app/(app)/houses/new/page.tsx) reuses the onboarding `<AddressForm>` (the form takes a `submitLabel` prop so the button reads "Add this property" here vs. "Set up my house" on `/onboarding`). The page is guarded both at the proxy and at the page level: zero-house users get bounced to `/onboarding`, free users without the capability get bounced to `/dashboard`. The shared `createHouseFromMapboxFeature` action writes `active_house_id` on every insert success, so the user always lands on `/dashboard` viewing the newly added property.
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
