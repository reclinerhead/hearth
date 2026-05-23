-- Renewal-portal deep-link for renewal-kind maintenance tasks (issue #137).
--
-- The direct-event pipeline already classifies each renewal document
-- against a per-issuer table that may carry a `renewal_url_template`
-- (Michigan SOS today, more US issuers later). The task detail modal
-- wants to render a "Renew now" link when the URL is known, but the
-- field today only lives on the classifier — not on the task row.
--
-- Adding a column means each persisted task is self-describing: the
-- modal reads `renewal_url` straight off the row instead of re-running
-- a classifier that may have drifted by then.

alter table hearth.maintenance_tasks
  add column renewal_url text;

comment on column hearth.maintenance_tasks.renewal_url is
  'Optional renewal portal URL. Populated by the direct-event pipeline '
  'from the classifier renewal_url_template at task-creation time. '
  'Reserved for kind=renewal rows; nullable for everything else.';
