-- Issue #216 — Onboarding Milestones: post-setup guidance panel
--
-- The dashboard milestone panel derives three of its four milestones
-- (home photo, emergency video, first appliance) directly from data that
-- already exists in hearth.houses / hearth.documents / hearth.inventory —
-- "detect, don't track." Those need no schema.
--
-- The fourth milestone, "review your habitat findings," is a *view event*:
-- opening the habitat detail modal is not itself a write, so there is no
-- natural data signal to derive it from. This column is the one piece of
-- persisted state the panel needs.
--
-- It is a single JSONB blob rather than a dedicated boolean column so that
-- future view-event milestones (which, unlike write-event milestones, have
-- no table of their own to look at) extend the same shape without another
-- migration. Today it carries exactly one key:
--
--   { "habitat_reviewed": true }
--
-- set fire-and-forget by markHabitatReviewedAction when the user first
-- opens a habitat finding modal. Write-event milestones are NEVER stored
-- here — deriving them from their own tables is self-healing and cannot
-- drift out of sync with reality.
--
-- Nullable is intentionally avoided: NOT NULL DEFAULT '{}'::jsonb means
-- every existing house reads as "nothing viewed yet," which is the correct
-- starting state, so no backfill is required. The column rides the existing
-- hearth.houses row RLS policy — no policy change.

alter table hearth.houses
  add column onboarding_state jsonb not null default '{}'::jsonb;

comment on column hearth.houses.onboarding_state is
  'Onboarding milestone state for view-event milestones with no natural data signal (issue #216). Write-event milestones (photo, emergency video, first appliance) are derived from their own tables and never stored here. Today: { "habitat_reviewed": boolean }.';
