-- Add an explicit hero photo selection to hearth.inventory (issue #105).
--
-- Until now, the detail page, dashboard inventory tile, and home inventory
-- list have all derived the hero photo from "the most-recently attached
-- document" — analyzed_at desc, created_at desc, photos[0] wins. That
-- works when an item has one photo but breaks user intent when there
-- are several (front / nameplate / side / controls) — the last one
-- captured is rarely the one that best represents the item.
--
-- hero_document_id is a nullable FK into hearth.documents. When set,
-- the read surfaces move that document to the front of the photo array;
-- when null, the existing "most-recent wins" fallback continues.
-- ON DELETE SET NULL so deleting the chosen photo reverts the item to
-- the fallback rather than orphaning the FK. No index — this column is
-- only read on single-item detail page queries, never scanned.
--
-- The legacy `hero_photo_path text` column has been in the schema since
-- the original inventory migration but was never wired to any read or
-- write path; dropping it in the same migration keeps the table honest.

alter table hearth.inventory
  add column hero_document_id uuid
    references hearth.documents(id) on delete set null;

comment on column hearth.inventory.hero_document_id is
  'The document the user has pinned as the hero photo for this item. '
  'NULL means fall back to the "most-recently attached" rule used by '
  'every read surface. ON DELETE SET NULL so removing the chosen photo '
  'reverts the item to the fallback rather than dangling the FK.';

alter table hearth.inventory
  drop column hero_photo_path;
