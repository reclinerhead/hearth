# Water advisories

How Hearth watches a municipality's boil-water-advisory page and notifies an admin-managed email list when a district-wide advisory is issued, updated, or lifted (issue #331). This is the first time Hearth acts *for* the homeowner on a schedule rather than answering a question on demand, and the first admin-only surface in the app.

Read this spoke when working on the watcher cron, an advisory adapter, the classifier, the subscriber list, the confirm/unsubscribe token routes, the advisory emails, or the `/admin/water-advisories` page.

---

## Why it exists

On Sept 19–21, 2026 the City of Kalamazoo issued a boil-water advisory covering 19 of its 22 neighborhoods (~30,000 customers) after an E. coli-positive sample. It went out as a news release, a page on the city site, and Facebook. Most residents heard by word of mouth. The city's website exposes no feed (its "Subscribe to this page" is a once-a-day digest), and the county RAVE system was not used. An advisory is inherently PWSID-scoped — it affects everyone on the utility, not one house — so it fits the place-keyed water model the WQA module and the public water pages already use.

## The pipeline

```
Vercel Cron (*/30)  →  /api/cron/water-advisories
                          │
   per enabled source:    ├─ adapter(kind, config)  → ParsedAdvisory[]     (I/O: lib/water-advisories/adapters/*)
                          ├─ classify()             → status + scope       (pure: classify.ts)
                          ├─ planAdvisoryRun()      → upserts + events     (pure: plan.ts)
                          ├─ apply upserts to hearth.water_advisories
                          ├─ notifiable events × confirmed subscribers → water_advisory_notifications row → Resend
                          └─ health bookkeeping on hearth.water_advisory_sources (+ alarm email)
```

