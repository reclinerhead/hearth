-- Restrict the identity columns on the two shared CCR tables (issue #325).
--
-- hearth.water_system_reports and hearth.water_system_report_contributors
-- are shared caches: every authenticated user can SELECT every row
-- (`using (true)`), and only the service-role action layer writes them.
-- That is the right shape for the derived CCR data, but the tables also
-- carry three per-user columns — `water_system_reports.uploaded_by`
-- (auth.users id), `water_system_report_contributors.contributed_by`
-- (auth.users id), and `contributed_for_house_id` (hearth.houses id) —
-- and a row policy cannot hide a column. Any signed-in user could read
-- "user X contributed a report for house Y" for everyone through
-- PostgREST with their own JWT.
--
-- Fix: column-level privileges. Postgres only consults column grants
-- when the role holds no table-level SELECT, so this revokes the
-- table-level SELECT that `20260523201949_fix-realtime-servicerole-perms`
-- and the schema's default privileges handed to `authenticated`, then
-- grants SELECT back on every column except the identity ones. The
-- `using (true)` policies stay: rows remain globally readable, the
-- identity columns do not.
--
-- Consequences worth knowing:
--   * A `select *` (or `.select()` with no column list) from a session
--     client now fails with "permission denied" on these tables. Today
--     the only session-client reader is app/api/reports/water-quality,
--     which selects `extracted_at` explicitly. Service-role readers and
--     writers (finalize-ccr-upload, ccr-cache) are unaffected.
--   * A future `alter table ... add column` on either table must also
--     `grant select (new_column)` to `authenticated`, or the column is
--     invisible to session clients until it does.
--
-- `anon` also held table-level SELECT from the realtime grant. Neither
-- table is in the supabase_realtime publication and the policies are
-- `to authenticated`, so anon never saw a row; the revoke below just
-- keeps anon's grants no wider than authenticated's. `service_role`
-- keeps its table-level grant.

revoke select on hearth.water_system_reports from anon, authenticated;
revoke select on hearth.water_system_report_contributors from anon, authenticated;

grant select (
  id,
  pwsid,
  report_year,
  edition,
  source_document_id,
  content_hash,
  extracted_data,
  ai_model,
  extraction_version,
  extracted_at,
  published_date
) on hearth.water_system_reports to authenticated;

grant select (
  id,
  report_id,
  content_hash,
  document_id,
  contributed_at
) on hearth.water_system_report_contributors to authenticated;
