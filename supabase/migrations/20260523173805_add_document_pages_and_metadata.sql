-- Multi-page receipts (issue #117). Page 1 of every multi-page
-- document stays on hearth.documents.storage_path / thumbnail_path so
-- the existing signed-URL helpers, dashboards, and detail-page
-- galleries (which all read documents as a single-page row) keep
-- working unchanged. Pages 2+ live in hearth.document_pages.
--
-- Single-page documents (the entire existing nameplate + photo
-- corpus) need no change — they simply have no rows in this table.

create table hearth.document_pages (
  id uuid primary key default gen_random_uuid(),

  -- The document this page belongs to. Cascade on delete: removing the
  -- parent removes all subsequent pages atomically so we never strand
  -- a child row whose parent is gone.
  document_id uuid not null
    references hearth.documents(id) on delete cascade,

  -- 1-indexed page number. Page 1 is implicit on the parent row and is
  -- never written here. The CHECK guards against accidental page-1
  -- inserts that would create a confusing duplicate of the parent's
  -- storage_path on a different row.
  page_number integer not null
    check (page_number >= 2),

  -- Storage paths within the hearth-documents bucket. Same shape as
  -- hearth.documents (1920px JPEG + 600px thumbnail), same bucket.
  -- Page objects live under the document's directory at
  -- {house_id}/{document_id}/page-{N}-optimized.jpg
  -- and the matching thumb.
  storage_path text not null,
  thumbnail_path text not null,

  -- SHA-256 hex of the pre-resize bytes for this page. Used by the
  -- Smart Uploader for per-page dedup checks within the same document
  -- (catches a user accidentally re-photographing the same page twice
  -- in a session). Cross-document page dedup is not enforced — the
  -- same page in two different document sessions is allowed.
  content_hash text,

  -- Size in bytes of the storage_path file.
  file_size_bytes bigint not null,

  -- MIME type of the storage_path file. Always image/jpeg in v1; kept
  -- as text so future page-rasterized PDFs slot in without a schema
  -- change.
  mime_type text not null,

  -- Original filename from the device, preserved for the same reasons
  -- as on hearth.documents.original_filename (debug hints, possible
  -- future date-from-filename heuristics).
  original_filename text not null,

  created_at timestamptz not null default now()
);

-- Primary read pattern: "give me all pages for this document, in
-- order" — for the review stage, the detail-page page-flip modal, and
-- the AI extraction call. Unique because (document_id, page_number)
-- is the natural key and the Smart Uploader's per-page dedup helper
-- depends on the constraint surfacing as an error on insert.
create unique index document_pages_document_id_page_number_unique
  on hearth.document_pages (document_id, page_number);

-- Row-level security: scoped through the parent document's house
-- ownership. The same join the document storage RLS uses, just
-- chained one level deeper.
alter table hearth.document_pages enable row level security;

create policy "Users can view document pages in their houses"
  on hearth.document_pages
  for select
  to authenticated
  using (
    exists (
      select 1 from hearth.documents d
      join hearth.houses h on h.id = d.house_id
      where d.id = document_pages.document_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can insert document pages in their houses"
  on hearth.document_pages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from hearth.documents d
      join hearth.houses h on h.id = d.house_id
      where d.id = document_pages.document_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can delete document pages in their houses"
  on hearth.document_pages
  for delete
  to authenticated
  using (
    exists (
      select 1 from hearth.documents d
      join hearth.houses h on h.id = d.house_id
      where d.id = document_pages.document_id
        and h.owner_id = auth.uid()
    )
  );

-- No UPDATE policy: pages are immutable once created. The user retake
-- flow deletes the page row + storage objects and inserts a new row
-- rather than mutating in place.

-- Open-shape bucket for kind-specific structured extraction. Mirrors
-- the hearth.inventory.metadata pattern: schema lives in application
-- code (Zod, in lib/documents/metadata-schemas.ts), the database is
-- intentionally untyped here.
--
-- For kind='receipt' this carries vendor / transaction_date / totals /
-- line_items / referenced_serials / etc. The raw model output stays
-- in the existing ai_extraction column for provenance; metadata holds
-- the application-curated structured shape.
alter table hearth.documents
  add column metadata jsonb not null default '{}'::jsonb;
