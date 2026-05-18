-- User-uploaded house photo: companion to the generated architectural
-- sketch. When a user uploads their own photo from the dashboard, it
-- takes priority over the generated illustration. Removing the user
-- photo reverts the display to the generated sketch.
--
-- Why separate columns instead of overwriting `generated_image_*`:
--   * the two assets co-exist (so "Remove photo" can revert to the
--     sketch without re-running the image workflow).
--   * the generated-image columns carry provenance (`prompt`) that has
--     no meaningful analog for a user upload.
--   * the two assets live in different storage buckets with different
--     RLS shapes (the user bucket allows owner-side writes; the
--     generated bucket does not).
--
-- The path layout mirrors `house-images`: one object per house, keyed by
-- the houses.id uuid as the top-level folder. Uploads use upsert=true so
-- replacing a photo overwrites in place rather than accumulating versions.

alter table hearth.houses
  add column user_image_url text,
  add column user_image_uploaded_at timestamptz;

-- Private bucket for user-uploaded house photos. Distinct from
-- `house-images` (which holds the AI-generated sketches) so the two
-- assets can have different policies — users write to this bucket, but
-- not to `house-images`.
insert into storage.buckets (id, name, public)
values ('house-photos', 'house-photos', false)
on conflict (id) do nothing;

-- Drop any previous policies so this migration is re-runnable during
-- local iteration. Storage policies don't support `if not exists`.
drop policy if exists "House owners can read their house photo"
  on storage.objects;
drop policy if exists "House owners can upload their house photo"
  on storage.objects;
drop policy if exists "House owners can replace their house photo"
  on storage.objects;
drop policy if exists "House owners can delete their house photo"
  on storage.objects;

-- SELECT — same shape as the house-images policy: the first folder
-- segment of the object's path must match a hearth.houses row the user
-- owns. RLS on hearth.houses is the load-bearing ownership check.
create policy "House owners can read their house photo"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'house-photos'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  );

-- INSERT — owner can upload an object under their own house folder.
create policy "House owners can upload their house photo"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'house-photos'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  );

-- UPDATE — upsert path of `supabase.storage.upload` triggers an UPDATE
-- on the existing row. Without this policy, replacing a photo fails
-- silently with an RLS denial.
create policy "House owners can replace their house photo"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'house-photos'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'house-photos'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  );

-- DELETE — owner can remove their photo (used by the Remove photo
-- affordance on the dashboard).
create policy "House owners can delete their house photo"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'house-photos'
    and exists (
      select 1
      from hearth.houses
      where houses.id::text = (storage.foldername(name))[1]
        and houses.owner_id = auth.uid()
    )
  );
