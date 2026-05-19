-- Storage bucket `hearth-documents` and RLS policies on storage.objects.
--
-- Holds all user-captured assets: photos today (Smart Uploader phase 1),
-- PDFs and compressed videos in later phases. Object layout within the
-- bucket:
--
--   {house_id}/{document_id}/optimized.jpg     -- 1920px JPEG for photos
--   {house_id}/{document_id}/thumb.jpg         -- 600px thumbnail
--
-- The {document_id} directory makes cleanup-on-retake trivial: one
-- .remove() against the directory wipes everything for a doc. The
-- first path segment is the {house_id}, which is what the storage
-- RLS policies key on.
--
-- Privacy model:
--   - The bucket is PRIVATE (public=false). The Smart Uploader and
--     future Documents UI derive signed URLs at render time, same
--     pattern as `house-images` and `house-photos`.
--   - All four operations (SELECT/INSERT/UPDATE/DELETE) are granted
--     to the `authenticated` role only when the path's first folder
--     segment equals a hearth.houses row the user owns. RLS on
--     hearth.houses is the load-bearing ownership check; the
--     policies below join into it rather than duplicating owner_id
--     on storage.objects.
--   - Same ownership chain as the row-level RLS on hearth.documents,
--     so a user can never write a storage object whose path their
--     hearth.documents row could not also legally reference.

insert into storage.buckets (id, name, public)
values ('hearth-documents', 'hearth-documents', false)
on conflict (id) do nothing;

-- Drop any previous policies so this migration is re-runnable during
-- local iteration. Storage policies don't support `if not exists`.
drop policy if exists "Owners can read their hearth-documents"
  on storage.objects;
drop policy if exists "Owners can upload to their hearth-documents"
  on storage.objects;
drop policy if exists "Owners can update their hearth-documents"
  on storage.objects;
drop policy if exists "Owners can delete their hearth-documents"
  on storage.objects;

-- SELECT — owners can read their own documents.
create policy "Owners can read their hearth-documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hearth-documents'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

-- INSERT — owners can upload to their own house's directory.
create policy "Owners can upload to their hearth-documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hearth-documents'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

-- UPDATE — covers upsert:true and any future replace-in-place
-- affordances on existing storage objects.
create policy "Owners can update their hearth-documents"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hearth-documents'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'hearth-documents'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

-- DELETE — owners can delete their own documents (Smart Uploader
-- retake/cancel cleanup, and future user-driven delete affordances).
create policy "Owners can delete their hearth-documents"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hearth-documents'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );
