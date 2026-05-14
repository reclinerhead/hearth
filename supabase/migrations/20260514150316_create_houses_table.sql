-- Create the houses table: a user's home, with address from Mapbox geocoding
-- and core facts populated either from the user or from later public-records pulls.

create table hearth.houses (
  id uuid primary key default gen_random_uuid(),

  -- Ownership. References the shared public.profiles table (which itself
  -- references auth.users). A single user can own many houses; multi-owner
  -- households will be handled via a future join table, not by extending this column.
  owner_id uuid not null references public.profiles(id) on delete cascade,

  -- User-facing label. Optional — falls back to the address in UI.
  nickname text,

  -- Address. Populated from a Mapbox autocomplete selection during onboarding.
  -- All required because we don't save a house until geocoding succeeds.
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',

  -- County: extracted from the Mapbox `context` array (with "County" suffix stripped).
  -- Needed for public-records work (BS&A, county GIS, etc.) which is county-scoped.
  county text,

  -- Geocoded coordinates. Required since we only save Mapbox-resolved addresses.
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,

  -- Mapbox identifiers. mapbox_id is their stable place ID — useful for re-querying
  -- without re-geocoding. mapbox_raw stashes the full response for future use
  -- (neighborhood, district, accuracy, etc.); cheap insurance against having
  -- thrown away a field we later want.
  mapbox_id text,
  mapbox_raw jsonb,

  -- Assessor / parcel identifier. Populated later by public-records lookup
  -- (BS&A for Michigan; county GIS elsewhere). Null on insert.
  parcel_id text,

  -- Core house facts. Populated either by the Day One Briefing pull or by the user.
  year_built integer,
  living_area_sqft integer,
  lot_size_sqft integer,
  bedrooms numeric(3, 1),
  bathrooms numeric(3, 1),

  -- Purchase info. Stored in cents to avoid float issues. bigint because a
  -- $1M+ purchase in cents overflows a regular int (int max ≈ $21.4M in cents,
  -- which is technically fine, but bigint costs nothing and removes the ceiling).
  purchase_date date,
  purchase_price_cents bigint,

  -- Hero photo: path into a Supabase storage bucket. Bucket itself is created separately.
  hero_photo_path text,

  -- Timestamp the Day One Briefing was last run. Null until first generation.
  briefing_generated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index on owner_id: every dashboard query filters by the logged-in user's id.
create index houses_owner_id_idx
  on hearth.houses (owner_id);

-- Unique (owner_id, mapbox_id): prevents a single user from accidentally creating
-- two house records for the same Mapbox-resolved address. Not globally unique
-- because two different users can legitimately have the same address.
-- nulls not distinct: treat multiple nulls as duplicates, so a user can't
-- create multiple houses with null mapbox_id either (shouldn't happen given
-- the not-null geocoding flow, but defensive).
create unique index houses_owner_mapbox_id_idx
  on hearth.houses (owner_id, mapbox_id)
  where mapbox_id is not null;

-- Index on parcel_id: useful for dedup and lookups once populated.
-- Partial index excludes the (many) null rows early on.
create index houses_parcel_id_idx
  on hearth.houses (parcel_id)
  where parcel_id is not null;

-- updated_at trigger: keeps the column current on every UPDATE. The trigger
-- function lives in the hearth schema so it's self-contained.
create or replace function hearth.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger houses_set_updated_at
  before update on hearth.houses
  for each row
  execute function hearth.set_updated_at();

-- Row-level security: users can only see and modify their own houses.
alter table hearth.houses enable row level security;

create policy "Users can view their own houses"
  on hearth.houses
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "Users can insert their own houses"
  on hearth.houses
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "Users can update their own houses"
  on hearth.houses
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Users can delete their own houses"
  on hearth.houses
  for delete
  to authenticated
  using (owner_id = auth.uid());