-- Rooms: per-house list of physical spaces used to group inventory items.
-- Every house gets a default set of rooms seeded on creation (handled in
-- application code or a future trigger); users can rename, add, and delete.
-- An "Exterior" room is part of the default set and is used for outdoor
-- inventory (roof, gutters, AC condenser, etc.) so that inventory.room_id
-- can remain NOT NULL.

create table hearth.rooms (
  id uuid primary key default gen_random_uuid(),

  -- The house this room belongs to. Cascade so deleting a house cleans up
  -- its rooms (which in turn will cascade to inventory once that FK exists).
  house_id uuid not null references hearth.houses(id) on delete cascade,

  -- User-facing name. Free-form so users can match their own house's
  -- vocabulary ("Sunroom", "Mudroom", "Barn", "Primary bath").
  name text not null,

  -- Optional categorization for filtering and UI grouping. Kept loose
  -- as a CHECK constraint rather than a separate enum or lookup table;
  -- promote to a richer structure later if it earns it.
  --   indoor    — kitchens, bedrooms, baths, basements, attics, etc.
  --   outdoor   — Exterior, yards, decks, detached structures
  --   utility   — mechanical rooms, laundry, garage when used for storage
  kind text not null default 'indoor'
    check (kind in ('indoor', 'outdoor', 'utility')),

  -- Display order within a house. Lets users sort rooms in a sensible
  -- order in the UI without relying on alphabetical or creation order.
  -- Application code maintains this; defaults to 0 for new rooms.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A house can't have two rooms with the same name. Prevents the
  -- "Kitchen" / "kitchen" duplication problem that pure free-form would
  -- create. Case-insensitive comparison is handled in app code at insert time.
  unique (house_id, name)
);

-- Primary access pattern: "list the rooms for this house, in display order".
-- This index serves both the filter on house_id and the ORDER BY sort_order.
create index rooms_house_id_sort_order_idx
  on hearth.rooms (house_id, sort_order);

-- Reuse the shared updated_at trigger function created in the houses migration.
create trigger rooms_set_updated_at
  before update on hearth.rooms
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: a user can only see and modify rooms that belong
-- to a house they own. The check delegates to houses ownership rather
-- than duplicating ownership on every row.
alter table hearth.rooms enable row level security;

create policy "Users can view rooms in their houses"
  on hearth.rooms
  for select
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = rooms.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can insert rooms in their houses"
  on hearth.rooms
  for insert
  to authenticated
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = rooms.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can update rooms in their houses"
  on hearth.rooms
  for update
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = rooms.house_id
        and h.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hearth.houses h
      where h.id = rooms.house_id
        and h.owner_id = auth.uid()
    )
  );

create policy "Users can delete rooms in their houses"
  on hearth.rooms
  for delete
  to authenticated
  using (
    exists (
      select 1 from hearth.houses h
      where h.id = rooms.house_id
        and h.owner_id = auth.uid()
    )
  );