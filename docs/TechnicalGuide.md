# Hearth — Technical Guide

A living description of what Hearth is built on and how the pieces fit together. CLAUDE.md describes *how we work*; this document describes *what we've built and why*. Chronology lives in `git log` and GitHub issues — not here.

This file is the **hub**. It carries only what is globally true and changes slowly: the stack, the repo layout, the cross-cutting invariants every spoke depends on, the frontend design system, environments and deployment, what isn't built yet, and the **Spoke index** that points you at the deeper architectural detail. Each task starts by reading this file and then loading the spoke(s) under [`docs/architecture/`](architecture/) relevant to the work.

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
  house-image/
    downscale.ts           # Browser-side image downscale before upload
    signed-url.ts          # createCachedSignedUrl helper for private buckets
    use-cached-signed-url.ts # React hook wrapper around the helper
  hooks/
    use-house-realtime.ts  # Supabase Realtime subscription for one house row
  supabase/
    client.ts              # Browser Supabase client (hearth schema)
    server.ts              # Server component / action client (hearth schema)
    service.ts             # Service-role client for background work (workflow steps)
    proxy.ts               # Edge-style session refresh + route guards
components/
  static-house-illustration.tsx  # Inline SVG hero placeholder (replaces the generated sketch — issue #210)
workflows/
proxy.ts                   # Next entry that calls lib/supabase/proxy.ts
next.config.ts             # Wrapped with withWorkflow() to enable directives
supabase/
  config.toml              # Local Supabase project config
  migrations/              # Forward-only migrations, schema-qualified
docs/
  TechnicalGuide.md        # This file (hub)
  architecture/            # Domain spokes — see "Spoke index" below
types/
  house.ts                 # Hand-typed House row, mirrors hearth.houses
```

Next.js' middleware file is named **`proxy.ts`** in this repo. We have not renamed it back to `middleware.ts` — do not introduce one alongside it.

---

## Cross-cutting invariants

The rules that apply across the whole codebase. Where the full detail of one of these lives in a spoke (e.g. the migration authoring loop), the one-line invariant stays here and cross-links to the spoke.

### Repo and tooling

- **Package manager**: pnpm only. Do not use `npm` or `yarn`.
- **No `src/` directory.** Flat layout — `app/`, `lib/`, `components/`, `types/`, `supabase/`, `docs/` at the root. Do not introduce one.
- **Middleware file is `proxy.ts`** at the repo root (not `middleware.ts`). It delegates to `lib/supabase/proxy.ts`. Full route-protection flow in [data-and-auth.md](architecture/data-and-auth.md#route-protection-proxyts--libsupabaseproxyts).
- **Tests live next to code**: `*.test.ts` adjacent to the source file. Coverage is selective — pure logic with non-obvious behaviour, not orchestration code or thin library wrappers (see CLAUDE.md "When to write unit tests").

### Database and Supabase

- **`hearth` schema-qualification.** Every `CREATE TABLE` / `FUNCTION` / `INDEX` / `POLICY` in a migration must be schema-qualified (`hearth.table`, not `table`). Both Supabase clients default to the `hearth` schema; reach into shared tables (`public.profiles`) with an explicit `.schema("public")`. Full detail in [data-and-auth.md](architecture/data-and-auth.md#schema-qualification-rules-load-bearing).
- **Migration discipline: Hearth → remote only.** Never run `supabase db pull` — it would dump the other app's schema into Hearth's migration history. `supabase db push` is effectively production: `next dev`, preview, and prod all read the same remote DB, so prefer additive forward-only changes and treat irreversible operations with extra care. Full authoring loop in [data-and-auth.md](architecture/data-and-auth.md#migration-discipline).
- **Any new schema must grant Realtime access.** Supabase auto-grants the API roles SELECT on `public` but not on custom schemas — without an explicit grant the Realtime broadcaster silently sees zero rows and every UPDATE / INSERT / DELETE event disappears. Pattern in [data-and-auth.md](architecture/data-and-auth.md#realtime-and-the-hearth-schema-load-bearing).
- **Service-role client (`lib/supabase/service.ts`) bypasses RLS** and must only be used from background work (workflow steps, cron jobs) without a session cookie. Never use it from a server action or route handler under a user session — keep the cookie-bound client in `lib/supabase/server.ts` so RLS keeps doing its job. See [data-and-auth.md](architecture/data-and-auth.md#service-role-client).

### Data shapes

- **Money in cents**: monetary columns are `bigint` cents (e.g. `purchase_price_cents`) to avoid float drift and give headroom over `int`.
- **Coordinates**: stored as `numeric(9,6)` on `houses`. Mapbox returns `[lng, lat]`; we store them swapped into `(latitude, longitude)`.
- **Never surface machine identifiers in user-visible copy.** Internal codes, raw lookup keys, slugs, and PWSIDs/site IDs are debug-only; user-facing text uses the canonical name.

### Server actions and AI

- **Server actions return `redirect()`**: `redirect()` throws a Next-internal error. Treat the return type as "error object or never", and don't wrap a `redirect()` call in a try/catch.
- **AI defaults to non-reasoning models.** Reasoning models earn their cost only when determinism matters (the serial-decode pipeline is the canonical case — see [ingestion.md](architecture/ingestion.md#serial-number-decode-pipeline)). The default for streamed user-facing surfaces (Research, briefings, AI Insights) is the non-reasoning model selected per-feature via env var. Fix accuracy with prompts before swapping in a reasoning model.
- **Lazy re-analysis, not eager regeneration.** AI surfaces re-run on user demand (Research button, Build maintenance plan, Recheck findings) or on a coordinated invalidation hook (a key-field edit clears stale insights so the next click regenerates against the new data). We do not burn AI Gateway credits on every row write.

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
- Migration loop is described under "Migration discipline" in [data-and-auth.md](architecture/data-and-auth.md#migration-discipline) — edit SQL on a feature branch, get review, then `supabase db push` against remote.
- **Because local dev and production share a database, treat dev writes as production writes.** Schema changes from a `supabase db push` are visible to everyone immediately; data you insert or delete during local exploration affects production rows. The cost of a careless action is real.

**Realtime and the browser.** Realtime works end-to-end through the remote Supabase project — the websocket terminates at the project's `wss://<project-ref>.supabase.co/realtime/v1/websocket` endpoint. If the dashboard fails to receive UPDATE events and the browser console shows a `WebSocket connection failed` with close code `1006`, it is almost certainly a **browser-side block**: an extension intercepting websockets, a tracking-prevention setting, or a content-blocker rule. Quickest diagnostic is an InPrivate / Incognito window — if it works there, the issue is in the regular profile's extensions or settings. The 2.5s polling fallback in `useHouseRealtime` keeps the dashboard usable even when the websocket is blocked, but the right fix is to identify and unblock the offending extension/setting per-developer.

