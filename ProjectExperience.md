# Project Experience — Hearth

**What:** a homeowner document- and knowledge-management web application — a production SaaS-shaped product, designed, built, and operated solo
**Active:** May 2026 – present · deployed to production on Vercel · ~320 issues/PRs merged
**Last updated:** 2026-08-20 · updated after milestones, not every change (see AGENTS.md)

> **Purpose of this file.** A self-contained, factual summary of this project and the skills it demonstrates, written to be pasted into an AI session for resume building, cover letters, or interview prep. Every claim is accurate and interview-defensible. Two lenses matter: **skills demonstrated** (shipped and running) and **skills in development** (actively being explored).

## The project in three paragraphs

Hearth helps homeowners organize, understand, and act on information about their homes. It combines document ingestion — point a phone at an appliance nameplate or a receipt and AI extracts the structured record — with proactive education: the app checks public records the owner doesn't know to ask about (EPA radon zones, Superfund site proximity, FEMA flood zones, drinking-water quality) and turns what it finds into plain-language findings and a synthesized maintenance plan. It is the portfolio project closest to a commercial product: real auth, a free-tier gate, multi-property support, public SEO pages, and destructive-action safeguards designed for strangers rather than for the author.

Technically it is a modern full-stack TypeScript application: Next.js (App Router, React Server Components and server actions, React Compiler) on Vercel, Supabase for Postgres, auth, row-level security, storage, and realtime, and a multi-provider AI layer (Anthropic, OpenAI, xAI through one gateway) with durable background jobs for the long-running work. The app's data lives in a dedicated Postgres schema with RLS throughout; the dashboard updates live over websockets with a polling fallback; and a scheduled reconciliation job sweeps storage for orphaned files so best-effort cleanup paths can never silently leak.

The product surface is deliberately designed, not defaulted: a custom design-token system (dark-mode-first, a single earned accent color, serif/sans/mono type roles), a hand-built inline SVG icon set instead of an icon-library dependency, and accessibility decisions made the right way — e.g., preventing iOS Safari's form auto-zoom with a 16px font floor rather than disabling pinch-zoom for low-vision users.

## Skills demonstrated

### Full-stack product engineering
- Built and operates a complete production web application solo: Next.js App Router with React Server Components, server actions, and route groups separating the authenticated app from public SEO surfaces; ~320 issues/PRs merged since May 2026.
- Shipped real product mechanics, not demo features: onboarding with address autocomplete (Mapbox) and public-records lookup, multi-property accounts with an active-property switcher, free-tier gating, and a typed-confirmation delete flow for irreversible actions ("retype your address to delete this property").
- Built programmatic public pages: place-keyed, SEO-indexable water-quality profiles rendered with static generation + incremental revalidation, backed by a slug allowlist, sitemap, robots, and canonical-URL plumbing.

### Database & backend architecture (Postgres / Supabase)
- Designed a multi-tenant data layer on Postgres with row-level security throughout, isolated in a dedicated application schema — including the non-obvious operational work: explicit grants so Realtime can see custom-schema rows, and a strict schema-qualification discipline in every migration.
- Practices production-grade migration discipline against a live shared database (local dev, previews, and production all read the same remote instance): forward-only additive migrations, reviewed before push, types regenerated and committed alongside.
- Enforces a privilege boundary between request-path and background code: the RLS-bypassing service-role client is confined to background jobs and cron, while all user-session code stays behind cookie-bound, RLS-enforced clients.
- Designs deletion correctly: database-owned cascades handle relational cleanup in one transaction; the two things that can't cascade (storage objects, cross-schema references) are handled explicitly, with a scheduled reconciliation sweep as the backstop for best-effort failures.

### AI engineering
- Built AI document-ingestion pipelines: a "Smart Uploader" flow where a phone photo of an appliance nameplate or receipt is classified, extracted to a structured record, and delta-merged into the user's inventory — plus a separate serial-number decode pipeline that deliberately uses a reasoning model where determinism matters.
- Runs a multi-provider AI layer (Anthropic, OpenAI, xAI) behind one gateway with per-feature model selection via environment variables — models are swappable without code changes.
- Engineers for AI cost deliberately: non-reasoning models by default, reasoning models only where they earn their cost, and lazy re-analysis — AI surfaces regenerate on user demand or coordinated invalidation (a key-field edit clears stale insights), never on every row write.
- Uses durable background workflows (Vercel Workflow SDK) for long-running AI work such as maintenance-plan synthesis, with idempotency chains on event-driven pipelines so retries can't double-write.

