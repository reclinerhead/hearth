-- Emergency-video columns on hearth.documents (issue #139). The
-- existing `kind = 'emergency_procedure_video'` value was already
-- reserved by the original documents migration; this adds the
-- video-specific columns the new flow needs.
--
-- Design notes:
--   - `emergency_is_primary` is NOT NULL DEFAULT FALSE. Every
--     emergency video row has a defined primary/secondary state;
--     non-emergency rows are pinned to false via a CHECK so the
--     flag is meaningful only for the kind it applies to.
--   - `storage_bucket` is forward-looking: existing rows backfill
--     to 'hearth-documents' via the column default, new emergency-
--     video rows write 'hearth-emergency-videos'. A future bucket
--     migration only flips this column, not every row's paths.
--   - The four-category CHECK on `emergency_category` mirrors the
--     UI's category picker; bare strings keep the migration in
--     line with the existing `kind` enum-via-CHECK pattern (no
--     Postgres enum types in hearth — see prior art on documents.kind).

alter table hearth.documents
  add column duration_seconds integer,
  add column emergency_category text,
  add column emergency_label text,
  add column emergency_is_primary boolean not null default false,
  add column poster_storage_path text,
  add column storage_bucket text not null default 'hearth-documents';

-- emergency_category is a four-value enum-via-CHECK. Null is allowed
-- because the column applies only to emergency-video rows; the
-- iff-emergency constraint below ties presence to kind.
alter table hearth.documents
  add constraint documents_emergency_category_check
    check (
      emergency_category is null
      or emergency_category in ('water', 'gas', 'electrical', 'other')
    );

-- iff-emergency: emergency_category populated exactly when kind is
-- 'emergency_procedure_video'. Catches both directions —
--   - non-video rows can't carry a category, and
--   - emergency-video rows must carry one.
alter table hearth.documents
  add constraint documents_emergency_category_iff_kind_check
    check (
      (kind = 'emergency_procedure_video' and emergency_category is not null)
      or (kind <> 'emergency_procedure_video' and emergency_category is null)
    );

-- Pin emergency_is_primary to false on non-emergency rows. Default is
-- already false so existing rows pass; this prevents future writers
-- from accidentally setting the flag on a photo / receipt / etc.
alter table hearth.documents
  add constraint documents_emergency_is_primary_kind_check
    check (
      kind = 'emergency_procedure_video'
      or emergency_is_primary = false
    );

-- storage_bucket is a closed set for now. Adding a new bucket later
-- requires a follow-up migration to widen the CHECK.
alter table hearth.documents
  add constraint documents_storage_bucket_check
    check (
      storage_bucket in ('hearth-documents', 'hearth-emergency-videos')
    );

-- Cross-column: emergency-video rows live in the emergency bucket;
-- everything else stays in hearth-documents. Prevents a future writer
-- from putting an emergency video in the photo bucket or vice versa.
alter table hearth.documents
  add constraint documents_storage_bucket_kind_check
    check (
      (kind = 'emergency_procedure_video' and storage_bucket = 'hearth-emergency-videos')
      or (kind <> 'emergency_procedure_video' and storage_bucket = 'hearth-documents')
    );

-- Dashboard panel read path: "give me every emergency video for this
-- house, grouped by category, primary first, newest first." The
-- composite covers the WHERE on (house_id, kind, emergency_category)
-- and the ORDER BY on (emergency_is_primary desc, created_at desc)
-- without a separate sort step.
create index documents_house_emergency_category_idx
  on hearth.documents (
    house_id,
    kind,
    emergency_category,
    emergency_is_primary desc,
    created_at desc
  )
  where kind = 'emergency_procedure_video';
