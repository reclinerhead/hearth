-- Report-export cache: persisted generated PDFs + the cache pointer
-- that decides when to reuse vs. regenerate (issue #207, WQA-R1).
--
-- A Hearth report is a pure function of already-persisted inputs, so the
-- first generation renders the PDF and uploads it to the private
-- `hearth-reports` bucket; subsequent downloads serve the stored file
-- until an input changes. The expensive thing avoided is the multi-second
-- headless-Chromium render, paid once per data change instead of once per
-- download.
--
-- This table is the cache POINTER, kept generic on purpose: it is keyed by
-- (house_id, report_type) so every future report type (insurance, claim,
-- capital-planning, the planned Superfund report) reuses the same table and
-- the same lib/reports/cache.ts helper. Nothing here is water-specific.
--
-- `signature` is an opaque content hash of everything that can change the
-- output (the finding's content version + the static reference-data
-- version + the report-template version). On a download request the route
-- recomputes the current signature and compares: match -> serve the stored
-- file; miss -> render, upload, upsert this row, serve.

create table hearth.report_exports (
  id uuid primary key default gen_random_uuid(),

  -- Owner scope. Ownership (and therefore RLS) is delegated to the parent
  -- house row, mirroring habitat_findings / rooms / inventory rather than
  -- duplicating owner_id here.
  house_id uuid not null references hearth.houses (id) on delete cascade,

  -- Which report this pointer is for. Free-text discriminator (e.g.
  -- 'water_quality') so new report types don't need a schema change. One
  -- cached file per (house, report type) — a regenerate overwrites in place.
  report_type text not null,

  -- Object path inside the `hearth-reports` bucket. Layout:
  --   {house_id}/{report_type}/{signature}.pdf
  -- The leading {house_id} segment is what the storage RLS policies key on.
  storage_path text not null,

  -- Opaque content signature the cached file was rendered against. The
  -- route compares the current signature to this; a mismatch invalidates.
  signature text not null,

  -- When the cached file was last (re)rendered. Surfaced to the user as
  -- "generated on" context if a future UI wants it.
  generated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One cached pointer per report per house. Upserts on the conflict key
  -- give idempotent regenerate semantics.
  unique (house_id, report_type)
);

-- Primary read pattern: "is there a current cached file for this house's
-- report type?" — a point lookup the unique constraint already indexes, but
-- a plain house_id index covers any future "all exports for this house" read.
create index report_exports_house_id_idx
  on hearth.report_exports (house_id);

-- Reuse the shared updated_at trigger function created in the houses
-- migration.
create trigger report_exports_set_updated_at
  before update on hearth.report_exports
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: a user can only see and modify report-export pointers
-- for houses they own. Same ownership-delegation pattern as
-- hearth.habitat_findings.
alter table hearth.report_exports enable row level security;

create policy report_exports_select_own
  on hearth.report_exports
  for select
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = report_exports.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy report_exports_insert_own
  on hearth.report_exports
  for insert
  with check (
    exists (
      select 1
      from hearth.houses
      where houses.id = report_exports.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy report_exports_update_own
  on hearth.report_exports
  for update
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = report_exports.house_id
        and houses.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from hearth.houses
      where houses.id = report_exports.house_id
        and houses.owner_id = auth.uid()
    )
  );

create policy report_exports_delete_own
  on hearth.report_exports
  for delete
  using (
    exists (
      select 1
      from hearth.houses
      where houses.id = report_exports.house_id
        and houses.owner_id = auth.uid()
    )
  );

-- Storage bucket `hearth-reports` + RLS on storage.objects.
--
-- Holds the generated report PDFs. Object layout:
--   {house_id}/{report_type}/{signature}.pdf
--
-- Privacy model mirrors `hearth-documents`: the bucket is PRIVATE
-- (public=false); the report route derives a short-TTL signed URL at serve
-- time. All four operations are granted to `authenticated` only when the
-- path's first folder segment equals a hearth.houses row the user owns —
-- the same ownership chain as the row-level RLS above, so a user can never
-- write a storage object their report_exports row could not also reference.

insert into storage.buckets (id, name, public)
values ('hearth-reports', 'hearth-reports', false)
on conflict (id) do nothing;

-- Drop any previous policies so this migration is re-runnable during local
-- iteration. Storage policies don't support `if not exists`.
drop policy if exists "Owners can read their hearth-reports" on storage.objects;
drop policy if exists "Owners can upload to their hearth-reports" on storage.objects;
drop policy if exists "Owners can update their hearth-reports" on storage.objects;
drop policy if exists "Owners can delete their hearth-reports" on storage.objects;

create policy "Owners can read their hearth-reports"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hearth-reports'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can upload to their hearth-reports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hearth-reports'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can update their hearth-reports"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hearth-reports'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'hearth-reports'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );

create policy "Owners can delete their hearth-reports"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hearth-reports'
    and exists (
      select 1 from hearth.houses h
      where h.id::text = (storage.foldername(name))[1]
        and h.owner_id = auth.uid()
    )
  );
