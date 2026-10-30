# Hearth

Hearth is a homeowner knowledge app. It ingests the paper trail of a house (receipts, appliance nameplates, registrations, photos, video), turns it into a structured inventory with AI-extracted facts, and then goes looking for the things a homeowner does not know to ask about: flood zones, radon risk, nearby Superfund sites, drinking water quality, and the maintenance a house actually needs. The output is a dashboard that reads like a briefing rather than a filing cabinet.

## Try it live

The app itself is invite-only, but its public water quality pages need no account. They run on the same data and the same classification logic the app uses for a signed-in household, keyed to a place instead of a house.

| Public page | Link |
|---|---|
| **Kalamazoo, Michigan** | [hearth.toddtech.llc/water/kalamazoo-mi](https://hearth.toddtech.llc/water/kalamazoo-mi) |
| **Portage, Michigan** | [hearth.toddtech.llc/water/portage-mi](https://hearth.toddtech.llc/water/portage-mi) |
| **Methodology** | [hearth.toddtech.llc/how-it-works](https://hearth.toddtech.llc/how-it-works) |

Each water page shows the utility's EPA compliance record, its lead and copper sampling, PFAS monitoring, every contaminant its annual water quality report lists as detected (each measured against its limit), a filter matrix tailored to what was detected, and the boil-water advisories Hearth's watcher has recorded for the city. Kalamazoo has six years of annual reports on file, so its page also charts the year-over-year trend for each contaminant. The methodology page explains how every finding in the app is classified.

## A one-minute tour

https://github.com/user-attachments/assets/7c64e35c-45f2-4cb4-8f60-75ef16a9db29

## What it does

### Capture

- **Smart Uploader.** Point a phone at an appliance nameplate, a receipt, or a vehicle registration. The photo is classified, the structured record is extracted (manufacturer, model, serial, price, dates), and the result is merged into the inventory, either creating an item or filling in one that already exists. Multi-page receipts and short emergency-procedure videos ("here is the water shutoff") attach to the item they belong to.
- **Serial-number and VIN decode.** A separate pipeline decodes the manufacture date hidden in an appliance serial number. It uses a reasoning model on purpose, because a fast model would invent a plausible encoding rule and apply it confidently. The date is saved only when the decode comes back high-confidence. Vehicles get a VIN decode.

### Understand

- **Inventory detail.** Each item gets a page with its photos, documents, structured facts, and an on-demand Research panel that streams an overview of the model, its typical service life, and its upkeep. A finished research run starts the item's maintenance plan automatically.
- **Habitat findings.** Four public-records modules check the house's location and report what they find as plain-language findings. Each finding opens into a detail view that ends with "How we got here," a step-by-step log of what the module fetched, which rule it applied, and why it landed on that severity, with a citation for every step.

| Module | Source | What it answers |
|---|---|---|
| Water Quality Awareness | EPA CWS service areas, SDWIS, the utility's annual Consumer Confidence Report | What is in my tap water, and what should I do about it? |
| Superfund Proximity | EPA Envirofacts SEMS, EPA Cumulis site profiles | Which contaminated sites are near me, and do they matter for my house? |
| Radon Zone | EPA radon zone map | How likely is elevated radon in my county? |
| Flood Zones | FEMA National Flood Hazard Layer | What flood zone is my parcel in? |

### Act

- **Maintenance plan.** For each item, a durable background job combines the item's research, the house's habitat findings, and its service receipts into a set of recurring tasks with stated reasoning. Habitat data changes the plan: hard water reported in the utility's annual report shortens the cadence for the water heater's anode rod, the softener, and the dishwasher.
- **Renewals.** Documents with an expiration date, such as vehicle registrations and insurance cards, create renewal tasks with no model call. Completing a task chains the next one, so the full history survives.
- **Water quality report.** A downloadable PDF built from the household's water finding. It moves from what was detected, to which filters address it, to who to call.
- **Boil-water advisory alerts.** A watcher checks the city's advisory page every 30 minutes and emails a double-opt-in subscriber list when a district-wide advisory is issued, updated, or lifted.

## Spotlight: water quality and Superfund

### Water Quality Awareness

The water module follows a house's tap water from the utility to the faucet, then tells the homeowner what would help.

- **Finding the utility.** The house's coordinates are matched against EPA's community water system service-area polygons. EPA's map has holes; an established address inside Kalamazoo city limits falls just outside the utility's polygon. When the direct match misses, the module searches a 500 m buffer and takes the nearest utility, but only when there is one clear answer. What the homeowner said during onboarding ("I'm on city water" or "I have a well") outranks the map.
- **EPA's compliance record.** SDWIS violations and 90th-percentile lead and copper samples are pulled for the utility. Any detected lead is flagged as worth knowing, even well under the federal action level, because action levels are regulatory triggers and not safety thresholds. "In compliance" is never enough on its own to call a result favorable. Paperwork and monitoring lapses are shown but do not raise the severity.
- **The annual report, read by AI, shared by everyone.** A homeowner uploads their utility's Consumer Confidence Report as a PDF. Pages are rendered in the browser and a vision model extracts five tightly scoped sections into a strict schema: detected contaminants, the lead and copper distribution, unregulated-contaminant (PFAS) results, a free-testing offer, and header metadata. The prompt tells the model to skip the brochure content (staff bios, infrastructure stories) and the schema rejects it if it slips through. One upload serves every household on that utility, deduplicated by year and by file hash.
- **Honest trends.** Each year's report adds a point to a per-contaminant history, shown as a sparkline that expands into a chart with that year's EPA limit drawn in. A change within 10% reads as stable. A year where a contaminant is missing is not counted as "cleared," because the report may simply not have printed it. Every trend states its exact span ("6 readings, 2020–2025").
- **Which filter actually helps.** A remediation matrix maps 12 contaminant groups against 6 treatment technologies (carbon block, pitcher, reverse osmosis, ion exchange, distillation, UV) and recommends the smallest setup that covers what was detected. That might be a carbon block certified to NSF P473 when PFAS is present, with reverse osmosis added only when fluoride, arsenic, or nitrate calls for it.
- **Boil-water advisories.** The city of Kalamazoo publishes advisories as web pages with no feed. The watcher reads them every 30 minutes through a self-hosted relay (the city's bot protection blocks cloud traffic) and classifies each notice by status and by scope, district-wide or a few streets. It emails subscribers with an idempotency log so a retry never double-sends, and sends an alarm when the watcher itself goes blind, so a broken scrape never passes for a quiet day. The same records feed the public pages and a JSON feed ([example](https://hearth.toddtech.llc/api/water/kalamazoo-mi/advisories)) that a Home Assistant install polls.

### EPA Superfund Proximity

The Superfund module answers "is there a contaminated site near me, and should I care?" without overstating or understating either half.

- **Distance with tiers.** Every National Priorities List site in the house's state is pulled from EPA Envirofacts and measured against the home. Sites within half a mile count at any NPL status, including deleted ones. Sites up to 2 miles count when they are on the final or proposed list, and sites up to 5 miles count only when they are final.
- **Pathways, not just distance.** Each site's contaminants are resolved against a hand-built reference table that records how each chemical tends to reach people: groundwater, vapor intrusion, soil, surface water, or airborne particulate. A solvent plume matters more to a house on a private well. A vapor-intrusion contaminant half a mile away matters more to a house with a basement. Site labels ("Worth acting on," "Worth knowing," "Informational") escalate only when the pathway matches the house.
- **Recommended for your situation.** The same signals produce specific next steps: test your well water, check your utility's water quality report, or check for vapor intrusion. Each one is suppressed when Hearth doesn't know enough about the house to recommend it responsibly.
- **Per-site detail.** Each site opens to its address and status, what sets it apart from the other nearby sites, how its contamination typically spreads, the EPA community involvement coordinator to contact, a link into the site's document library, and its full contaminant list. Some EPA records cover a much larger area than a single point suggests (Allied Paper / Portage Creek / Kalamazoo River spans about 80 miles of river), and those carry a precision caveat.
- **A careful summary.** An AI-written portfolio summary works under hard rules: never claim the property is or isn't contaminated, keep the hedging calibrated, translate EPA status codes into plain English, and stay under four sentences. If the model call fails, the finding still ships without it.

Radon and flood zones are simpler single-answer modules. The FEMA module is built to survive FEMA's unreliable ArcGIS service, with retries and backoff, a 180-day shared cache, and a labeled stale fallback. "FEMA was unreachable" and "FEMA has no map here" stay distinct, and neither is ever reported as good news.

## Design ideas

- **Awareness, not alarm.** Show the regulator's verdict and the raw numbers behind it, so the homeowner can decide for themselves. Detected doesn't mean dangerous, and compliant doesn't mean nothing was found.
- **Show the work.** Every finding carries a first-person log of how it was produced, with sources cited. The public [methodology page](https://hearth.toddtech.llc/how-it-works) documents every classification rule, and changing a rule without updating the page counts as a regression.
- **Never turn missing data into good news.** A failed fetch and an empty result are different states all the way through the code. When data is missing, the result is neutral, not favorable. Trends never claim more history than the records hold.
- **Place-keyed shared caches.** A water system, a FEMA polygon, and a state's Superfund list are the same for every house that shares them. Each is fetched or extracted once and reused, which keeps EPA calls and AI spend flat as households are added.
- **Deterministic where it counts, AI where it helps.** Models extract, summarize, and research. Anything that decides who gets notified or what severity a finding gets is plain, tested code. Non-reasoning models are the default; reasoning models are reserved for the jobs that need them, such as serial-number decode and maintenance synthesis. AI surfaces regenerate when the user asks or when the facts they depend on change, never on every write.
- **Plain language.** No internal codes or system IDs in user-facing copy. Category labels carry tooltips that explain what they mean.
- **Public pages that can't leak.** The public pages are statically generated from a hardcoded slug allowlist and read data server-side at build time, never through an anonymous database policy. Uploader identity never reaches them. Text from an uploaded report is never echoed onto the page; every rendered string is Hearth's own, resolved through the contaminant reference.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router on Turbopack: React 19, Server Components, server actions, React Compiler |
| Language | TypeScript in strict mode |
| Styling | Tailwind CSS v4 on a token-driven design system: dark-mode-first, Fraunces / Inter / JetBrains Mono, a hand-built inline SVG icon set |
| Data and auth | Supabase: Postgres with row-level security on every table, auth, private storage buckets, Realtime |
| AI | Vercel AI SDK v6 and AI Gateway, routing to Anthropic, OpenAI, and xAI with the model chosen per feature |
| Background work | Vercel Workflow for durable multi-step jobs (habitat checks, maintenance synthesis); Vercel Cron for the storage sweep and the advisory watcher |
| Email | Resend |
| Maps | Mapbox address autofill and geocoding |
| Public data | EPA Envirofacts (SEMS, SDWIS, water system inventory), EPA CWS service areas, EPA radon zones, FEMA NFHL |
| Documents | pdf.js for rendering uploaded PDFs in the browser; headless Chromium (Puppeteer) for generated PDF reports |
| Testing and CI | Vitest on pure logic, run by GitHub Actions on every pull request |
| Hosting | Vercel: a preview deployment per branch, production on merge to `main` |

A few details worth calling out:

- Application data lives in a dedicated `hearth` Postgres schema, isolated from Supabase's `auth` and `public` schemas. Every table is RLS-scoped to its owner. The service-role client that bypasses RLS runs only in background jobs and cron, never under a user session.
- The dashboard updates live over Supabase Realtime, with a polling fallback for browsers that block websockets.
- A scheduled reconciliation job diffs each private storage bucket against the rows that own its files and removes orphans. It has an age guard, a dry-run gate, and a per-run cap.
- Admin surfaces are gated three times: in the proxy, in the page, and in RLS.

## How it's built

Hearth is built solo, issue by issue. Every non-trivial change starts as a GitHub issue that serves as a contract (motivation, design, a do-not-change list, acceptance criteria) and ends as a reviewed pull request that closes it. The architecture is documented as a living hub-and-spoke guide that is updated in the same pull request as the code it describes. Coding agents read that guide before touching code.

## Where to look

- [docs/TechnicalGuide.md](docs/TechnicalGuide.md) is the hub: stack, repository layout, cross-cutting invariants, the design system, and an index of the architecture spokes.
- [docs/architecture/](docs/architecture/) holds the spokes, one per domain, each a standalone description of what is built and why. [habitat.md](docs/architecture/habitat.md) covers the Superfund and water quality modules in depth; [public-pages.md](docs/architecture/public-pages.md) and [water-advisories.md](docs/architecture/water-advisories.md) cover the public pages and the watcher.
- [lib/habitat/](lib/habitat/) is the public-data framework: the module contract, the orchestrator, and the EPA and FEMA modules.
- [lib/water-advisories/](lib/water-advisories/) is the advisory watcher: adapters, the pure classifier and diff, and their fixtures.
- [lib/documents/](lib/documents/) is document ingestion: capture, classification, extraction, and the serial-number decode pipeline.
- [workflows/](workflows/) holds the durable jobs built on Vercel Workflow.
- [docs/architecture/storage-reconciliation.md](docs/architecture/storage-reconciliation.md) is the reliability story: how orphaned storage objects are detected and removed safely.

## Development

There is no local Supabase stack. Local `next dev`, Vercel previews, and production all connect to the same remote Supabase project, so schema changes are applied with `supabase db push` and take effect everywhere at once. `.env.example` lists the environment variables the app needs.

```bash
pnpm install
pnpm dev
```

`pnpm test` runs the Vitest suite. `pnpm lint` and `pnpm build` match what CI and Vercel run.

## License

All rights reserved. The source is published for review; see [LICENSE](LICENSE).
