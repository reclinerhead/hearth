# Public pages

The public, unauthenticated, place-keyed pages under `app/(public)/` — the SEO-indexable surface that exposes Hearth's habitat intelligence for a *place* rather than a *house* (epic #298). Phase 1 ships the water system page (`/water/kalamazoo-mi`) plus the foundations: the public route group and layout, the slug allowlist, the proxy exemptions, and the SEO plumbing (sitemap, robots, canonical URLs).

Read this spoke when working on anything under `app/(public)/`, the slug registry, the public data read paths, or the sitemap/robots files.

---

## The invariants (epic #298 hard rules)

These are non-negotiable for every public page, current and future:

1. **Place-keyed, never house-keyed.** No public render path reads `hearth.habitat_findings`, `hearth.houses`, or any house-scoped table.
2. **No user-identifying data.** No uploader identity, no contributor counts ("report on file" is a boolean on public pages — "contributed by N homeowners" is in-app only), and `hearth.water_system_report_contributors` is never queried from a public path.
3. **No machine identifiers in URLs or copy.** Slugs are human (`kalamazoo-mi`); PWSIDs stay internal.
4. **Derived values only from CCR extractions.** `extracted_data` is user-contributed content (whatever PDF someone uploaded), so public pages render counts, years, booleans, and computed enum statuses from it — never free-text strings. System names come from EPA's `pws_name`, never from the CCR. This is the content-injection defense: a crafted upload must not be able to place attacker-chosen text on an indexed, ToddTech-branded page.
5. **No utility admin contact.** `water_systems.admin_name` / `email_addr` / `phone_number` serve the in-app "find your CCR" surface; on a public page they'd be a spam-harvest surface and read adversarial to the utility-ally framing. Org-level identity only.
6. **No server actions or route handlers in `app/(public)/`.** A server action on a public page is an unauthenticated POST endpoint. Every CTA is a link (to `/login` or an anchor).
7. **No cookies/session reads.** Public pages must stay statically renderable; the layout and every page under the group never touch `cookies()` or a Supabase session client. The sign-in CTA is a plain link — `/login` routes authed users onward itself.

The privacy-sensitive subset is pinned by tests: `lib/public-pages/water-summary.test.ts` asserts the view model never carries admin contact fields or the PWSID.

## Route group and layout

`app/(public)/layout.tsx` is the lightweight public frame: wordmark header with a sign-in CTA, 860px content column, "Powered by ToddTech" footer (links via `TODDTECH_HEARTH_URL` from `lib/reports/constants.ts`). No AppShell, no data reads.

`/how-it-works` **moved** into the group (from `app/(app)/`) rather than being mirrored — the page is pure static content with no data reads, and route groups don't affect URLs so existing links and the `/about/classification` redirect keep working. Signed-in users see the public frame on that one page; acceptable for a document-style page.

**Proxy exemptions** live in `isPublicRoute` in [lib/supabase/proxy.ts](../../lib/supabase/proxy.ts): `/water` (segment-exact + prefix), `/how-it-works`, and the crawler entry points `/sitemap.xml` + `/robots.txt` (which otherwise 307 to `/login` — the root matcher only excludes `_next` internals and image files). Segment-exact matching on purpose: a bare `startsWith("/water")` would also exempt a future `/water-adjacent` authenticated route.

## Slug allowlist

[lib/public-pages/slugs.ts](../../lib/public-pages/slugs.ts) is the single mapping between human slugs and internal keys (PWSID today; county keys seeded for Phase 2). It is deliberately a hardcoded allowlist: `generateStaticParams` reads it and the route sets `dynamicParams = false`, so an unknown slug 404s at the router **before any data access runs** — no user input ever reaches a database or EPA query on a public route, and there's no ISR-cache amplification for garbage slugs. Phase 3's Michigan scale-out grows this registry (generated from the EPA CWS dataset) rather than adding a second resolution mechanism.

