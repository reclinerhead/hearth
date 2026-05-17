-- Storage bucket `house-images` and RLS policies on storage.objects.
--
-- Layout: {house_id}/generated-sketch.png — one object per house, keyed by
-- the houses.id uuid as the top-level folder. The orchestrator's image
-- step (workflows/house-image.ts) writes this object with upsert=true so
-- a regenerate overwrites in place rather than accumulating versions.
--
-- Privacy model:
--   - The bucket is PRIVATE (public=false). The dashboard derives signed
--     URLs server-side via lib/house-image/signed-url.ts.
--   - SELECT is granted to the `authenticated` role only when the path's
--     first folder segment equals a hearth.houses row the user owns. RLS
--     on hearth.houses is the ownership check; the policy below joins
--     into it rather than duplicating owner_id on storage.objects.
--   - INSERT/UPDATE/DELETE intentionally have NO policies for
--     `authenticated`. The service-role client (lib/supabase/service.ts)
--     bypasses RLS so backend generation works; users cannot write to
--     this bucket. User-uploaded photos will live on a separate bucket
--     with its own policies, tracked as a follow-up.
--
-- The bucket was originally created via the Supabase Dashboard; this
-- migration is idempotent so a fresh `supabase db reset` recreates it.

insert into storage.buckets (id, name, public)
values ('house-images', 'house-images', false)
on conflict (id) do nothing;

-- Drop any previous policy with the same name so this migration is
-- re-runnable during local iteration without manual cleanup. Storage
-- policies don't have an `if not exists` form, so we lean on `drop ...
-- if exists` instead.
drop policy if exists "House owners can read their generated house image"
  on storage.objects;

create policy "House owners can read their generated house image"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'house-images'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  );
