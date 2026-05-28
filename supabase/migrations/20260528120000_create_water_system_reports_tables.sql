-- WQA-3 (issue #176) — Shared CCR (Consumer Confidence Report) cache.
--
-- Builds on WQA-1's hearth.water_systems and WQA-2's SDWIS shared caches.
-- A CCR is the utility's federally-mandated annual report; one logical
-- report covers a single (PWSID, coverage year) and is identical for
-- every Hearth house on that utility, so we store it once and share.
--
-- Two tables ship together:
--   water_system_reports             — one row per (PWSID, year, edition),
--                                      holds the extracted JSONB
--   water_system_report_contributors — one row per (report, content_hash),
--                                      tracks every distinct upload that
--                                      contributed to or rebound to this
--                                      shared cache entry
--
-- The CHECK constraint on hearth.documents.kind is extended in the same
-- migration so the new 'water_quality_report' value can be written from
-- day one — splitting the schema change from the table creation would
-- mean the new tables exist but no document row could reference them.
--
-- Architectural notes:
--
-- * EXTRACTION SCOPE IS NARROW BY DESIGN. The CCR extraction prompt
--   pulls only measured contaminant data, lead/copper distribution,
--   UCMR results, header metadata, and a single free-testing-offer
--   flag. Marketing copy, source-water assessments, infrastructure-
--   improvement plans, educational narrative, customer tips, awards,
--   and other CCR fluff are explicitly ignored. The Zod schema in
--   lib/documents/ai/ccr-schema.ts has no fields for the excluded
--   categories so out-of-scope data has nowhere to land even if the
--   model tried to extract it. See the WQA-3 issue for the
--   reasoning — CCRs vary wildly in marketing volume and the prompt
--   is the bulwark against that variance.
--
-- * NO TTL. Unlike WQA-1's water_systems and WQA-2's SDWIS caches,
--   the source of truth for a CCR is a user upload, not an EPA API.
--   Once we have a (PWSID, year, edition) row it is canonical for
--   that report. Reanalysis when a newer prompt ships is WQA-9's
--   job; this migration just persists extraction_version so the
--   trigger has something to compare against.
--
-- * RLS — globally readable to authenticated users, no user-facing
--   writes. Same discipline as water_systems / water_system_violations:
--   every write goes through the service-role action layer in
--   app/actions/documents/. A user accidentally attempting to INSERT
--   here hits RLS and fails loudly instead of corrupting the shared
--   cache.

-- =========================================================================
-- hearth.documents.kind  —  extend CHECK to include water_quality_report
-- =========================================================================
-- The CCR document path needs its own discriminator so the extraction
-- router can dispatch to analyze-ccr rather than analyze-receipt.
-- ALTER the existing CHECK constraint to add the new value alongside
-- the nine reserved by issue #117.

alter table hearth.documents
  drop constraint documents_kind_check;

alter table hearth.documents
  add constraint documents_kind_check check (kind in (
    'nameplate', 'photo',
    'receipt', 'manual', 'permit', 'warranty', 'invoice', 'inspection',
    'emergency_procedure_video',
    'water_quality_report',
    'other'
  ));

-- =========================================================================
-- hearth.water_system_reports
-- =========================================================================
-- One row per (PWSID, report_year, edition) — the canonical extracted
-- CCR for that utility-year. Shared across every Hearth house on the
-- utility. The contributors table below tracks the distinct uploads
-- that mapped to this row.

create table hearth.water_system_reports (
  id uuid primary key default gen_random_uuid(),

  -- Composite natural key. PWSID FKs to water_systems so a CCR row
  -- cannot exist without the utility record it describes — every
  -- CCR upload path resolves the PWSID first (via WQA-1's address
  -- lookup or the utility-name fallback) before the report row is
  -- written.
  pwsid text not null
    references hearth.water_systems(pwsid) on delete cascade,

  -- The coverage year the CCR documents, not the publication year.
  -- A "2024 Water Quality Report" published in May 2025 typically
  -- documents 2024 data — we key by coverage year because that's
  -- what the user is actually reading about and what determines
  -- whether a finding is "based on the latest data".
  report_year integer not null,

  -- Edition discriminator. Almost every CCR is the annual 'primary'
  -- report. 'supplement' covers mid-year addenda (a follow-up notice
  -- after a violation); 'correction' covers republished editions
  -- that fix errors in the primary. Keeping edition in the natural
  -- key means a utility republishing the same year doesn't overwrite
  -- the original — the corrected edition lands as a sibling row.
  edition text not null default 'primary'
    check (edition in ('primary', 'supplement', 'correction')),

  -- The hearth.documents row that holds the canonical source file
  -- (whoever's upload triggered the extraction). Nullable because:
  --   * the user who uploaded the canonical file may later delete
  --     their document, and we want the extraction to survive — it
  --     still benefits every other house on the utility;
  --   * future B2B2C seeding paths may write a report row without a
  --     specific document attached (a partnership bulk-loading CCRs).
  -- ON DELETE SET NULL preserves the extraction when the source
  -- document is removed; the contributors table still records who
  -- uploaded what.
  source_document_id uuid
    references hearth.documents(id) on delete set null,

  -- SHA-256 hex of the canonical source file's pre-resize bytes.
  -- Same hash space as hearth.documents.content_hash. The action
  -- layer checks this BEFORE running the Sonar extraction: a byte-
  -- identical re-upload short-circuits to the existing extraction
  -- and adds a contributor row only if the content_hash isn't
  -- already represented in the contributors table for this report.
  content_hash text not null,

  -- The user who uploaded the canonical extraction (first uploader
  -- for this PWSID+year+edition). Surfaced in the contributor-
  -- recognition activity-log narration as first-name + last-initial
  -- (never full name or email — privacy discipline). ON DELETE SET
  -- NULL so user deletion doesn't destroy the extraction that
  -- benefits everyone else on the utility.
  uploaded_by uuid
    references auth.users(id) on delete set null,

  -- The fully-extracted structured contents. The Zod schema in
  -- lib/documents/ai/ccr-schema.ts validates this shape — five
  -- nullable top-level sections (header_metadata, detected_
  -- contaminants, lead_copper_distribution, ucmr_results,
  -- free_testing_offer) and nothing else. The database JSONB is
  -- intentionally untyped so the application-side schema can evolve
  -- without a column migration; extraction_version below pins which
  -- schema version produced any given row.
  extracted_data jsonb not null,

  -- Which model produced extracted_data. Same provenance pattern as
  -- hearth.documents.ai_model — e.g. 'sonar-pro-2025-XX'. Used for
  -- debugging extraction-quality regressions when a model swap
  -- changes output shape.
  ai_model text not null,

  -- Extraction prompt version. Bumped each time the prompt's
  -- structural contract changes (new section, removed section,
  -- schema shift). WQA-9's reanalysis trigger compares this to the
  -- current prompt version to decide if an existing extraction
  -- needs to be re-run; for now WQA-3 just persists it alongside
  -- the extraction.
  extraction_version text not null,

  -- When the extraction completed. Distinct from published_date —
  -- this is when WE ran the model, not what the CCR declares.
  extracted_at timestamptz not null default now(),

  -- The utility's stated CCR publication date, when the document
  -- itself prints one cleanly. Nullable because many CCRs don't
  -- print a precise date or print it ambiguously ("Spring 2025").
  -- We never invent a date here; the prompt returns null when the
  -- date isn't unambiguous.
  published_date date,

  unique (pwsid, report_year, edition)
);

comment on table hearth.water_system_reports is
  'Extracted Consumer Confidence Reports, shared across all houses on the utility. Keyed by (PWSID, report_year, edition). One row per CCR. RLS globally readable; service-role writes only. Issue #176 (WQA-3).';

comment on column hearth.water_system_reports.report_year is
  'Coverage year the CCR documents (e.g. 2024 for a "2024 Water Quality Report" usually published in May 2025). Key dimension for "latest report" queries.';

comment on column hearth.water_system_reports.edition is
  'Almost always ''primary''. ''supplement'' for mid-year addenda, ''correction'' for republished editions. Kept in the natural key so a correction doesn''t overwrite the primary.';

comment on column hearth.water_system_reports.content_hash is
  'SHA-256 of the canonical source file. The contributors table tracks alternate-hash uploads of the same logical CCR.';

comment on column hearth.water_system_reports.extracted_data is
  'Zod-validated five-section CCR payload. Sections: header_metadata, detected_contaminants, lead_copper_distribution, ucmr_results, free_testing_offer. Marketing / source-water / infrastructure / educational / customer-tip content is deliberately NOT extracted — see lib/documents/ai/ccr-schema.ts and lib/documents/ai/ccr-prompt.ts.';

comment on column hearth.water_system_reports.extraction_version is
  'Prompt version that produced extracted_data. Reanalysis trigger (WQA-9) compares this to the current prompt version. Bumped on structural prompt changes.';

comment on column hearth.water_system_reports.published_date is
  'CCR publication date as extracted from the document. May be null when the document does not state it unambiguously — we never invent a date.';

-- Lookup index for the "find the latest report for this utility" query
-- the WQA module runs on every check() — the unique constraint already
-- covers (pwsid, report_year, edition), but the most common access
-- pattern is "latest year for this PWSID" which benefits from an
-- explicit descending index.
create index water_system_reports_pwsid_year_desc
  on hearth.water_system_reports (pwsid, report_year desc);

-- =========================================================================
-- hearth.water_system_report_contributors
-- =========================================================================
-- One row per (report, content_hash) — every distinct upload that
-- either created or rebound to a shared CCR cache entry. Powers the
-- first-uploader recognition surface and the "contributed by N
-- homeowners" narration without exposing PII.
--
-- The (report_id, content_hash) uniqueness means a second user
-- uploading byte-identical bytes does NOT create a duplicate
-- contributor row — they get the existing extraction with no
-- contributor credit (they didn't contribute new bytes). A
-- different-bytes upload of the same logical CCR (a photo of a
-- PDF, a re-scanned copy) DOES create a new contributor row because
-- the bytes are different even though the underlying document is
-- the same.

create table hearth.water_system_report_contributors (
  id uuid primary key default gen_random_uuid(),

  report_id uuid not null
    references hearth.water_system_reports(id) on delete cascade,

  -- SHA-256 of THIS contributor's upload. May or may not match the
  -- canonical report row's content_hash — a user uploading a photo
  -- of the same CCR produces different bytes than the original PDF,
  -- and we record both so a future identical re-upload from anyone
  -- short-circuits.
  content_hash text not null,

  -- The hearth.documents row this contribution came from. Useful
  -- for debugging ("show me the actual file this contributor sent")
  -- and for the contributor's own document detail page. ON DELETE
  -- SET NULL so a user's document delete doesn't destroy the
  -- contribution record — the row stays as evidence that the
  -- contribution happened.
  document_id uuid
    references hearth.documents(id) on delete set null,

  -- Who uploaded. ON DELETE SET NULL so user account deletion
  -- doesn't destroy the contribution record; the row stays so the
  -- shared cache's provenance story remains complete.
  contributed_by uuid
    references auth.users(id) on delete set null,

  -- The house the contributor was operating on when they uploaded.
  -- Powers the "you're the first Kalamazoo resident" / "another
  -- Kalamazoo resident" narration via the contributor's house city.
  -- ON DELETE SET NULL so a deleted house doesn't destroy the
  -- contribution record — same rationale as contributed_by.
  contributed_for_house_id uuid
    references hearth.houses(id) on delete set null,

  contributed_at timestamptz not null default now(),

  -- One row per (report, content_hash). A second user uploading
  -- byte-identical bytes does NOT create a second contributor row.
  unique (report_id, content_hash)
);

comment on table hearth.water_system_report_contributors is
  'Records every CCR contribution per (report, content_hash). One row per unique-byte contribution per report. Powers first-uploader recognition and "contributed by N homeowners" surfaces. Issue #176 (WQA-3).';

comment on column hearth.water_system_report_contributors.content_hash is
  'SHA-256 of this specific contributor''s upload bytes. May differ from the report''s canonical content_hash (a photo of a PDF produces different bytes).';

-- =========================================================================
-- RLS
-- =========================================================================
-- Both tables are globally readable to authenticated users — the
-- shared-cache model means every user on a given utility can see the
-- same CCR row, and the contributors table powers cross-user
-- narration. Neither table grants insert/update/delete to end users;
-- writes happen exclusively through the service-role action layer
-- (analyze-ccr / finalize-ccr-upload in app/actions/documents/).

alter table hearth.water_system_reports enable row level security;
create policy water_system_reports_select_all
  on hearth.water_system_reports
  for select
  to authenticated
  using (true);

alter table hearth.water_system_report_contributors enable row level security;
create policy water_system_report_contributors_select_all
  on hearth.water_system_report_contributors
  for select
  to authenticated
  using (true);
