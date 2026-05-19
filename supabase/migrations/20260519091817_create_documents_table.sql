-- Documents: every user-captured asset attached to a house. Photos
-- (nameplate + generic), plus PDFs and compressed videos in later
-- phases. The `kind` column discriminates extraction routing and UI
-- treatment; phase 1 writes only `nameplate` and `photo` but the
-- CHECK includes the phase-2 values so the schema does not need to
-- change when those paths ship.
--
-- The early-INSERT pattern (Smart Uploader writes a row the moment
-- storage uploads succeed) makes `status` the lifecycle column:
-- analyzing → analyzed → attached, with `failed` as the terminal-
-- error state. Rows exist between upload and the user's Save action
-- with `inventory_id` null; deleting an inventory item later sets
-- `inventory_id` back to null on the surviving documents rather than
-- destroying them.

create table hearth.documents (
  id uuid primary key default gen_random_uuid(),

  -- The house this document belongs to. Cascade on delete: deleting a
  -- house removes all its documents.
  house_id uuid not null references hearth.houses(id) on delete cascade,

  -- The inventory item this document is attached to. Nullable because
  -- documents exist before they're attached (between upload and the
  -- user's Save action in the Smart Uploader review stage). ON DELETE
  -- SET NULL so deleting an inventory item doesn't destroy its
  -- documents — they revert to unattached and stay in the house.
  inventory_id uuid references hearth.inventory(id) on delete set null,

  -- Who uploaded this. ON DELETE SET NULL so documents survive user
  -- deletion (same pattern as Echoes' photos.uploaded_by).
  uploaded_by uuid references auth.users(id) on delete set null,

  -- What kind of asset this is. Drives extraction routing and UI
  -- treatment. Phase 1 only writes 'nameplate' and 'photo'; the other
  -- values are reserved so future phases don't need a schema change.
  --   nameplate                  — phase 1: appliance/system identifying photo
  --   photo                      — generic photo attached to an inventory item
  --   receipt                    — phase 2: purchase or service receipt
  --   manual                     — phase 2: owner's/installer's manual (usually PDF)
  --   permit                     — phase 2: building/electrical/plumbing permit
  --   warranty                   — phase 2: warranty registration/certificate
  --   invoice                    — phase 2: contractor invoice
  --   inspection                 — phase 2: home inspection / radon test / etc.
  --   emergency_procedure_video  — phase 2: shutoff or breaker walkthrough video
  --   other                      — phase 2: catch-all
  kind text not null
    check (kind in (
      'nameplate', 'photo',
      'receipt', 'manual', 'permit', 'warranty', 'invoice', 'inspection',
      'emergency_procedure_video',
      'other'
    )),

  -- Lifecycle. Set by the Smart Uploader as the doc moves through the
  -- pipeline. The early-INSERT pattern means a row exists from the
  -- moment storage uploads succeed; status tracks where it is.
  --   analyzing  — row exists, files in storage, AI call in flight
  --                (or pending if the user cancels mid-flow)
  --   analyzed   — AI call returned, awaiting user review
  --   attached   — user confirmed; row points at an inventory_id
  --   failed     — AI call failed terminally; user can retake or
  --                manually attach
  status text not null default 'analyzing'
    check (status in ('analyzing', 'analyzed', 'attached', 'failed')),

  -- Storage paths within the hearth-documents bucket. Both required
  -- for photo-kind documents (1920px + 600px thumb). The original
  -- uncompressed file is intentionally NOT stored — only the resized
  -- versions land in the bucket. content_hash is computed on the
  -- pre-resize bytes for dedup, but the bytes themselves are
  -- discarded after the Canvas reads them.
  --
  -- For future video documents these will hold the compressed MP4
  -- and a poster-frame JPEG. For future PDF documents storage_path
  -- holds the PDF and thumbnail_path holds a page-1 thumbnail.
  storage_path text not null,
  thumbnail_path text not null,

  -- SHA-256 hex of the pre-resize file bytes. Powers byte-identical
  -- duplicate detection in the Smart Uploader. Partial unique index
  -- below enforces per-house uniqueness; null is allowed because
  -- future kinds (e.g. server-generated assets) may not have a
  -- meaningful hash.
  content_hash text,

  -- MIME type of the stored display version (storage_path), e.g.
  -- 'image/jpeg' for photos. Not the MIME of the user's original.
  mime_type text not null,

  -- Size in bytes of the storage_path file (the 1920px JPEG for
  -- photos). Used for storage accounting and "this is a big file"
  -- UI affordances.
  file_size_bytes bigint not null,

  -- Filename the user's device gave us. Preserved for display and
  -- because filenames sometimes carry useful hints (date strings,
  -- vendor names) that future extractors might exploit. Not
  -- exposed as a unique key.
  original_filename text not null,

  -- Raw AI extraction output, kept verbatim for provenance and
  -- future re-extraction. Schema is kind-specific and lives in
  -- application code, not the database — the JSONB is intentionally
  -- untyped here.
  ai_extraction jsonb,

  -- Which model produced ai_extraction. E.g. 'grok-vision-something'.
  -- Stored so we can re-run analysis when models improve and have
  -- a clear lineage.
  ai_model text,

  -- Confidence score from the AI call, 0.00 to 1.00. Used by the
  -- review stage to decide between the standard review UI and a
  -- low-confidence "we couldn't read that clearly" branch.
  ai_confidence numeric(3, 2)
    check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),

  -- When the analyze step completed. Null until the AI call returns.
  analyzed_at timestamptz,

  -- User-entered free-form notes from the review stage.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Primary read pattern: "show me all documents for this house, newest
-- first" — for a future Documents list page and the dashboard.
create index documents_house_id_created_at_idx
  on hearth.documents (house_id, created_at desc);

-- Inventory-scoped reads: "show me the documents attached to this
-- appliance" — for the inventory item detail page's Documents panel.
-- Partial because most queries won't care about unattached rows.
create index documents_inventory_id_idx
  on hearth.documents (inventory_id)
  where inventory_id is not null;

-- Dedup lookup: "does this house already have a document with this
-- content hash?" Partial unique enforces the constraint while
-- allowing many null content_hash values to coexist (future kinds
-- may not produce a hash).
create unique index documents_house_id_content_hash_unique
  on hearth.documents (house_id, content_hash)
  where content_hash is not null;

-- Status-watching index: "which documents are still analyzing or
-- have failed?" — for any future recovery flow and admin views.
-- Partial because attached + analyzed terminal states dominate.
create index documents_status_idx
  on hearth.documents (house_id, status)
  where status in ('analyzing', 'failed');

-- Reuse the shared updated_at trigger function created in the houses
-- migration. Same pattern as rooms and inventory.
create trigger documents_set_updated_at
  before update on hearth.documents
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: scoped through house ownership, same pattern as
-- hearth.inventory. Four policies (SELECT/INSERT/UPDATE/DELETE) all
-- delegating to hearth.houses.owner_id = auth.uid().
alter table hearth.documents enable row level security;

create policy "Users can view documents in their houses"
  on hearth.documents
  for select
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = documents.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can insert documents in their houses"
  on hearth.documents
  for insert
  to authenticated
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = documents.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can update documents in their houses"
  on hearth.documents
  for update
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = documents.house_id
        and h.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = documents.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can delete documents in their houses"
  on hearth.documents
  for delete
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = documents.house_id
        and h.owner_id = auth.uid()
    )
  );
