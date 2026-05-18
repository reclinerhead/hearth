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
       └─ hearth.inventory    (room_id NOT NULL; Exterior holds outdoor items)
```

Key facts about each table:

- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `lot_size_acres`, `bedrooms`, `bathrooms`, `heating_summary`, `cooling_summary`, `parcel_id`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. `lot_size_sqft` and `lot_size_acres` are intentionally redundant: Zillow displays one or the other depending on lot size, and downstream queries want sqft for sorting while UI rendering prefers acres for large lots; the briefing validator derives whichever isn't returned. `heating_summary` / `cooling_summary` are short free-form strings ("Forced air, Gas", "Central") — untyped because Zillow's vocabulary isn't constrained enough to justify an enum yet. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. Generated-image columns (`generated_image_url`, `generated_image_prompt`, `generated_image_created_at`) hold the storage path + prompt + timestamp for the architectural-sketch placeholder (see "Generated house illustration" below). RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
- **`hearth.rooms`** — physical spaces inside a house. `kind` is `indoor | outdoor | utility`. The **`houses_seed_default_rooms`** trigger fires `after insert on hearth.houses` and inserts a 9-room default set (Kitchen, Living Room, Primary Bedroom, Primary Bathroom, Basement, Attic, Garage, Laundry, Exterior). The Exterior room exists so outdoor inventory has a non-null home.
- **`hearth.inventory`** — every appliance, system, and exterior element. `type` is `appliance | system | exterior` and drives UI grouping. `room_id` is NOT NULL with `ON DELETE RESTRICT`. Identification fields (manufacturer/model/serial), install/service dates, status, and an optional hero photo path round it out.

All three tables use a shared `hearth.set_updated_at()` trigger function defined in the houses migration.

### Schema-qualification rules (load-bearing)

- Every `CREATE TABLE`, `CREATE FUNCTION`, `CREATE INDEX`, `CREATE POLICY` in a migration **must** be schema-qualified: `hearth.houses`, not `houses`. Bare names default to `public` and would leak into the shared schema.
- Both Supabase clients (`lib/supabase/client.ts` and `lib/supabase/server.ts`) are constructed with `db: { schema: "hearth" }`, so `.from("houses")` resolves to `hearth.houses` by default.
- Accessing shared tables (e.g. `public.profiles`) from the client requires an explicit `.schema("public")` call.

### Migration discipline

- Migrations flow **Hearth → remote only**. Never run `supabase db pull` — it would dump the other app's schema into Hearth's migration history.
- `supabase migration list` will show the other app's migrations in the Remote column with empty Local. This is expected visual noise.
- Local iteration loop: `supabase migration new <name>` → edit SQL → `supabase db reset` (wipes local DB and replays all migrations) → `supabase gen types typescript --local` to regenerate types.
- Push to remote (`supabase db push`) only when a feature is shipping, and only with explicit approval.

### Local-only stub

The hearth schema migration also creates `public.profiles` with `create table if not exists` as a local-dev stub. On the remote project that table is owned by the other app; the `if not exists` is a no-op there.

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

- `supabase start` runs a full local Postgres + GoTrue + Storage stack on the developer's machine.
- `.env.development.local` holds local Supabase URL + anon key + service-role key + Mapbox token. Next.js loads this *over* `.env.local` for `next dev`, so the local stack is the default during development.
- `.env.local` is populated by `vercel env pull` and holds production secrets; it is only consulted when `.env.development.local` is absent.
- Fast iteration loop: `supabase migration new <name>` → edit SQL → `supabase db reset` (wipes + replays).

**Realtime and the browser.** Realtime works end-to-end through the local Supabase stack — the Kong gateway, request-transformer plugin, and Realtime container all proxy websocket upgrades cleanly. If the dashboard fails to receive UPDATE events and the browser console shows `WebSocket connection to ws://localhost:54321/… failed` with close code `1006`, it is almost certainly a **browser-side block**, not the stack: an extension intercepting websockets, a tracking-prevention setting, or a content-blocker rule. Quickest diagnostic is an InPrivate / Incognito window — if it works there, the issue is in the regular profile's extensions or settings. The 2.5s polling fallback in `useHouseRealtime` keeps the dashboard usable even when the websocket is blocked, but the right fix is to identify and unblock the offending extension/setting per-developer.

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
- **`workflows/briefing.ts`** — calls `start(runHouseImage, [houseId])` in `persistBriefingSuccess` alongside the habitat kickoff. Fire-and-forget — a `start()` failure is logged but the briefing itself is already user-visible at that point.
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
- **`components/habitat-finding-modal.tsx`** — client component that renders the finding detail. Sticky header (severity dot + module label + severity word + headline + summary + close button), scrollable body with the optional action shelf and the activity log timeline ("How we got here"), sticky footer with "Last checked", a "View source" link, and the `Esc` keyboard hint.

