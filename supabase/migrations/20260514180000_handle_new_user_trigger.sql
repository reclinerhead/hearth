-- Local-only auto-create for public.profiles on auth.users insert.
--
-- On the remote Supabase project, public.profiles is owned by Echoes and
-- presumably already has a trigger that creates a profile row when a new
-- user signs up. Locally we have only the stub table from the schema
-- migration, so foreign keys into profiles (like hearth.houses.owner_id)
-- fail for any user that signed up locally.
--
-- This trigger fixes that by creating a profile row whenever a new
-- auth.users row appears. It also backfills any existing local users.
--
-- The trigger and function are defined with `create or replace` /
-- `drop trigger if exists` so the migration is idempotent. If the
-- function name collides with Echoes' on remote, we keep ours behind
-- a hearth-specific name to avoid clashing.

create or replace function public.hearth_handle_new_user()
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

drop trigger if exists on_auth_user_created_hearth on auth.users;

create trigger on_auth_user_created_hearth
  after insert on auth.users
  for each row execute function public.hearth_handle_new_user();

-- Backfill: any user that already signed up locally has no profile row.
-- Safe everywhere thanks to `on conflict do nothing`.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
