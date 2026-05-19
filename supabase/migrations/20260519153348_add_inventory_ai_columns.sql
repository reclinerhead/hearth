-- Add two JSONB columns to hearth.inventory for the inventory detail page's
-- AI surfaces (phase 1.5):
--
--   ai_pills    — structured facts pulled from a nameplate photo by the
--                 image-analysis pipeline. Populated at row-creation time
--                 by createInventoryFromDocumentAction, which copies the
--                 source document's ai_extraction.extracted.pills through.
--                 Rendered as visual pills in the detail page's title area.
--
--   ai_insights — result of the "Research this model" on-demand AI lookup
--                 (Perplexity Sonar through the Vercel AI Gateway). Stored
--                 as one jsonb blob per inventory item; regenerated in
--                 place when the user re-clicks Research.
--
-- Both columns are nullable. Existing rows stay null until either a new
-- photo extraction populates pills (only on creation) or the user clicks
-- Research on the detail page. No backfill needed; this is additive and
-- forward-only.

alter table hearth.inventory
  add column ai_pills jsonb,
  add column ai_insights jsonb;

comment on column hearth.inventory.ai_pills is
  'Structured facts extracted from nameplate photos by the image-analysis '
  'pipeline. Array of { label: text, value: text } pairs. Rendered as visual '
  'pills in the detail page title area. Populated by '
  'createInventoryFromDocumentAction from the source document''s ai_extraction.';

comment on column hearth.inventory.ai_insights is
  'Result of the "Research this model" lookup. Shape: { headline: text, '
  'body: text, source_urls: text[], found_specific_model: boolean, '
  'generated_at: timestamptz, model_used: text }. Populated on-demand by '
  'researchInventoryModelAction. Regeneratable in place.';
