-- Seed a default set of rooms whenever a new house is created. Gives the
-- user a working room list immediately so they don't have to define rooms
-- before adding inventory. The "Exterior" room is part of the default set
-- because inventory.room_id is NOT NULL and outdoor items need a home.
--
-- Users can rename, add, or delete rooms from this default set after the
-- house is created.

create or replace function hearth.seed_default_rooms()
returns trigger
language plpgsql
as $$
begin
  insert into hearth.rooms (house_id, name, kind, sort_order) values
    (new.id, 'Kitchen',          'indoor',  10),
    (new.id, 'Living Room',      'indoor',  20),
    (new.id, 'Primary Bedroom',  'indoor',  30),
    (new.id, 'Primary Bathroom', 'indoor',  40),
    (new.id, 'Basement',         'indoor',  50),
    (new.id, 'Attic',            'indoor',  60),
    (new.id, 'Garage',           'utility', 70),
    (new.id, 'Laundry',          'utility', 80),
    (new.id, 'Exterior',         'outdoor', 90);
  return new;
end;
$$;

create trigger houses_seed_default_rooms
  after insert on hearth.houses
  for each row
  execute function hearth.seed_default_rooms();