The route ([`app/api/cron/water-advisories/route.ts`](../../app/api/cron/water-advisories/route.ts)) is the thin I/O shell — auth, reads, applying the plan, sending, logging. The decisions are pure and tested: HTML → entries ([`parse.ts`](../../lib/water-advisories/parse.ts), against committed fixture snapshots of the city's pages), status/scope ([`classify.ts`](../../lib/water-advisories/classify.ts)), and the diff ([`plan.ts`](../../lib/water-advisories/plan.ts)). **Models never run inside the watcher.** Anything a model does for this feature happens at configuration time (the discovery agent, issue #338), never on the 30-minute path.

## Tables

All in the `hearth` schema, migrations `20260922200000_create_water_advisories.sql` and `20260922230000_add_rss_source_kind_and_portage.sql`.

| Table | Role | RLS |
|---|---|---|
| `water_advisory_sources` | One row per watched city, keyed by PWSID (FK → `water_systems`). `kind` (`opencities_list` \| `rss`) picks the adapter, `config` (jsonb) configures it; `official_alerts_url` / `official_alerts_note` record the city's own signup. Health columns: `last_run_at`, `last_ok_at`, `consecutive_failures`, `last_error`, `failure_alerted_at`. This table *is* "cities on file" for the admin page. | shared-cache: `to authenticated` SELECT, service-role writes, no `anon` |
| `water_advisories` | One row per advisory URL ever seen: title, summary, `status`, `scope`, `published_on`, `on_emergency_banner`, `content_hash`, first/last seen, `last_changed_at`, `raw` capture. | same |
| `water_advisory_subscribers` | The admin-managed list: name, email, optional address fields (stored now, used by a later street-matching increment), `status` (`pending` → `confirmed` → `unsubscribed`), `confirm_token`, `unsubscribe_token`, `created_by`, `added_by_label`. Unique on `(pwsid, lower(email))`. | admin-only via `hearth.is_admin()` for select/insert/update/delete; service-role for cron + token routes |
| `water_advisory_notifications` | Idempotency log: `(advisory_id, subscriber_id, channel, event, content_hash)` unique. `channel` is `email` today (`push` reserved for #332). | admin-only select; service-role writes |

**`hearth.is_admin()`** is a `SECURITY DEFINER` SQL function reading `public.profiles.is_admin` for `auth.uid()`. It exists so admin-only tables have one predicate to gate on; reuse it for any future admin surface rather than inlining the profiles subquery.

## Adapters

Parsing sits behind a per-kind adapter with one signature:

```ts
fetchAdvisories(config, { knownUrls, fetchImpl? }) → Promise<ParsedAdvisory[]>
```

The watcher dispatches on `source.kind` (a `switch` in the route — deliberately no registry, plugin loader, or base class). The shared HTTP fetch, timeout, bot-wall diagnostics, and the per-source proxy opt-in live in [`adapters/fetch.ts`](../../lib/water-advisories/adapters/fetch.ts); each adapter is only "what do I do with the body." A new city is usually a source row; a new *kind* of page is a new adapter file.

| Kind | Config | Cities | Failure semantics |
|---|---|---|---|
| `rss` ([`adapters/rss.ts`](../../lib/water-advisories/adapters/rss.ts)) | `{ feed_url, keywords?, required_keywords?, exclude_keywords?, system_wide_phrases?, use_fetch_proxy? }` | Portage (`MI0005520`, its CivicPlus News Flash feed); Kalamazoo (`MI0003520`, WMUK's news feed — interim, see below) | Throws on non-2xx, a non-XML body, a missing `rss/channel` or `feed` root, or **zero raw items**. A well-formed feed whose items all fail the keyword filter returns `[]` and is a **success** (a city with nothing current). |
| `opencities_list` ([`adapters/opencities-list.ts`](../../lib/water-advisories/adapters/opencities-list.ts)) | `{ list_url, system_wide_phrases?, use_fetch_proxy? }` | none today (Kalamazoo's city page, when a fetch path exists) | Throws on non-2xx, on Akamai's "Access Denied" stub, and on a page that parses to **zero** list entries (the list has never been empty; zero means the markup changed or we got a challenge page). |

**RSS keyword filter.** `keywords` is any-of (default: boil water / do not drink / do not use / water advisory / water notice), matched against title + summary; `required_keywords` is all-of (Kalamazoo uses `["kalamazoo"]` because WMUK is a regional feed); `exclude_keywords` is none-of. Both RSS 2.0 and Atom parse (`fast-xml-parser`, no native deps); `published_on` is the item date as a UTC calendar date; the row is keyed by the item link. Matched keywords land in `raw.matched_keywords` for debugging.

**Adding a CivicPlus city** (most Michigan municipalities): the News Flash feed is `https://<city-site>/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml`; the site's `/rss.aspx` page lists every feed it exposes (Alert Center is `ModID=63&CID=All-alertcenter.xml` and is often empty). Insert a source row with `kind = 'rss'` and that URL; no code.

**Kalamazoo runs on WMUK, for now.** The city's own OpenCities page is the better source (it's the canonical record and carries street-level entries), but it sits behind Akamai and every cloud egress we tested is blocked (see "Bot protection"). WMUK — the local NPR station — publishes an open feed that carried both the issued and the lifted story for the Sept 19–21, 2026 district-wide advisory, one to three hours behind the city. That latency is the honest cost of an open source, and street-level advisories never appear (which is fine while notifications are district-wide only). Switching back is a source-row edit, no code: set `kind = 'opencities_list'`, `config = { list_url, system_wide_phrases, use_fetch_proxy: true }`, and point `WATER_ADVISORY_FETCH_PROXY_URL` at whatever residential-egress path exists by then; delete the source's WMUK-keyed advisory rows first so the switched source seeds silently.

**Official alert channels.** `water_advisory_sources.official_alerts_url` / `official_alerts_note` record the city's own resident-facing signup when one exists (Portage: CivicPlus Notify Me, email + text, account required, advisories ride under News Flash). Advisory emails add a footer line pointing at it and the admin page shows it. Hearth links; it never signs anyone up.

**What the OpenCities adapter reads.** Granicus OpenCities renders the list server-side: `div.list-item-container > article > a[href] > h2.list-item-title + p`. The same page carries the site-wide emergency banner (`div.oc-emergency-announcement-container` → `.emergency-message-box.oc-emergency-severity-NN` with `h3.side-box-title`, `p`, `a[href]`). Banner announcements whose link lives under the list URL are advisories too — on 2026-09-21 the district-wide LIFTED notice was banner-only (its URL was not in the list), so without this the lift would have been missed. Banner appearance also marks a list entry `on_emergency_banner`, which forces district-wide scope. For URLs the store hasn't seen, the adapter fetches the detail page (best-effort, capped per run) to read `Published on Month D, YYYY` and the page `h1`; a detail failure just leaves `published_on` null.

**Bot protection (load-bearing).** The Kalamazoo city site sits behind Akamai Bot Manager, which scores on source IP reputation. Tested 2026-09-22: a home connection running Node `fetch` → 200; Vercel production (AWS) → 403; GitHub Actions (Azure) → 403; a Cloudflare Worker → 403. Assume every cloud egress is blocked. The escape hatch is a fetch proxy: `WATER_ADVISORY_FETCH_PROXY_URL` is a template with a `{url}` placeholder pointing at a service (or a home relay) with residential egress, and a source opts in with `use_fetch_proxy: true` in its config — only the sources that need it pay the hop; open feeds fetch directly. Through the proxy the adapter drops its browser-like headers (the proxy supplies its own fingerprint). A denial is detected by status *or* by the "Access Denied" / reference-id markers in the body, and the thrown error carries the upstream `server` header and a 160-char tag-stripped excerpt so the admin page and the alarm email say *why* without anyone re-running the fetch. Until a proxy path exists, Kalamazoo watches WMUK's feed instead (above). The health alarm below is the backstop for the day whichever path is in use stops working.

**Fixtures.** `lib/water-advisories/fixtures/` holds the list page and one detail page captured 2026-09-22. `parse.test.ts` runs against them, so a template change on the city side fails the suite before it fails production. Refresh the fixture (a Node `fetch` script — see the issue) when updating the parser.

## Classification (`classify.ts`)

- **Status** from the title (then summary): `lifted` (title says lifted/rescinded, or summary says "has been lifted"), else `scheduled`, else `active` for advisory/order/notice/do-not-drink wording, else `unknown`.
- **Scope**, in precedence order: on the emergency banner → `system_wide`; title or summary contains a system-wide phrase → `system_wide`; the title's subject (after the colon) looks like a street list or house-number range → `localized`; else `unknown`.
- The generic phrase list is city-agnostic (`pressure district`, `all customers`, `city-wide`, …). A source adds its own wording through `config.system_wide_phrases` (Kalamazoo: "City of Kalamazoo water customers").

Bias is toward over-notifying: `unknown` is treated as district-wide by the planner. The failure mode we accept is one extra email, never a missed city-wide advisory.

## The plan (`plan.ts`)

`planAdvisoryRun({ stored, parsed, nowIso })` returns upserts and events.

- **Seed silently.** An empty store for a source means "first run": every parsed entry is inserted and no events fire. Otherwise the initial import would email everyone about last month's history.
- **Events.** `issued` — a new URL with status active/scheduled/unknown. `lifted` — a new URL with status lifted, or an existing row whose status flips to lifted (takes precedence over updated). `updated` — an existing URL whose `content_hash` (normalized title + summary; status is not part of it) changed. An entry that disappears from the page is left alone; it never notifies.
- **Notifiable** = scope is `system_wide` or `unknown`. Localized events are recorded and shown on the admin page but not sent — **district-wide only for now**.
- **Scope ratchets up.** Once a row is district-wide (e.g. it was on the banner), a later run that no longer sees the banner does not downgrade it.
- **`raw` merges.** The stored capture is merged under the fresh parse on existing rows, so detail-page fields read only on first sight (`detail_title`) survive later runs; the fresh parse wins for the keys it carries.
- **Idempotency key** is `(advisory, subscriber, channel, event, content_hash)`; the same content can never produce the same event twice.

## Notifications and the dry-run rail

For each notifiable event and each **confirmed** subscriber the route inserts the `water_advisory_notifications` row **before** calling Resend (a `23505` unique violation means "already sent" → skip), sends, then records `sent_at` + `provider_message_id` or `error`. A crash mid-batch and a retried run cannot double-send.

`WATER_ADVISORY_NOTIFY_ENABLED` is the master switch. Anything other than `"true"` is **dry-run**: the watcher records advisories, computes events, and logs every planned send (`event[kind] "title" → N subscriber(s) (dry-run)`), but inserts no notification rows and emails nobody. Events that fire during dry-run are not replayed once the switch flips — they were one-time changes.

**Rollout order:** migration → deploy dry-run → first run seeds silently → add yourself as a subscriber and confirm → "Send test email" from the admin page → review the dry-run logs across a real change on the city page → set `WATER_ADVISORY_NOTIFY_ENABLED=true`.

## Email (`email.ts`)

Resend via the `resend` package; `RESEND_API_KEY` + `WATER_ADVISORY_FROM_EMAIL` (a verified ToddTech sender). Plain text + minimal inline-styled HTML, no template library. Four messages: **issued**, **updated**, **lifted** (the city's title and summary quoted and attributed, the published date, a link to the city's page, boil/bottled guidance on issued/updated, the "{admin} added you" line, a one-click unsubscribe link), the **confirmation** (double opt-in), and the **watcher alarm** / recovery note. Every scraped string is HTML-escaped before it reaches a template.

`added_by_label` is captured on the subscriber row at insert (the admin's OAuth display name, else email) because `public.profiles` carries no name and the cron has no session to ask.

## Token routes (the service-role exception)

`GET /api/advisories/confirm?token=…` and `GET /api/advisories/unsubscribe?token=…` are unauthenticated: the recipient is a neighbor, not a Hearth user, and there is no session. The proxy exempts `/api/advisories/`. The token — 192 random bits, unique per subscriber — is the capability. The handlers validate its shape, look up exactly one row by it, make a one-column state change (`pending → confirmed`, or `→ unsubscribed`, idempotent), and return a tiny self-contained HTML page ([`token-page.ts`](../../lib/water-advisories/token-page.ts)). They use the **service-role client**, which the hub invariant otherwise confines to background work; the exception is allowed here for the same reason the cron has it — no session exists to bind RLS to — and the write surface is one row matched by an unguessable token.

## Watcher health and the alarm

Every run updates the source's health columns. A fetch/parse failure (or a DB failure after the fetch) increments `consecutive_failures` and stores `last_error`; a success resets both. When failures reach `WATER_ADVISORY_FAILURE_ALERT_AFTER` (default 2 — about an hour at the 30-minute cadence) the route emails `WATER_ADVISORY_ALERT_EMAIL` once (`failure_alerted_at`), and once more when a run succeeds again. This is independent of the notify switch: silence must never look like "no advisory." Both emails state **how long the watcher has been blind** (since `last_ok_at`, in Eastern time) so a nightly window and a random blip look different in the inbox without Vercel logs (issue #349).

**One in-run retry, network failures only** ([`adapters/fetch.ts`](../../lib/water-advisories/adapters/fetch.ts)). A connect timeout, reset, or DNS hiccup against a single-homed civic origin is usually a blip — Portage (one IPv4 address, no CDN) flapped overnight on 2026-09-23 with every re-run succeeding. `fetchText` therefore retries such failures once after a short pause and logs the outcome; a run that needed the retry is a late run, not a failed one. **HTTP responses are never retried**: a 403 (bot wall) or a 5xx is the origin's decision, and retrying is how an address earns a permanent block. The alarm threshold is unchanged — an hour of real blindness still emails.

## Render surfaces: the finding and the public page (issue #347)

The watcher's rows are shown in two places besides the admin page, both fed by one pure derivation.

**`buildAdvisoryTimeline(rows, nowIso, { limit, openWindowDays })`** ([`timeline.ts`](../../lib/water-advisories/timeline.ts), client-safe, tested) turns a PWSID's rows into display items, **oldest first** (newest at the bottom), capped at 4 by default with open items never dropped. The watcher stores "issued" and "lifted" as separate rows (the city and the news feed publish them as separate pages), so a lifted row is **paired** with the most recent still-open issued row of the same scope class: district-wide/unknown pair with each other; localized rows pair only when their titles share a street or number token (`subjectTokens`), so a Rose Arbour lift never closes a Baker St notice. A lift with nothing to close stands alone (Portage's Sept 10 lift, whose issued notice predates the watcher). **Open** = an unpaired active/scheduled row issued within the last 14 days; older unpaired rows read "no lift recorded" rather than as active, because the source may never have posted a lift. `describeAdvisorySource(kind, config)` produces the one honest sentence about the source — the city's own page, the city's own feed (`.gov`/`.us`), or a newsroom feed with the one-to-three-hour caveat — derived from the source row, never hardcoded per city.

**In-app** — `WqaAdvisoriesSection` ([`advisories-section.tsx`](../../lib/habitat/modules/water-quality-awareness/components/advisories-section.tsx)) renders directly under the "Your water system" card on the `cws_no_ccr` / `cws_with_ccr` / `non_community` branches. It fetches **live on open** through the browser client (both tables are `to authenticated` SELECT): the source row (kind, config, `created_at`) and the 20 most recent advisories. Advisories change on the watcher's schedule, independently of `check()`, so they are deliberately not part of the persisted finding payload. Not-watched cities render nothing; watched-but-empty renders one quiet line with the watching-since date. An open item is featured in the warning tone (never the accent, never the AI surface) with an "Active now" chip and the boil/bottled guidance. Scope pills carry tooltips.

**Public page** — `AdvisoriesSection` in [`app/(public)/water/[systemSlug]/page.tsx`](../../app/(public)/water/[systemSlug]/page.tsx) renders the same items after "At a glance", server-side with no client JS. `resolveAdvisories(pwsid)` in `water-data.ts` reads through the service-role client at generation time (same posture as the other place-keyed reads; the PWSID comes from the slug allowlist), soft-failing to `null` so an outage renders as "wasn't reachable", never as "no advisories". `buildAdvisoriesBlock` in `water-summary.ts` applies the public text discipline: titles capped at 160 chars, summary only on an open item and capped at 240, nothing else from the scraped row serialized (pinned by test, including "no PWSID"). The text is third-party (city or newsroom), not user-contributed, so hard rule 4's injection concern is lighter — but it is external free text on an indexed page, so it is capped, attributed, and the page links out rather than quoting more.

**Caching.** The public page keeps `revalidate = 86400`. The cron calls `revalidatePath("/water/<slug>")` **only** when a run recorded new or changed rows for a PWSID that resolves through the slug registry — unchanged runs (nearly all of them) trigger nothing, so an advisory appears within the half hour while the page never rebuilds on a schedule.

## Admin page (`/admin/water-advisories`)

The first admin-only surface. Gated in the proxy (`/admin/*` → `profiles.is_admin`), re-checked in the page, reached from the account dropdown's "Water advisories" entry (rendered only when `capabilities.isAdmin`). Per city: the watcher's mode (dry-run vs live, email configured), last check and health, the recent advisories with status/scope pills (tooltips explain the categories), and the subscriber list with **Add** (name, email, optional address — plain inputs, no Mapbox), **Remove** (confirmed → `unsubscribed`; never-confirmed → deleted), **Resend confirmation** (pending only), and **Send test email to me** (renders the issued template against the latest stored advisory and sends it to the signed-in admin, bypassing the list — the way Resend wiring is verified before going live).

Server actions under `app/actions/water-advisories/` run under the session client; the RLS policies are the real gate and `requireAdmin` exists for readable errors and the admin's display label.

Timestamps on the page are formatted **after mount** (the `When` component): the server renders in UTC, and React keeps a mismatched text node as the server wrote it on hydration, so a server-side `toLocaleString` would silently show UTC as if it were local. Until the effect runs, the string is explicitly labelled UTC.

## Environment variables

| Var | Default | Role |
|---|---|---|
| `CRON_SECRET` | — (required) | Bearer token, shared with the storage sweep. |
| `RESEND_API_KEY` / `WATER_ADVISORY_FROM_EMAIL` | — | Resend credentials + verified sender. Required for any email. |
| `WATER_ADVISORY_ALERT_EMAIL` | — | Recipient of the watcher-blind alarm. |
| `WATER_ADVISORY_FAILURE_ALERT_AFTER` | `2` | Consecutive failures before the alarm. |
| `WATER_ADVISORY_FETCH_PROXY_URL` | unset (direct) | Proxy template with `{url}`; used only by sources with `use_fetch_proxy: true`. Needed before Kalamazoo can return to its city page. |
| `WATER_ADVISORY_NOTIFY_ENABLED` | unset (dry-run) | `"true"` enables subscriber sends. |

## Not built here (follow-ups)

Agent-based source discovery (#338), web push (#332), street-level matching against subscriber addresses, a live "active advisory" banner on the public water page and the in-app WQA finding, and a residential-egress fetch path for the Kalamazoo city page (a home relay on the basement server was designed and deferred). Social-media ingestion was evaluated and rejected (no read API, terms problems, and social is downstream of the city page).
