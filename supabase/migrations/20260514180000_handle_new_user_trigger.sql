-- Auto-create a public.profiles row whenever a new auth.users row appears.
--
-- hearth.houses.owner_id has a FK to public.profiles(id), so every
-- signed-up user needs a profile row before they can complete onboarding.
-- This trigger handles that automatically — the standard Supabase pattern
-- for projects that own their own auth + profile tables.
--
-- `create or replace` / `drop trigger if exists` keep the migration
-- idempotent so re-runs are safe.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any auth.users rows created before this migration (test users
-- from before linking the new project, etc.). On conflict do nothing
-- makes it a no-op if rows already exist.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
