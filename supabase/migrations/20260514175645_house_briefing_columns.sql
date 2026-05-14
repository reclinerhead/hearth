-- Add briefing fields to hearth.houses.
--
-- These columns support the Day One Briefing workflow that populates a house's
-- public-records data after onboarding. The workflow writes to year_built,
-- living_area_sqft, lot_size_sqft, bedrooms, bathrooms, description, and
-- description_source on success, and updates briefing_status / briefing_error /
-- briefing_started_at / briefing_generated_at throughout its lifecycle.

alter table hearth.houses
  -- User-facing description shown on the dashboard. Populated from the source
  -- on initial briefing, but designed to be replaceable later: a future LLM
  -- synthesis step will rewrite this in Hearth's voice, and users can edit it
  -- directly. The unmodified original is preserved in description_source.
  add column description text,

  -- The unmodified description as returned by the public-records source
  -- (Zillow listing description for v1). Never overwritten after initial
  -- population. Acts as provenance for the pre-listing export feature and
  -- as the input to future synthesis. Nullable because not every property
  -- will have a listing description available.
  add column description_source text,

  -- Lifecycle state of the briefing workflow for this house.
  --   pending   — briefing has not been started; default on insert
  --   running   — workflow is currently executing
  --   completed — workflow finished successfully at least once
  --   failed    — last attempt failed; briefing_error has details
  -- 'completed' and 'failed' can transition back to 'running' when the user
  -- triggers a manual refresh, so this represents the latest run's status.
  add column briefing_status text not null default 'pending'
    check (briefing_status in ('pending', 'running', 'completed', 'failed')),

  -- Timestamp the most recent briefing run was started. Null until the first
  -- run kicks off. Useful for showing "Refreshing..." UI when a run is in
  -- flight and for detecting stale 'running' rows (workflows that crashed
  -- without updating status).
  add column briefing_started_at timestamptz,

  -- Error message from the most recent failed run. Null when status is
  -- pending/running/completed. Surfaced to the user as a "we couldn't pull
  -- everything; here's what we have" UX rather than as a raw stack trace.
  add column briefing_error text;

-- Partial index on briefing_status: supports queries like "which houses are
-- currently running a briefing" (for admin/debug views and stale-run cleanup)
-- and "which houses have never been briefed" (for backfill jobs). Excludes
-- the common 'completed' state since we rarely need to filter for it.
create index houses_briefing_status_idx
  on hearth.houses (briefing_status)
  where briefing_status in ('pending', 'running', 'failed');