-- Enable Supabase Realtime broadcasts for hearth.inventory.
--
-- The maintenance-synthesis workflow (issue #126) runs in the background
-- and writes the run trace to hearth.inventory.last_synthesis_run at
-- completion. The inventory detail page subscribes to row updates via
-- Realtime so the "Build maintenance plan" button can flip out of its
-- in-flight state the moment the workflow finishes, without a manual
-- refresh.
--
-- Supabase Realtime only broadcasts changes for tables explicitly added
-- to the supabase_realtime publication. Without this, postgres_changes
-- subscriptions on hearth.inventory silently never fire (same gotcha
-- documented in 20260514180500_houses_realtime_publication.sql).
--
-- RLS continues to enforce scope — only the row's owner receives events.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'hearth'
      and tablename = 'inventory'
  ) then
    alter publication supabase_realtime add table hearth.inventory;
  end if;
end $$;