The modal is **generic by design** — it renders from the `HabitatFinding` shape only (`severity`, `headline`, `summary`, `actions`, `source_url`, `activity_log`). No per-module branches. Per-module structured content (a Superfund map, a flood-history timeline) is a deferred concern that will be designed when a richer module forces the slotted-shell contract that v1 explicitly avoids.

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

### `HabitatModule.iconImage`

Each module may declare an optional `iconImage` (a root-relative path under `/public`). When present, the dashboard's compact tile renders it as a 72px square hero on the left of the tile. Module definitions stay serializable — we use string paths, not imported asset modules. Module hero images live under `public/habitat_module_images/` (e.g. `radon.jpg`).

### EPA Superfund Proximity module

The second shipping habitat module (`lib/habitat/modules/epa-superfund-proximity/`). It hits EPA Envirofacts SEMS at [`https://data.epa.gov/efservice/sems.envirofacts_site/...`](https://www.epa.gov/enviro/envirofacts-data-service-api) to pull every NPL-relevant Superfund site in the house's state (left-joined to `sems.envirofacts_contaminants`), measures haversine distance from the home to each site's EPA-provided point, and applies a three-tier proximity model based on EPA's standard 1- and 3-mile community-impact rings:

- **Tier 1** (≤ 0.5 mi) includes any NPL status — Final (F), Proposed (P), Part of NPL site (A), or Deleted (D).
- **Tier 2** (0.5–2 mi) includes only F and P.
- **Tier 3** (2–5 mi) includes only F.

Severity maps from tier + NPL status: Tier 1 + F/P → `concern`; Tier 1 + A/D → `caution`; Tier 2 + F/P → `caution`; Tier 3 + F → `neutral`; zero qualifying sites within 5 mi → `favorable`. The top-level finding severity is the worst across qualifying sites; `findings.sites` is sorted severity-desc then distance-asc.

Cadence is `yearly` — the NPL list and statuses do change but slowly. There is intentionally no caching layer in MVP: the module fetches EPA every time `check()` runs. At single-digit beta volume the per-onboard latency cost is acceptable, and the `habitat_sites` cache table has been deliberately tabled past MVP. The finding payload uses a `{ site, context }` per-entry shape (place-in-the-world facts vs per-house relationship) so a future cache migration is mechanical.

Two EPA quirks the module handles explicitly: many sites arrive with `null` coordinates and are filtered out before any distance math (with the dropped count surfaced in the activity log); and every text field arrives ALL CAPS, so site names, addresses, and contaminants are flowed through a `titleCase()` helper that preserves initialisms like `LLC`, `DOT`, `USN`, `PCB` while rendering business suffixes like `INC` as `Inc.`. Polygon-edge distance (EPA distributes single points only) and cleanup-milestone enrichment from `sems.envirofacts_site_milestone` are deliberate v2 deferrals.

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Inventory hero photos**. `inventory.hero_photo_path` exists in the schema for per-appliance / per-room hero images but no upload UI or storage policy ships with it yet. The dashboard's user-photo upload covers the house-level surface only.
- **Public-records sources beyond EPA radon and EPA Superfund proximity** — FEMA flood zone, BS&A assessor data, lead-disclosure heuristics, etc. Each is a new habitat module under `lib/habitat/modules/<key>/`; the orchestrator already iterates the registry, so adding a module is a contained change. The finding detail modal renders these out of the box from the generic `HabitatFinding` shape; richer per-module structured content (Superfund map, flood-history timeline, etc.) is deferred until a module forces a slotted-shell contract.
- **Description synthesis** — for v1 we show `description_source` (Zillow's raw copy) as `description`. A future LLM step will rewrite `description` in Hearth's voice while leaving `description_source` intact.
- **Multi-house** UI. Schema supports it; onboarding gate currently locks to one house per user.
- **Inventory CRUD**. Schema exists; the `/appliances`, `/entities/[id]`, and `/documents/[id]` routes are placeholder shells.
- **OCR + extraction routing** (receipts, nameplates, permits) — schema work has not started.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --local` is wired into the workflow, it'll replace the hand-typed row.
