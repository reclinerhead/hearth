-- Storage bucket `hearth-emergency-videos` and RLS policies on
-- storage.objects. Holds the compressed WebM/MP4 emergency-procedure
-- videos and their extracted poster-frame JPEGs.
--
-- Kept separate from `hearth-documents` (issue #139) so retention,
-- size, and migration policies can diverge later — emergency videos
-- are larger, fewer, and have different lifecycle expectations than
-- the photo corpus.
--
-- Object layout within the bucket (matches hearth-documents):
--
--   {house_id}/{document_id}/video.webm     -- compressed video (or .mp4 on Safari)
--   {house_id}/{document_id}/poster.jpg     -- 1s-mark poster frame
--
-- Privacy model:
--   - Bucket is PRIVATE (public=false). The dashboard panel and
--     player modal derive signed URLs at render time, same pattern
--     as `hearth-documents`.
--   - All four operations (SELECT/INSERT/UPDATE/DELETE) are granted
--     to the `authenticated` role only when the path's first folder
--     segment equals a hearth.houses row the user owns. Same
--     ownership chain as the row-level RLS on hearth.documents.

insert into storage.buckets (id, name, public)
values ('hearth-emergency-videos', 'hearth-emergency-videos', false)
on conflict (id) do nothing;

-- Drop any previous policies so this migration is re-runnable.
drop policy if exists "Owners can read their hearth-emergency-videos"
  on storage.objects;
drop policy if exists "Owners can upload to their hearth-emergency-videos"
  on storage.objects;
drop policy if exists "Owners can update their hearth-emergency-videos"
  on storage.objects;
drop policy if exists "Owners can delete their hearth-emergency-videos"
  on storage.objects;

create policy "Owners can read their hearth-emergency-videos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hearth-emergency-videos'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can upload to their hearth-emergency-videos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hearth-emergency-videos'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can update their hearth-emergency-videos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hearth-emergency-videos'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'hearth-emergency-videos'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can delete their hearth-emergency-videos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hearth-emergency-videos'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );
