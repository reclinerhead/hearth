-- Issue #314 — Enable RLS on hearth.epa_envirofacts_state_cache.
--
-- The table was created (issue #160) with RLS deliberately skipped on
-- the theory that only the service-role client touches it. That
-- reasoning missed the hearth schema's default privileges
-- (20260514135844 grants `authenticated` ALL on new tables;
-- 20260523201949 grants `anon` SELECT), which left the table openly
-- readable by anon and writable by any authenticated user through
-- PostgREST — a cache-poisoning vector, and the source of Supabase's
-- recurring `rls_disabled_in_public` advisory.
--
-- Fix: enable RLS with NO policies. Unlike the sibling shared caches
-- (water_systems, fema_flood_zones_cache), which intentionally carry a
-- select-for-authenticated policy, this table has no client-side read
-- path at all — the Superfund module reads and writes it exclusively
-- through createServiceClient(), which bypasses RLS. No-policy is the
-- honest expression of "service-role only", and the cache code is
-- behaviorally unaffected.

alter table hearth.epa_envirofacts_state_cache enable row level security;
