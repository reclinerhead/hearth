-- Issue #142 — Add water_source + basement_present to hearth.houses
--
-- Two property-situation inputs the Superfund risk-reasoning UI needs to
-- calibrate per-site labels and recommended actions (well users see
-- "test your well for [contaminants]"; municipal users see "review your
-- utility's CCR"; VOC-bearing sites near homes with basements light up
-- vapor-intrusion concerns). Future habitat modules (water-system
-- violations, soil testing, future radon refinements) will read the
-- same fields off `HouseContext`.
--
-- Both columns are nullable with no default — existing rows backfill to
-- null and the application treats null as "we don't know" rather than
-- "no basement" / "no water source." The Superfund label rules
-- (issue #149) explicitly handle the all-null case as "label suppressed"
-- so users who skip both onboarding questions don't get inflated
-- findings.
--
-- water_source is text with a CHECK constraint enforcing the enum
-- (`well | municipal | shared | unknown`) rather than a Postgres ENUM
-- type so the value set can evolve via migration without the rigidity
-- of `alter type` rewrites. `unknown` is a legitimate first-class
-- value alongside null: null means "we never asked"; `unknown` means
-- "we asked and the user said they don't know" — a small but useful
-- distinction for future "complete your profile" prompts.
--
-- basement_present is a plain nullable boolean. True / false / null
-- covers Yes / No / Not sure in the UI. There is no `partial` value:
-- the underlying reality (crawl space + partial basement) is uncommon
-- enough that the third state ("not sure") is the right home for those
-- cases too.

alter table hearth.houses
  add column water_source text
    check (water_source in ('well', 'municipal', 'shared', 'unknown')),
  add column basement_present boolean;

comment on column hearth.houses.water_source is
  'Property water source enum (well | municipal | shared | unknown). Null = never captured; unknown = user explicitly said they don''t know. Issue #142.';

comment on column hearth.houses.basement_present is
  'Whether the home has a basement. Null = never captured or user picked "Not sure" (partial / crawl-space cases land here). Issue #142.';
