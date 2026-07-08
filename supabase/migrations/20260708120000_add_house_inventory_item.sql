-- Built-in "House" inventory item (issue #306). Gives house-level
-- documents — property-tax statements, homeowner's insurance, deeds,
-- mortgage paperwork — a correct home instead of being misfiled onto an
-- appliance or a vehicle. One auto-created inventory row per house
-- represents the property itself and reuses the existing inventory
-- detail page as its document surface.
--
-- Discriminator: a dedicated `is_house` boolean, NOT a fifth `type`
-- value. This is deliberate given Hearth's remote-only shared DB (dev,
-- preview, prod all read this database): the moment this migration is
-- pushed, the *currently deployed* app starts reading these new rows. A
-- 5th `type='house'` value would crash `/inventory` immediately —
-- `groupByType` in app/(app)/inventory/page.tsx does
-- `groups[item.type].push(...)` against a 4-key object, so an unhandled
-- `'house'` key throws a TypeError before the handling code ships. A
-- boolean flag lets the row keep a valid `type`, so old code degrades
-- gracefully (the item merely shows under its bucket section) while new
-- code keys off `is_house`. The flag is also the queryable guard the
-- feature needs (non-deletable, excluded from listings).

-- 1. The discriminator. Default false so every existing and future
--    non-house row is unaffected; the trigger / backfill below flip it
--    true only for the one built-in row per house.
alter table hearth.inventory
  add column is_house boolean not null default false;

-- 2. Exactly one house item per house. Partial unique index doubles as
--    the idempotency arbiter for the trigger and backfill (ON CONFLICT).
create unique index inventory_one_house_item_per_house
  on hearth.inventory (house_id)
  where is_house;

-- Helper: pick the room a house item is parked in. inventory.room_id is
-- NOT NULL, but the house item is never shown "in a room" — is_house
-- rendering suppresses the room line. We park it in the seeded
-- 'Exterior' room (the rooms trigger always creates one, and it's the
-- outdoor/whole-property bucket), falling back to any room defensively.
-- Returns null only if the house somehow has zero rooms, in which case
-- the caller skips the insert rather than violating the NOT NULL.
create or replace function hearth.pick_house_item_room(p_house_id uuid)
returns uuid
language sql
stable
as $$
  select r.id
  from hearth.rooms r
  where r.house_id = p_house_id
  order by (r.name = 'Exterior') desc, r.sort_order asc, r.id asc
  limit 1;
$$;

-- 3. Auto-create the house item for every new house. Mirrors the
--    seed_default_rooms trigger; the name `houses_seed_house_item` sorts
--    after `houses_seed_default_rooms`, and Postgres fires same-event
--    triggers in name order, so the rooms exist before we place the item.
--    `type` is an inert bucket here ('exterior' — the house is the
--    ultimate structure); is_house is the load-bearing truth. Name is the
--    street address so the row is self-identifying if it ever surfaces in
--    a plain list; the detail page renders a friendlier title.
create or replace function hearth.seed_house_inventory_item()
returns trigger
language plpgsql
as $$
declare
  v_room_id uuid;
begin
  v_room_id := hearth.pick_house_item_room(new.id);
  if v_room_id is not null then
    insert into hearth.inventory (house_id, room_id, type, name, is_house)
    values (
      new.id,
      v_room_id,
      'exterior',
      coalesce(nullif(new.address_line1, ''), 'Your home'),
      true
    )
    on conflict (house_id) where is_house do nothing;
  end if;
  return new;
end;
$$;

create trigger houses_seed_house_item
  after insert on hearth.houses
  for each row
  execute function hearth.seed_house_inventory_item();

-- 4. Backfill existing houses. Idempotent via the partial unique index:
--    houses that already have a house item are skipped, and re-running
--    the statement is a no-op. Houses with zero rooms are skipped (the
--    NOT NULL room_id can't be satisfied) — none exist today, but the
--    guard keeps the backfill safe rather than erroring.
insert into hearth.inventory (house_id, room_id, type, name, is_house)
select
  h.id,
  hearth.pick_house_item_room(h.id),
  'exterior',
  coalesce(nullif(h.address_line1, ''), 'Your home'),
  true
from hearth.houses h
where hearth.pick_house_item_room(h.id) is not null
  and not exists (
    select 1 from hearth.inventory i
    where i.house_id = h.id and i.is_house
  );
