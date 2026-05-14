-- Enable Supabase Realtime broadcasts for hearth.houses.
--
-- The Day One Briefing workflow runs in the background and writes Zillow
-- results back to the house row. The dashboard subscribes to row updates
-- via Realtime so facts populate in place without a manual refresh.
--
-- Supabase Realtime only broadcasts changes for tables explicitly added
-- to the supabase_realtime publication. Without this, postgres_changes
-- subscriptions on hearth.houses silently never fire.
--
-- The publication itself is provided by Supabase and exists on both the
-- local stack and the remote project. Adding the same table twice is an
-- error, so we guard with a do-block that checks pg_publication_tables.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'hearth'
      and tablename = 'houses'
  ) then
    alter publication supabase_realtime add table hearth.houses;
  end if;
end $$;