## Data access posture

The shared-cache RLS policies are `to authenticated` SELECT-only and **stay that way** — do not add `anon` policies (they would open the PostgREST endpoint to bulk scraping with the public anon key, and `water_system_reports.uploaded_by` is an `auth.users` UUID that must never be anon-readable).

Public pages instead read **server-side via the service-role client at static-generation / ISR-revalidate time**, through the WQA module's existing cache wrappers ([lib/public-pages/water-data.ts](../../lib/public-pages/water-data.ts) → `resolveWaterSystem` / `resolveViolations` / `resolveLcrSamples` / `resolveLatestCcr`). This is safe by construction: the PWSID comes from the slug allowlist, the route is fully static (the service client never runs per-request), and `resolveLatestCcr` selects only extraction columns (no `uploaded_by`, no `content_hash`). The wrappers fetch-from-EPA-on-miss, which makes an unpopulated system's page self-seeding at ISR time — the mechanism Phase 3 depends on.

The SDWIS fetches run in `Promise.allSettled` with independent soft-fail (same discipline as the module's `check()`): a failed violations fetch renders as "couldn't read EPA's record", never as "no violations". When EPA has no inventory record at all, the page renders an honest "temporarily unavailable" state rather than a 404 — a transient EPA outage at revalidate time shouldn't take the page down.

## View model

[lib/public-pages/water-summary.ts](../../lib/public-pages/water-summary.ts) (`buildPublicWaterSummary`) is the pure derivation from raw place-keyed data to what the page renders: identity (EPA inventory), compliance block, lead/copper readings, PFAS status, CCR summary block. It reuses the WQA module's pure summarizers (`summarizeCompliance`, `summarizeLcr`, `buildCcrFindings`, `buildDisplayedCcrContaminants`, `classifyLcrAxis`) so the public page and the in-app finding can't drift on what counts as detected / approaching / above a limit. The CCR contaminant count uses `buildDisplayedCcrContaminants` (regulated table + UCMR detections + lead/copper, deduped) — the same list the in-app "Detected in your water" panel shows.

Fetch-failed and zero-rows are distinct states throughout (`null` vs `[]` inputs) so the page never converts an outage into a favorable claim.

## Rendering and caching

`/water/[systemSlug]` is SSG + ISR: `revalidate = 86400` (hours-stale is fine per the epic; the page says so in its "About this data" line), `dynamicParams = false`. Zero marginal compute per pageview. A future nicety (epic open question): `revalidateTag` from `finalize-ccr-upload` so a newly-landed CCR refreshes the page immediately.

## SEO plumbing

- `metadataBase` on the root layout, resolved by [lib/public-pages/site-url.ts](../../lib/public-pages/site-url.ts): `NEXT_PUBLIC_SITE_URL` override → `VERCEL_PROJECT_PRODUCTION_URL` (production host, injected in every Vercel environment including previews) → localhost. Canonicals therefore point at production even on previews; Vercel's `X-Robots-Tag: noindex` keeps previews out of the index regardless.
- [app/sitemap.ts](../../app/sitemap.ts) lists the landing page, `/how-it-works`, and every slug in the registry. [app/robots.ts](../../app/robots.ts) allows the public surfaces and disallows the session-bound route prefixes.
- Per-page `generateMetadata` on the water route emits title/description/canonical/OG/twitter tags. Generated OG images are Phase 4 — when they land, the OG route's only input must be the slug, resolved through the same allowlist (no free-text query params).

## What Phase 1 deliberately does not do

Radon and Superfund place sections (Phase 2, sibling topical routes sharing the resolver), programmatic Michigan scale-out (Phase 3), OG image generation and public PDF snapshots (Phase 4). The county entries in the slug registry are seeded but unconsumed. CCR content on the public page stays summary-level (headline status + counts) — full per-contaminant readings and trends remain the signed-in experience, revisit after launch per the epic.
