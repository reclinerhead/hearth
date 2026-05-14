-- Inventory: every appliance, system, and exterior element in a house.
-- One row per physical thing. Columns are intentionally focused on
-- maintenance and identification (make/model/serial, install date,
-- service dates, photo), not full spec-sheet tracking.

create table hearth.inventory (
  id uuid primary key default gen_random_uuid(),

  -- The house this item belongs to. Cascade on delete.
  house_id uuid not null references hearth.houses(id) on delete cascade,

  -- The room this item lives in. NOT NULL — outdoor items are placed
  -- in the seeded "Exterior" room rather than allowed to be roomless.
  -- ON DELETE RESTRICT prevents deleting a room that still has inventory;
  -- the UI should force the user to move items elsewhere first.
  room_id uuid not null references hearth.rooms(id) on delete restrict,

  -- Three top-level buckets driving UI grouping and icon sets.
  --   appliance — fridge, dishwasher, range, washer, dryer
  --   system    — HVAC, water heater, electrical panel, plumbing,
  --               water softener, sump pump, well, septic, generator,
  --               solar, EV charger, radon mitigation, smoke/CO alarms
  --   exterior  — roof, chimney, gutters, siding, windows, deck, fence,
  --               driveway, detached structures
  type text not null
    check (type in ('appliance', 'system', 'exterior')),

  -- User-facing name. Drives what the LLM understands the row to be,
  -- e.g. "Maytag refrigerator", "Carrier furnace", "Asphalt shingle roof".
  name text not null,

  -- Identification fields. All nullable — populated as the user
  -- documents the item over time, often via OCR of a nameplate photo.
  manufacturer text,
  model_number text,
  serial_number text,

  -- Installation history. installed_by is free-form text now; will be
  -- promoted to a FK against a contacts/providers table later.
  installed_on date,
  installed_by text,

  -- Service history. Denormalized for cheap dashboard reads; the
  -- canonical event-by-event service log will live in a future table
  -- and these columns will be kept in sync with its most-recent entries.
  last_serviced_on date,
  next_service_due_on date,

  -- Lifecycle state.
  --   active   — in service, the default
  --   retired  — taken out of service but kept for history (e.g. for
  --              tax cost basis on the old water heater)
  --   replaced — superseded by a newer item; future replaced_by_id
  --              self-FK will link the two
  --   unknown  — placeholder when status genuinely isn't known
  status text not null default 'active'
    check (status in ('active', 'retired', 'replaced', 'unknown')),

  notes text,

  -- Path into a Supabase storage bucket. Bucket itself is created
  -- in a separate storage migration.
  hero_photo_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Primary access pattern: "show me everything in this house" (dashboard,
-- inventory list page). Filter by house_id, often combined with type
-- when the UI is showing a single tab (Appliances, Systems, Exterior).
create index inventory_house_id_type_idx
  on hearth.inventory (house_id, type);

-- Room-scoped lookups: "show me everything in the Kitchen". Worth its
-- own index since the rooms page and per-room views are core UX.
create index inventory_room_id_idx
  on hearth.inventory (room_id);

-- Service-due lookups: "what's due for service in the next 60 days".
-- Partial index excludes the (many) rows without a scheduled service.
create index inventory_next_service_due_on_idx
  on hearth.inventory (house_id, next_service_due_on)
  where next_service_due_on is not null;

-- Reuse the shared updated_at trigger function.
create trigger inventory_set_updated_at
  before update on hearth.inventory
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: scoped through house ownership, same pattern as rooms.
alter table hearth.inventory enable row level security;

create policy "Users can view inventory in their houses"
  on hearth.inventory
  for select
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = inventory.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can insert inventory in their houses"
  on hearth.inventory
  for insert
  to authenticated
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = inventory.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can update inventory in their houses"
  on hearth.inventory
  for update
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = inventory.house_id
        and h.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = inventory.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can delete inventory in their houses"
  on hearth.inventory
  for delete
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = inventory.house_id
        and h.owner_id = auth.uid()
    )
  );