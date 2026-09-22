-- Generic RSS adapter + Portage + Kalamazoo's interim source (issue #337).
--
-- 1. Widen water_advisory_sources.kind to admit 'rss'.
-- 2. Record each source's official resident-facing alert channel so the
--    advisory emails can point subscribers at it when one exists.
-- 3. Seed Portage on its CivicPlus News Flash feed.
-- 4. Switch Kalamazoo from the OpenCities list page to WMUK's news feed.
--
-- Why Kalamazoo moves to a news feed: the city page sits behind Akamai
-- Bot Manager, which rejects every cloud egress we tested (Vercel/AWS,
-- GitHub Actions/Azure, a Cloudflare Worker) — see issue #341. WMUK (the
-- local NPR station) publishes an open feed that carried both the
-- issued and the lifted story for the Sept 19–21, 2026 district-wide
-- advisory, one to three hours behind the city. That latency is the
-- honest cost of an open source; the OpenCities adapter stays in the
-- codebase and the proxy hook (WATER_ADVISORY_FETCH_PROXY_URL +
-- use_fetch_proxy) is how the city page comes back without code changes.
--
-- The five Kalamazoo advisory rows seeded from the city page during PR
-- verification are deleted here. They were a one-off snapshot, not
-- watcher history, and leaving them would make the first WMUK run see a
-- non-empty store and fire "issued"/"lifted" events for two stories
-- from three days ago instead of seeding silently. No notifications
-- reference them (the log is empty; the FK cascades regardless).

alter table hearth.water_advisory_sources
  drop constraint water_advisory_sources_kind_check;

alter table hearth.water_advisory_sources
  add constraint water_advisory_sources_kind_check
  check (kind in ('opencities_list', 'rss'));

alter table hearth.water_advisory_sources
  add column if not exists official_alerts_url text,
  add column if not exists official_alerts_note text;

comment on column hearth.water_advisory_sources.official_alerts_url is
  'The city''s own resident-facing alert signup, when one exists. Surfaced in advisory email footers and on the admin page. Issue #337.';

-- Kalamazoo → WMUK news feed (interim; see header).
delete from hearth.water_advisories where pwsid = 'MI0003520';

update hearth.water_advisory_sources
set
  kind = 'rss',
  config = jsonb_build_object(
    'feed_url', 'https://www.wmuk.org/wmuk-news.rss',
    'required_keywords', jsonb_build_array('kalamazoo'),
    'system_wide_phrases', jsonb_build_array(
      'many Kalamazoo customers',
      'Kalamazoo water customers',
      'City of Kalamazoo water customers',
      'all of Kalamazoo',
      'wide swath of the city'
    )
  ),
  consecutive_failures = 0,
  last_error = null,
  failure_alerted_at = null,
  updated_at = now()
where pwsid = 'MI0003520';

-- Portage on its own CivicPlus News Flash feed. Notify Me offers email
-- and text alerts but requires an account, and advisories ride along
-- under News Flash rather than a dedicated list — worth telling
-- subscribers about, not something Hearth signs anyone up for.
insert into hearth.water_advisory_sources
  (pwsid, kind, config, enabled, official_alerts_url, official_alerts_note)
values (
  'MI0005520',
  'rss',
  jsonb_build_object(
    'feed_url', 'https://www.portagemi.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml',
    'system_wide_phrases', jsonb_build_array('all Portage', 'Portage water customers')
  ),
  true,
  'https://www.portagemi.gov/list.aspx',
  'Notify Me offers email and text alerts; requires an account. Boil water advisories are posted under News Flash.'
)
on conflict (pwsid) do nothing;