### Public-data integration & domain modeling
- Built a pluggable "habitat" framework that checks a home's location against public datasets — EPA radon zones, EPA Superfund proximity, FEMA flood zones, drinking-water systems and their violation histories — where each source is a self-contained module behind a common contract and an orchestrator with explicit terminal-vs-retryable error semantics.
- Designed shared-cache tables so expensive third-party dataset fetches are stored once and reused across all users' houses, with fetch-tracking for staleness.
- Bridges data to action: habitat findings feed the AI maintenance-plan synthesis, turning "your area has X" into "here's what to do about it."
- Maintains a public methodology page explaining how findings are derived — treating transparency about data provenance as part of the product.

### Frontend engineering & design systems
- Built a token-based design system (CSS custom properties projected through Tailwind): dark-mode default with a light theme, three surface tiers including a distinct visual treatment for AI-authored content, a typographic scale with serif display / sans body / mono identifiers, and one accent color reserved for affordances that earn attention.
- Ships a hand-built inline SVG icon set instead of a runtime icon-library dependency, and reusable UI primitives (metric cards, timeline items, modals with focus traps and scroll locks) shared across the app.
- Solves mobile correctly: safe-area-aware navigation, phone-first capture flows, and the iOS Safari form-zoom fix done via a 16px input floor under coarse-pointer media queries — explicitly rejecting the common `maximum-scale=1` hack that breaks pinch-zoom for low-vision users.
- Real-time UI: Supabase Realtime subscriptions drive the dashboard, with a polling fallback for blocked websockets, a custom cross-component refresh event, and React key-based remounting to handle active-property switches cleanly.

### Reliability & operations
- Wrote a scheduled storage-reconciliation job that diffs each private bucket against its owning database rows and removes orphans — with the diff logic as a pure, unit-tested function and layered safety rails: rows-first ordering, an age guard, a dry-run gate, and a per-run cap.
- CI runs the test suite on every PR; every feature branch gets an isolated preview deployment; merge to main is the production deploy.

### Engineering process & documentation
- Issue-driven development end to end: every non-trivial change starts as a GitHub issue with an explicit contract (motivation, design, do-not-change list, acceptance criteria) and ends with a reviewed PR that closes it.
- Maintains hub-and-spoke living documentation — a stable hub (stack, invariants, design system, deployment) plus eight domain spokes updated in the same commit set as the code they describe.
- Practices deliberate **context engineering** for AI-assisted development: those truth documents are what coding agents read before touching code and must update as part of every change — plan first, read the docs, implement, update the docs. Adopted after experiencing the rework cost of AI-assisted work without maintained context; accuracy went up and re-dos went down.
- Selective, high-value testing: pure logic with non-obvious behavior gets Vitest coverage beside the source; orchestration and thin wrappers deliberately don't.

## Skills in development (actively exploring)

- **Programmatic SEO** — growing the public, place-keyed page surface as an organic-acquisition channel for the product.
- **Document OCR & routing** — extending ingestion beyond nameplates and receipts to manuals, permits, and invoices, with per-kind extraction pipelines.
- **Public-records data engineering** — each new dataset (assessor records, lead-disclosure heuristics, water-system violations) is a new module against the existing framework; the craft being refined is turning messy government data into trustworthy user-facing findings.
- **Productization** — free-tier boundaries, upsell surfaces, and the operational posture (safeguards, transparency, cost control) of an app built for strangers rather than for its author.
- **Context engineering** — refining the practice of structuring and maintaining project knowledge for AI coding agents (truth documents, issue contracts, agent memory) into a repeatable discipline — likely a core professional skill as AI-assisted development matures.

## Technology inventory

TypeScript (strict) · Next.js App Router / React 19 / React Server Components / React Compiler / Turbopack · Tailwind CSS v4 + design tokens · Supabase (Postgres, RLS, GoTrue auth, Storage, Realtime) · Vercel (hosting, preview deployments, cron) · Vercel AI SDK + AI Gateway (Anthropic / OpenAI / xAI) · Vercel Workflow SDK (durable background jobs) · Mapbox (address autofill / geocoding) · public datasets: EPA (radon, Superfund), FEMA (flood zones), SDWIS-family drinking-water data · Vitest · GitHub Actions CI · pnpm
