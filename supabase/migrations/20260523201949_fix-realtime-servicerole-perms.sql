-- Grant the hearth schema to the Supabase API + Realtime roles
-- (issue #128).
--
-- Supabase Realtime evaluates a subscription's RLS policy as the role
-- the JWT identifies — `authenticated` for a signed-in user,
-- `service_role` for internal/system work. RLS only runs *after* the
-- role can SELECT the table at the catalog level, and the default
-- Supabase setup grants schema-level SELECT only on `public`. Custom
-- schemas like `hearth` need an explicit grant or the realtime
-- broadcaster silently sees zero rows when it tries to look up which
-- subscribers to notify — the subscription handshake still succeeds,
-- but no UPDATE / INSERT / DELETE events ever reach the browser.
--
-- This was the root cause of the realtime gap we'd been working
-- around with polling fallbacks in:
--   - lib/hooks/use-house-realtime.ts (2.5s polling while briefing_status
--     non-terminal)
--   - lib/hooks/use-habitat-findings.ts (2.5s polling)
--   - app/(app)/inventory/[id]/inventory-detail-view.tsx (2.5s polling
--     while synthesis in-flight)
--
-- The polling stays in place as a defense-in-depth path against
-- browser-side websocket blocks (extensions, tracking prevention) —
-- see "Realtime and the browser" in docs/TechnicalGuide.md — but
-- realtime is now the primary delivery mechanism on every surface.
--
-- Why SELECT is enough: RLS policies still gate which *rows* a role
-- can see. A `select on all tables` grant lets the role know the
-- table exists; the existing per-table policies (`owner_id = auth.uid()`
-- chains through hearth.houses) decide which rows it can actually read
-- or broadcast. INSERT / UPDATE / DELETE grants are intentionally not
-- included — the policies handle those, and writes from the browser
-- already go through the standard Supabase JS client which has its own
-- permission model.
--
-- The `alter default privileges` line is what keeps future tables in
-- this schema from regressing: any new `create table hearth.x` will
-- automatically pick up the same SELECT grant without a follow-up
-- migration, so realtime works the moment the table lands.

grant usage on schema hearth to anon, authenticated, service_role;

grant select on all tables in schema hearth
  to anon, authenticated, service_role;

alter default privileges in schema hearth
  grant select on tables to anon, authenticated, service_role;
