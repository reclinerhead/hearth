-- Add `property` as a fourth inventory type alongside appliance, system,
-- and exterior. Property covers things the homeowner *owns* that aren't
-- part of the house itself — vehicles, electronics, valuables, pets.
-- See issue #23 for the full motivation and conveyance-line framing.
--
-- The structural change is intentionally small: a new type value, a
-- nullable subtype discriminator, two new dated/value columns that
-- apply broadly across inventory, and a metadata jsonb bag that
-- absorbs all subtype-specific fields without future migrations.

-- Allow `property` as a fourth inventory type. Existing rows already
-- match one of the three legacy values, so no data migration is needed.
alter table hearth.inventory
  drop constraint inventory_type_check;
alter table hearth.inventory
  add constraint inventory_type_check
    check (type in ('appliance', 'system', 'exterior', 'property'));

-- Subtype discriminator within a type. Nullable; v1 recognizes only
-- 'vehicle' and 'pet' as concrete property subtypes. Other property
-- (electronics, instruments, art, jewelry, tools) stays subtype=null
-- and rides the generic property path. Future subtypes extend through
-- this column without further migration.
alter table hearth.inventory
  add column subtype text;

-- Acquisition date. Broadly meaningful across all property types
-- (and any future depreciation / warranty calculations). Date column
-- earns its keep through cheap index-friendly range queries.
alter table hearth.inventory
  add column purchased_on date;

-- User-entered estimated value, stored in cents to avoid floating-point
-- drift. bigint, not integer — integer tops out near $21M in cents and
-- the field needs to accommodate high-value art / jewelry and any
-- value the user wants to enter. Drives the insurance-inventory
-- report's value aggregation: select sum(estimated_value_cents)...
alter table hearth.inventory
  add column estimated_value_cents bigint
    check (estimated_value_cents is null or estimated_value_cents >= 0);

-- Open-shape bucket for subtype-specific fields. For vehicles this
-- carries license_plate, license_plate_state, model_year,
-- purchase_price_cents, purchased_from, and any vin_decode payload.
-- For pets this carries species, breed, microchip number, vet, etc.
-- Future subtypes extend through metadata rather than columns. When a
-- field becomes load-bearing for cross-row queries it gets promoted
-- to a column via a one-line follow-up migration.
alter table hearth.inventory
  add column metadata jsonb not null default '{}'::jsonb;
