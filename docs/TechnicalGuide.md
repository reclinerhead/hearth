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

- **`hearth.houses`** — one row per house. Address fields populated by Mapbox Address Autofill (`address_line1`, `city`, `state`, `postal_code`, `country`, `county`, `latitude`, `longitude`, `mapbox_id`, `mapbox_raw` jsonb). House facts (`year_built`, `living_area_sqft`, `lot_size_sqft`, `bedrooms`, `bathrooms`, `purchase_date`, `purchase_price_cents`) start null and are filled in by the Day One Briefing workflow or by the user. The `description` (user-visible) and `description_source` (unmodified provenance copy) hold the listing description. Briefing lifecycle columns (`briefing_status`, `briefing_started_at`, `briefing_generated_at`, `briefing_error`) drive the dashboard's loading and failure states. RLS scopes all rows to `owner_id = auth.uid()`. Unique on `(owner_id, mapbox_id)` prevents accidental duplicate creation. The row is in the `supabase_realtime` publication so the dashboard receives UPDATE events as the briefing populates.
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

**Local Realtime flakiness.** The Kong gateway shipped with the current local Supabase CLI (`kong/2.8.1` from 2022) proxies `/rest/v1/*` and `/auth/v1/*` cleanly but is unreliable on `/realtime/v1/websocket` — same browser request, same headers, alternates between `101 Switching Protocols` and `400 Bad Request` across reconnect attempts. Curl always succeeds, so the upstream Realtime container is fine; the failure mode is specific to how the browser's WebSocket reconnect pattern interacts with Kong's websocket proxying in this version. We left the new `sb_publishable_*` / `sb_secret_*` key format in `.env.development.local` because Kong's `request-transformer` plugin rewrites them to JWT before forwarding (see `kong.yml` inside the `supabase_kong_*` container) — that's not the issue. The 2.5s polling fallback in `useHouseRealtime` covers this so the dashboard still updates, just with a few seconds of staleness in local dev. Production uses a managed gateway and should not have this problem.

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

When a user submits an address through onboarding, the house row is inserted and a **briefing workflow** is started in the background. The dashboard subscribes to that row via Supabase Realtime, so house facts appear in place as the workflow discovers them — no manual refresh, no second round trip.

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
                                  │     write facts, status='completed'
                                  └─▶ on throw → markBriefingFailed
                                                                  ──▶  useHouseRealtime
                                                                       re-renders on UPDATE
```

### Files

- **`lib/briefing/zillow.ts`** — `lookupHouseOnZillow(input)` calls the AI Gateway via `generateText` and returns a typed `ZillowLookupResult`. The exported `validateZillowResponse` is a pure helper that clamps year/sqft/bedroom/bathroom values to plausible ranges and is the unit-tested surface (`zillow.test.ts`).
- **`workflows/briefing.ts`** — `runBriefing(houseId)` is the `"use workflow"` orchestrator. It calls three `"use step"` functions (`startBriefing`, `lookupZillow`, `persistBriefingSuccess`) and falls back to `markBriefingFailed` on any throw. Steps retry automatically — by default three attempts — before the workflow's catch handler marks the row failed. Step functions use the service-role Supabase client (`lib/supabase/service.ts`) because the workflow runs outside a request context.
- **`app/(app)/onboarding/actions.ts`** — after the house insert, calls `start(runBriefing, [houseId])` from `workflow/api`. The call is not awaited; a `start()` failure is logged but never blocks the user from reaching the dashboard.
- **`lib/hooks/use-house-realtime.ts`** — generic single-row subscription. Fetches the house once on mount, then re-renders on every UPDATE event. Reusable for any future "live row" pattern; not Zillow-specific.
- **`app/(app)/dashboard/dashboard-live.tsx`** — client component that renders the hero, the five house-facts cards, and the description from the realtime row, with three states per field: skeleton pulse (`briefing_status = 'running' | 'pending'` + null value), em-dash with "Not found" meta (`completed` + null value), and a soft error banner with a disabled "Try again" button (`failed`).
- **`next.config.ts`** — wrapped with `withWorkflow()`. Required for the `"use workflow"` and `"use step"` directives to compile.
- **`proxy.ts`** — matcher excludes `.well-known/workflow/*` so the Workflow SDK's internal endpoints aren't intercepted by session refresh.

### Model selection

Two env vars, read at call time so models can be swapped without redeploying:

- `BRIEFING_PRIMARY_MODEL` — default `perplexity/sonar-pro`
- `BRIEFING_FALLBACK_MODELS` — comma-separated, default `perplexity/sonar`

These are passed to the AI Gateway as `providerOptions.gateway.models`, which gives automatic model-level fallback if the primary errors.

**Why Perplexity Sonar.** Zillow lookup requires *live web access* — the model has to actually open Zillow's site and read what's there. Claude / GPT-5 / Grok through the AI Gateway don't have web access enabled by default, so they answer from training data and return `data_found=false` for any real address they haven't memorized. Perplexity's Sonar family is search-grounded: every answer cites and synthesizes from live web pages. For a "find facts on Zillow" task that's exactly the capability we need; the trade-off is slightly less raw reasoning than the frontier models, which doesn't matter here.

### Realtime publication

Supabase Realtime only broadcasts changes for tables explicitly added to `supabase_realtime`. The publication is enabled by migration `20260514180500_houses_realtime_publication.sql` for `hearth.houses`. Future tables that the dashboard subscribes to need a similar migration. RLS continues to enforce scope — only the row's owner receives the events.

### Service-role client

`lib/supabase/service.ts` exports `createServiceClient()` for background work that has no session cookie (workflow steps, cron jobs). It uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS, so every call must filter by the right id. Never use it from a server action or route handler under a user session — those keep using the cookie-bound client in `lib/supabase/server.ts` so RLS keeps doing its job.

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Storage buckets** for hero photos. `hero_photo_path` columns exist; the storage bucket and upload UI do not.
- **Public-records sources beyond Zillow** — FEMA flood zone, EPA radon zone, BS&A assessor data, etc. Each will be a new step in `workflows/briefing.ts` writing into new columns; the Habitat dashboard section is wired with a "coming soon" placeholder until then.
- **Manual briefing refresh** — the dashboard's "Try again" button on a failed briefing is currently disabled. A follow-up issue will wire it to re-`start()` the workflow on demand.
- **Description synthesis** — for v1 we show `description_source` (Zillow's raw copy) as `description`. A future LLM step will rewrite `description` in Hearth's voice while leaving `description_source` intact.
- **Multi-house** UI. Schema supports it; onboarding gate currently locks to one house per user.
- **Inventory CRUD**. Schema exists; the `/appliances`, `/entities/[id]`, and `/documents/[id]` routes are placeholder shells.
- **OCR + extraction routing** (receipts, nameplates, permits) — schema work has not started.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --local` is wired into the workflow, it'll replace the hand-typed row.