The schema-level grant story for Realtime (the load-bearing migration that lets the broadcaster see `hearth.*` rows in the first place) lives in [data-and-auth.md](architecture/data-and-auth.md#realtime-and-the-hearth-schema-load-bearing).

### Vercel

- Push to a feature branch → Vercel builds a **preview deployment** at a unique URL.
- Merge to `main` → Vercel builds the **production deployment**.
- Environment variables are managed via `vercel env`. `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the load-bearing ones today.

### Testing in CI

- `pnpm test` (Vitest, `--passWithNoTests`) runs on every PR via GitHub Actions and surfaces as a "Tests" check on the PR.
- Branch protection is **not enforced** at GitHub (private repo on a free plan). The discipline of not merging on a red check is manual; revisit if that fails or as collaborators are added.

---

## What isn't built yet

These appear in the schema or the dashboard mockup but are not real flows. Treat as roadmap, not as currently-working features:

- **Public-records sources beyond EPA radon, EPA Superfund proximity, and FEMA flood zones** — BS&A assessor data, lead-disclosure heuristics, water-system violations, etc. Each is a new habitat module under `lib/habitat/modules/<key>/`; the orchestrator already iterates the registry, so adding a module is a contained change. The finding detail modal renders these out of the box from the generic `HabitatFinding` shape; richer per-module structured content (flood-history timeline, soil testing panels, etc.) is deferred until a module forces a slotted-shell contract.
- **LLM-assisted description rewrite** — `hearth.houses.description` was repurposed by issue #210 into a user-authored paragraph, then unsurfaced entirely by issue #214 (the dashboard "About your house" card and the editor field were removed; the column is retained for possible future use — see [briefing-and-house-image.md](architecture/briefing-and-house-image.md#about-your-house-description)). A future surface that turns short user notes into a polished paragraph in Hearth's voice is on the roadmap, but isn't built.
- **Free-tier upsell surface.** When a free user has one house and would otherwise see an "Add a property" action, the action is gated off entirely. Showing an upsell prompt in its place is its own focused work.
- **Inventory CRUD**. Schema exists; the Smart Uploader (#51) covers the create path through photo capture, the `/inventory/[id]` detail route (#53) covers the read path with hero photo, structured pills, and the Research panel, the edit / delete modal (#54) covers update + destroy, and the `/inventory` list page (#67) covers browse across all items. The `/entities/[id]` and `/documents/[id]` routes are vestigial placeholder shells from the original dashboard mockup — kept around because nothing references them anymore.
- **OCR + extraction routing for non-nameplate documents** (receipts, manuals, permits, invoices) — the `kind` discriminator and Grok pipeline are in place from phase 1.3, but the Smart Uploader only writes `nameplate` / `photo` today. The disabled "Document or receipt" and "Emergency procedure video" entries on the path-picker exist as the future surface for those flows.
- **Supabase-generated types**. `types/house.ts` is hand-maintained today; once `supabase gen types typescript --linked` (against the remote-linked project) is wired into the workflow, it'll replace the hand-typed row.

---

## Spoke index

The deeper architectural detail is split across seven domain spokes under [`docs/architecture/`](architecture/). Read the hub first, then the spoke(s) relevant to the task at hand. Each spoke is a well-formed standalone doc.

| Spoke | Domain | Read when | Keyword tags |
|---|---|---|---|
| [data-and-auth.md](architecture/data-and-auth.md) | Schema map and `hearth` schema isolation, schema-qualification rules, migration discipline, `public.profiles` defensive guard, auth and routing (proxy gate chain, authenticated layout), onboarding (Mapbox, property-situation prompt, multi-house, admin bootstrap), Realtime publication, service-role client | Working on database migrations, RLS, auth, the proxy, onboarding, account state, multi-house, or Realtime publication. | schema, RLS, profiles, proxy, onboarding, Mapbox, multi-house, Realtime, service-role |
| [ingestion.md](architecture/ingestion.md) | `hearth.documents` + `hearth-documents` bucket, multi-page receipts (`hearth.document_pages`), emergency procedure videos and the separate bucket, document metadata schemas, the `storage_bucket` column rationale, the seven `app/actions/documents/` server actions, Grok 4.3 classify / delta / receipt extraction pipelines, the parallel reasoning-model serial-number decode pipeline, the Smart Uploader modal and its dashboard wiring | Working on document capture, photo / receipt / video ingestion, AI extraction, or anything touching the documents bucket layouts. | Smart Uploader, documents, receipts, emergency video, storage_bucket, content_hash, Grok, serial decode, page-sheet |
| [habitat.md](architecture/habitat.md) | Habitat finding / tile / trigger / modal (including the generic-by-default-slotted-on-demand contract, `getOverviewCards` / `renderDetail` slots, `renderOverviewBody`), module `check()` contract, orchestrator error semantics (terminal vs. retryable), activity-log discipline, methodology page governance, FEMA flood-zone resilience pattern, shared-cache table pattern (`water_systems` / `water_system_violations` / `water_system_lcr_samples` / `water_system_data_fetches`), EPA Superfund Proximity, Canonical contaminants table, Water Quality Awareness | Working on a habitat module, the finding modal, severity, activity logs, the canonical contaminants table, or the shared-cache tables. | habitat, finding modal, module check contract, orchestrator, terminal error, shared cache, FEMA, WQA framework, Superfund, EPA, contaminants, severity, activity log |
| [maintenance.md](architecture/maintenance.md) | The `hearth.maintenance_tasks` event-log semantics, the `reasoning` and `last_synthesis_run` jsonb shapes, the synthesis workflow (`lib/maintenance/*`, why-a-workflow rationale, Build/Rebuild button), the direct-event pipeline (renewal classifier, idempotency chain), the habitat→maintenance synthesis bridge, the dashboard / inventory-detail "On your plate" panel, the History section, the task detail modal and completion sheets | Working on the maintenance module — synthesis prompt, direct-event classifier, tier grouping, completion flows, or the history view. | maintenance, synthesis, direct-event, renewal, reasoning, tier grouping, complete task, mark renewed |
| [inventory-and-reports.md](architecture/inventory-and-reports.md) | Inventory detail page (stat tiles, pill cluster, "What we know" / Research panel, AI Insights, `"unknown"` model_number convention), inventory edit and delete (modal mechanics, manufacture-date input, hero photo selection, research re-run on key-field edits), Property type (vehicles and pets, VIN decode), custom date and month pickers, the Reports hub mockup | Working on inventory rendering, the edit/delete modal, the property subtype, the date pickers, or the Reports page. | inventory detail, photo-as-tile, research panel, edit modal, property, vehicle, pet, VIN decode, date picker, month picker, reports |
| [briefing-and-house-image.md](architecture/briefing-and-house-image.md) | Onboarding action and the first-run discovery modal (phase machine, refresh mode, `HabitatModule.getOnboardingMessage`), the dashboard hero image surface (static SVG illustration when no user photo is present, user-uploaded photo otherwise), the `house-photos` bucket and signed-URL caching contract, and the vestigial `briefing_*` / `generated_image_*` columns left behind by issue #210. | Working on the discovery modal, the house-image surface, or the user-photo upload flow. | onboarding, discovery modal, home setup, house image, static SVG, user photo, signed URL caching, vestigial briefing columns |
| [storage-reconciliation.md](architecture/storage-reconciliation.md) | The scheduled storage sweep that reconciles each private bucket against its owning rows and removes orphans (best-effort-delete failures + the upload-then-insert window), the pure `planStorageRemovals` diff and its three orphan classes, the safety rails (rows-first ordering, age guard, dry-run gate, per-run cap), and the first-cron scaffolding (`vercel.json`, `/api/cron/*` proxy exemption, `CRON_SECRET` gate). | Working on the storage sweep, a storage-backed delete path's best-effort cleanup, or anything that uploads to a private bucket and relies on a row to own the bytes. | storage sweep, orphan, reconciliation, cron, CRON_SECRET, age guard, dry-run, service-role, best-effort delete |
