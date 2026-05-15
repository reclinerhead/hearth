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
    habitat/               # Public-records surface (placeholder)
    home-details/          # House facts edit surface (placeholder)
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
  hooks/
    use-house-realtime.ts  # Supabase Realtime subscription for one house row
  supabase/
    client.ts              # Browser Supabase client (hearth schema)
    server.ts              # Server component / action client (hearth schema)
    service.ts             # Service-role client for background work (workflow steps)
    proxy.ts               # Edge-style session refresh + route guards
workflows/
  briefing.ts              # Day One Briefing workflow (use workflow + use step)
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

- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `lot_size_acres`, `bedrooms`, `bathrooms`, `heating_summary`, `cooling_summary`, `parcel_id`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. `lot_size_sqft` and `lot_size_acres` are intentionally redundant: Zillow displays one or the other depending on lot size, and downstream queries want sqft for sorting while UI rendering prefers acres for large lots; the briefing validator derives whichever isn't returned. `heating_summary` / `cooling_summary` are short free-form strings ("Forced air, Gas", "Central") — untyped because Zillow's vocabulary isn't constrained enough to justify an enum yet. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
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

`components/app-shell.tsx` composes `TopNav`, `BottomNav`, and `DesktopSidebar` into the authenticated app frame, capped at `--content-max` (1200px) with safe-area-aware bottom padding for mobile nav.

`components/document-modal.tsx` provides the document-viewer modal and a `DocumentTrigger` to launch it. Body scroll-lock is handled via the `.scroll-locked` class in globals.css.

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

## Habitat surface

Habitat findings surface on two pages: the dedicated `/habitat` route (full detail, one tile per finding with summary + action chips) and the dashboard's Habitat preview block (compact tiles, no actions, each tile linking to `/habitat` for follow-up). Both surfaces run the same query against `hearth.habitat_findings` with `status = 'completed'`, sort by the same severity weight (concerns first: critical → high → moderate → low → neutral → good), and use `HABITAT_MODULES.find(m => m.key === row.module_key)` to look up the module label and `iconImage`. Failed and `not_applicable` findings are intentionally not rendered on either surface in v1 — they'll get their own tile variants later.

`/habitat` (`app/(app)/habitat/page.tsx`) is a server component that renders one `<HabitatFindingTile>` per row. With a single finding the grid collapses to one column so the tile stretches to container width; two or more findings cap at two tiles per row on md+.

The dashboard's Habitat block (`app/(app)/dashboard/page.tsx`) renders one `<HabitatFindingTileCompact>` per row inside its half-width left column. The `SectionHeader` has a trailing "See all" link to `/habitat` matching the Appliances pattern, and when there are zero completed findings the block falls back to a one-line "Looking up public records for your area…" placeholder so the dashboard layout stays stable during the first-run discovery window.

### Tile components

`components/habitat-finding-tile.tsx` is the full tile used on `/habitat`. Server-component-safe. Renders an optional ~128px square hero image on the left, then an eyebrow (module label) + severity dot, headline (h3), summary, and an optional row of action chips. Layout switches between two columns (`128px 1fr`) and a single column based on whether the module declared an `iconImage` — no empty image gutter when absent. Uses the `.surface-ai` treatment so it sits visually alongside other AI-authored content. Severity dots are colour-mapped against `--color-danger` / `--color-warning` / `--color-success` / `--color-text-tertiary`. Each action chip opens in a new tab via `target="_blank" rel="noopener noreferrer"`.

`components/habitat-finding-tile-compact.tsx` is the dashboard-preview variant. Smaller 72px hero, line-clamped 2-line summary, no action chips. The whole tile is a single `<Link href="/habitat">` so clicking anywhere routes the user to the full detail. Kept as a separate component rather than a `variant` prop on the full tile because the full tile's action row contains `<a>` tags and the compact tile *is* an `<a>`; nesting `<a>` inside `<a>` is invalid HTML.

### `HabitatFinding.actions` and `FindingAction`

A module's `check()` may return an `actions: FindingAction[]` field on its finding. The orchestrator persists it into the `hearth.habitat_findings.actions` jsonb column on the completed-status upsert. `FindingAction` is a discriminated union of three kinds:

- `product` — a consumable (e.g. test kit). URL is wrapped in `affiliateLink()` at construction time. Optional `priceHint` shown subtly next to the label.
- `link` — informational link (EPA page, county GIS, etc.).
- `service` — a directory or finder for local professionals (mitigators, inspectors).

Actions are per-finding rather than per-module because the right call to action depends on what the module actually returned: Zone 1 radon and Zone 3 radon share a module but surface different next steps. The dashboard renders product chips with the accent treatment so they read as the primary affordance; link and service chips stay subtler.

### Affiliate-link chokepoint

`lib/affiliate/link.ts` exports a single `affiliateLink(url)` function. It is identity passthrough today and is the only place we will later inject Amazon Associates tags (or per-region storefront swaps, AAX redirects, etc.). Every module that emits a product URL routes it through this helper, so adopting affiliate revenue becomes a one-file change. A trivial test in `link.test.ts` asserts identity today and will fail the moment we start mutating URLs, prompting an update of the contract callers rely on.

### `HabitatModule.iconImage`

Each module may declare an optional `iconImage` (a root-relative path under `/public`). When present, the tile renders it as a 128px square hero on the left. Module definitions stay serializable — we use string paths, not imported asset modules. Module hero images live under `public/habitat_module_images/` (e.g. `radon.jpg`).

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Storage buckets** for hero photos. `hero_photo_path` columns exist; the storage bucket and upload UI do not.
- **Public-records sources beyond EPA radon** — FEMA flood zone, EPA Superfund proximity, BS&A assessor data, lead-disclosure heuristics, etc. Each is a new habitat module under `lib/habitat/modules/<key>/`; the orchestrator already iterates the registry, so adding a module is a contained change. The "What we know about your location" `AICard` at the bottom of `/habitat` is still a static placeholder pending its own wiring.
- **Description synthesis** — for v1 we show `description_source` (Zillow's raw copy) as `description`. A future LLM step will rewrite `description` in Hearth's voice while leaving `description_source` intact.
- **Multi-house** UI. Schema supports it; onboarding gate currently locks to one house per user.
- **Inventory CRUD**. Schema exists; the `/appliances`, `/entities/[id]`, and `/documents/[id]` routes are placeholder shells.
- **OCR + extraction routing** (receipts, nameplates, permits) — schema work has not started.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --local` is wired into the workflow, it'll replace the hand-typed row.
