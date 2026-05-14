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




  -- Local-only stub for the shared public.profiles table.
-- On the remote Supabase project, public.profiles is owned by another app
-- (Echoes) and already exists with its own full schema. This migration uses
-- `create table if not exists` so it's a no-op against the remote, but
-- ensures the table exists locally so Hearth's foreign keys resolve.
--
-- Do NOT add Hearth-specific columns here. Hearth's data lives in the
-- hearth schema. This stub only exists to make local development work.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);


