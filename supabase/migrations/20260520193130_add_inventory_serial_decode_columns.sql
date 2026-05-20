-- Add columns for the dedicated serial-number to manufacture-date decode
-- pipeline (issue #77).
--
-- The existing AI Insights call runs on a non-reasoning model for ~10s
-- latency, which produces unreliable date decodes (the model invents
-- plausible-sounding encoding rules and applies them confidently to
-- itself, yielding different dates for the same serial across runs).
-- The serial-decode pipeline lifts the decode work into its own parallel
-- call on a reasoning model, narrowing the input to just
-- manufacturer + model + serial. The reasoning model's structured
-- response is persisted here, but ONLY when its self-reported confidence
-- is "high" — medium/low results are logged for inspection and not
-- written to the row.
--
-- Columns are nullable; rows captured before this migration stay null
-- until the user clicks "Research this item" again on the detail page.
-- No backfill — additive and forward-only.

alter table hearth.inventory
  add column manufacture_date text,
  add column manufacture_date_precision text,
  add column manufacture_date_confidence text,
  add column manufacture_date_decoded_at timestamptz,
  add column manufacture_date_model text,
  add column manufacture_date_reasoning text;

alter table hearth.inventory
  add constraint inventory_manufacture_date_precision_check
    check (
      manufacture_date_precision is null
      or manufacture_date_precision in ('year', 'month', 'week')
    );

alter table hearth.inventory
  add constraint inventory_manufacture_date_confidence_check
    check (
      manufacture_date_confidence is null
      or manufacture_date_confidence in ('high', 'medium', 'low')
    );

comment on column hearth.inventory.manufacture_date is
  'Decoded manufacture date from the serial-decode pipeline. Format '
  'depends on precision: YYYY for year, YYYY-MM for month, YYYY-Www for '
  'week. Only populated when the decode call returned confidence=high.';

comment on column hearth.inventory.manufacture_date_precision is
  'Precision of manufacture_date: year, month, or week. Tracks how '
  'specific the encoded date in the serial actually is.';

comment on column hearth.inventory.manufacture_date_confidence is
  'Self-reported confidence from the reasoning model. Only "high" values '
  'land in this row; medium/low are logged but not persisted, since a '
  'confidently-wrong date is worse than no date.';

comment on column hearth.inventory.manufacture_date_decoded_at is
  'Timestamp the decode call completed and was persisted to this row.';

comment on column hearth.inventory.manufacture_date_model is
  'Model string from INVENTORY_SERIAL_DECODER_MODEL at decode time, '
  'recorded for later auditing if a rule changes or a model swap '
  'invalidates older decodes.';

comment on column hearth.inventory.manufacture_date_reasoning is
  'The model''s show-your-work — the encoding rule it cited plus the '
  'character-by-character application to the serial. Kept for future '
  'debugging surfaces; not rendered in phase 1.';
