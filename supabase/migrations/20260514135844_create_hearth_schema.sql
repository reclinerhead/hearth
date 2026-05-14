-- Create the hearth schema for app-specific tables.
-- The public schema is shared with other apps (auth, profiles); hearth
-- isolates all Hearth domain tables.

create schema if not exists hearth;

-- Grant usage to the standard Supabase roles so PostgREST and the
-- Supabase client SDK can see and operate on objects in this schema.
-- 'anon' = unauthenticated requests, 'authenticated' = logged-in users,
-- 'service_role' = server-side admin access (bypasses RLS).
grant usage on schema hearth to anon, authenticated, service_role;

-- Default privileges for objects created later in this schema.
-- Without this, every future CREATE TABLE would need explicit GRANTs.
-- We grant table privileges to authenticated by default; anon gets nothing
-- by default (we'll opt-in per table if any tables should be readable
-- without login). service_role always has full access.
alter default privileges in schema hearth
  grant all on tables to authenticated, service_role;

alter default privileges in schema hearth
  grant all on sequences to authenticated, service_role;

alter default privileges in schema hearth
  grant execute on functions to authenticated, service_role;