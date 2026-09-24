-- Kalamazoo back on the city's own advisory page, through the relay (issue #353).
--
-- Reverses the Kalamazoo block of 20260922230000_add_rss_source_kind_and_portage.sql.
-- The city's OpenCities page sits behind Akamai, which blocks every cloud
-- egress (issue #341); toddtech-web-relay now gives the watcher a
-- residential egress path. The source opts in with use_fetch_proxy and
-- WATER_ADVISORY_FETCH_PROXY_URL (set in Vercel only — the relay host and
-- key never appear in this repo) carries the template.
--
-- The WMUK-keyed advisory rows are deleted first so the switched source
-- sees an empty store and seeds silently (issue #331) instead of firing
-- "issued"/"lifted" events for the city page's existing history. No
-- notifications reference them (the FK cascades regardless).
--
-- Portage's source row is untouched.

delete from hearth.water_advisories where pwsid = 'MI0003520';

update hearth.water_advisory_sources
set
  kind = 'opencities_list',
  config = jsonb_build_object(
    'list_url', 'https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories',
    'system_wide_phrases', jsonb_build_array('City of Kalamazoo water customers'),
    'use_fetch_proxy', true
  ),
  consecutive_failures = 0,
  last_error = null,
  failure_alerted_at = null,
  updated_at = now()
where pwsid = 'MI0003520';
