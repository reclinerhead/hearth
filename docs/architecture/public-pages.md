# Public pages

The public, unauthenticated, place-keyed pages under `app/(public)/` — the SEO-indexable surface that exposes Hearth's habitat intelligence for a *place* rather than a *house* (epic #298). Phase 1 ships the water system page (`/water/kalamazoo-mi`) plus the foundations: the public route group and layout, the slug allowlist, the proxy exemptions, and the SEO plumbing (sitemap, robots, canonical URLs).

Read this spoke when working on anything under `app/(public)/`, the slug registry, the public data read paths, or the sitemap/robots files.

---

## The invariants (epic #298 hard rules)

These are non-negotiable for every public page, current and future:

1. **Place-keyed, never house-keyed.** No public render path reads `hearth.habitat_findings`, `hearth.houses`, or any house-scoped table.
2. **No user-identifying data.** No uploader identity, no contributor counts ("report on file" is a boolean on public pages — "contributed by N homeowners" is in-app only), and `hearth.water_system_report_contributors` is never queried from a public path.
3. **No machine identifiers in URLs or copy.** Slugs are human (`kalamazoo-mi`); PWSIDs stay internal.
4. **No CCR extraction free-text on the page.** `extracted_data` is user-contributed content (whatever PDF someone uploaded); this is the content-injection defense — a crafted upload must not be able to place attacker-chosen text on an indexed, ToddTech-branded page. Public pages render full per-contaminant detail (issue #303 retired the old summary-level clause), but every rendered string is Hearth's own: names, descriptions, and EPA links resolve through the canonical contaminants reference (`findWqaContaminantByAlias`), units pass a small allowlist, and everything else is a validated number or one of our own labels. A displayed row that fails reference resolution or unit normalization is **omitted from the named list and rolled into an honest count** ("N more measured parameters appear in the report"). System names come from EPA's `pws_name`, never from the CCR.
5. **Utility contact is name + phone only, never email.** *(Amended alongside #303: the original "no admin contact at all" was relaxed so the civic "what you can do next" block can carry a callable number.)* Public pages may show the EPA-listed administrator **name and phone** — a resident calling their utility is the point. The **email is never published** (`water_systems.email_addr` is the harvest vector rule 7 most guards against, and adds the least value over a phone). The contact is gated on a phone being on file and carries no PWSID (rule 3).
6. **No server actions or route handlers in `app/(public)/`.** A server action on a public page is an unauthenticated POST endpoint. Every CTA is a link (to `/login` or an anchor).
7. **No cookies/session reads.** Public pages must stay statically renderable; the layout and every page under the group never touch `cookies()` or a Supabase session client. The sign-in CTA is a plain link — `/login` routes authed users onward itself.

The privacy-sensitive subset is pinned by tests: `lib/public-pages/water-summary.test.ts` asserts the view model carries the utility contact name + phone but never the admin email or the PWSID.

## Route group and layout

`app/(public)/layout.tsx` is the lightweight public frame: wordmark header with a sign-in CTA, 860px content column, "Powered by ToddTech" footer (links via `TODDTECH_HEARTH_URL` from `lib/reports/constants.ts`). No AppShell, no data reads.

`/how-it-works` **moved** into the group (from `app/(app)/`) rather than being mirrored — the page is pure static content with no data reads, and route groups don't affect URLs so existing links and the `/about/classification` redirect keep working. Signed-in users see the public frame on that one page; acceptable for a document-style page.

**Proxy exemptions** live in `isPublicRoute` in [lib/supabase/proxy.ts](../../lib/supabase/proxy.ts): `/water` (segment-exact + prefix), `/how-it-works`, and the crawler entry points `/sitemap.xml` + `/robots.txt` (which otherwise 307 to `/login` — the root matcher only excludes `_next` internals and image files). Segment-exact matching on purpose: a bare `startsWith("/water")` would also exempt a future `/water-adjacent` authenticated route.

## Slug allowlist

[lib/public-pages/slugs.ts](../../lib/public-pages/slugs.ts) is the single mapping between human slugs and internal keys (PWSID today; county keys seeded for Phase 2). It is deliberately a hardcoded allowlist: `generateStaticParams` reads it and the route sets `dynamicParams = false`, so an unknown slug 404s at the router **before any data access runs** — no user input ever reaches a database or EPA query on a public route, and there's no ISR-cache amplification for garbage slugs. Phase 3's Michigan scale-out grows this registry (generated from the EPA CWS dataset) rather than adding a second resolution mechanism.

## Data access posture

The shared-cache RLS policies are `to authenticated` SELECT-only and **stay that way** — do not add `anon` policies (they would open the PostgREST endpoint to bulk scraping with the public anon key, and `water_system_reports.uploaded_by` is an `auth.users` UUID that must never be anon-readable).

Public pages instead read **server-side via the service-role client at static-generation / ISR-revalidate time**, through the WQA module's existing cache wrappers ([lib/public-pages/water-data.ts](../../lib/public-pages/water-data.ts) → `resolveWaterSystem` / `resolveViolations` / `resolveLcrSamples` / `resolveCcrHistory`). This is safe by construction: the PWSID comes from the slug allowlist, the route is fully static (the service client never runs per-request), and the CCR history read selects only extraction columns (no `uploaded_by`, no `content_hash`). `resolveCcrHistory` (every uploaded year, not just the latest) is what powers the public year-over-year trends (issue #303). The EPA-backed wrappers fetch-from-EPA-on-miss, which makes an unpopulated system's page self-seeding at ISR time — the mechanism Phase 3 depends on.

The SDWIS fetches run in `Promise.allSettled` with independent soft-fail (same discipline as the module's `check()`): a failed violations fetch renders as "couldn't read EPA's record", never as "no violations". When EPA has no inventory record at all, the page renders an honest "temporarily unavailable" state rather than a 404 — a transient EPA outage at revalidate time shouldn't take the page down.

## View model

[lib/public-pages/water-summary.ts](../../lib/public-pages/water-summary.ts) (`buildPublicWaterSummary`) is the pure derivation from raw place-keyed data to what the page renders: identity (EPA inventory), compliance block, lead/copper readings, PFAS block, the full detected list, CCR summary block. It reuses the WQA module's pure summarizers and trend module (`summarizeCompliance`, `summarizeLcr`, `buildCcrFindings`, `buildDisplayedCcrContaminants`, `classifyLcrAxis`, `buildContaminantHistory`, `computeTrend`, `applyTrendEscalation`) so the public page and the in-app finding can't drift on what counts as detected / approaching / above a limit / trending.

**The detected block (issue #303)** carries full per-contaminant rows for the latest report year: canonical name, tier (with the same rising-trend escalation the in-app check applies), numeric level + allowlisted unit, the limit the report states, reference description + EPA link, and a sanitized trend (`direction`, our own word/tone/span labels, prior reading, and `{year, level}` points that drive a static server-rendered SVG sparkline). PFAS analytes fold into one family card (2+ analytes, level-descending, copy from the "PFAS" reference entry) mirroring `groupPfasFamily`. Rows that fail canonical resolution or unit normalization land in `omittedCount` / `omittedAnyConcern`, rendered as a count line — the enforcement point for hard rule 4. The PFAS news block derives its trend tallies (`falling` / `rising` / `stable` / `inconclusive`) from the same rows, so the "N of M trending down" sentence is computed, never hand-written.

**The remediation block** (issue #303 follow-up) reuses the WQA-5 pure helpers (`personalizeRemediationMatrix`, `recommendRemediationCombination`) to bring the "which filter addresses what, and the best-value combination" analysis to the public page — deliberately *not* paywalled, since it's the most directly useful thing the module produces. Its inputs are built from the already-sanitized detected rows (canonical name for matching, a level label from a validated number + allowlisted unit), so nothing the matcher sees or the recommender renders is extraction free-text. It's `none` when there's no CCR or nothing detected maps onto a matrix row. The page renders it **server-side** (a plain server component, not the in-app client `RemediationMatrixView`) so the route stays fully static — no client JS, no per-visitor compute.

**The utility contact block** carries `{ name, phone }` from the EPA record (see hard rule 5 above) for the civic next-steps section, gated on a phone being present.

Fetch-failed and zero-rows are distinct states throughout (`null` vs `[]` inputs) so the page never converts an outage into a favorable claim. The privacy-and-injection invariants are pinned by tests in `water-summary.test.ts`: the admin email and PWSID never in the view model; attacker-chosen contaminant names and out-of-allowlist units never survive into the detected list or the remediation inputs.

## Rendering and caching

`/water/[systemSlug]` is SSG + ISR: `revalidate = 86400` (hours-stale is fine per the epic; the page says so in its "About this data" line), `dynamicParams = false`. Zero marginal compute per pageview. A future nicety (epic open question): `revalidateTag` from `finalize-ccr-upload` so a newly-landed CCR refreshes the page immediately.

## SEO plumbing

- `metadataBase` on the root layout, resolved by [lib/public-pages/site-url.ts](../../lib/public-pages/site-url.ts): `NEXT_PUBLIC_SITE_URL` override → `VERCEL_PROJECT_PRODUCTION_URL` (production host, injected in every Vercel environment including previews) → localhost. Canonicals therefore point at production even on previews; Vercel's `X-Robots-Tag: noindex` keeps previews out of the index regardless.
- [app/sitemap.ts](../../app/sitemap.ts) lists the landing page, `/how-it-works`, and every slug in the registry. [app/robots.ts](../../app/robots.ts) allows the public surfaces and disallows the session-bound route prefixes.
- Per-page `generateMetadata` on the water route emits title/description/canonical/OG/twitter tags. Generated OG images are Phase 4 — when they land, the OG route's only input must be the slug, resolved through the same allowlist (no free-text query params).

## What Phase 1 deliberately does not do

Radon and Superfund place sections (Phase 2, sibling topical routes sharing the resolver), programmatic Michigan scale-out (Phase 3), OG image generation and public PDF snapshots (Phase 4). The county entries in the slug registry are seeded but unconsumed. The interactive trend-chart popover remains in-app — the public page's trends are static server-rendered sparklines. (The remediation matrix and full per-contaminant detail, once slated to stay signed-in, are now public per #303.) The "flood risk is address-specific" teaser and the "see this for your own house" signup band were removed from the water page by request — the header sign-in link and the CCR "add a report" CTA carry conversion for now.
