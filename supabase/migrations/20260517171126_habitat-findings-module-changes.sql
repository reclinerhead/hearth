-- Migration: align habitat_findings with the finding detail page contract

-- 1. Severity rename. Drop the old check, migrate existing values,
--    add the new check.
alter table hearth.habitat_findings
  drop constraint if exists habitat_findings_severity_check;

update hearth.habitat_findings
set severity = case severity
  when 'good'     then 'favorable'
  when 'low'      then 'caution'
  when 'moderate' then 'caution'
  when 'high'     then 'concern'
  else severity
end
where severity in ('good', 'low', 'moderate', 'high');

alter table hearth.habitat_findings
  add constraint habitat_findings_severity_check
  check (severity in (
    'beneficial', 'favorable', 'neutral', 'caution', 'concern', 'critical'
  ));

-- 2. Severity weight as a stored generated column for deterministic
--    ordering.
alter table hearth.habitat_findings
  add column severity_weight smallint
  generated always as (
    case severity
      when 'beneficial' then 0
      when 'favorable'  then 1
      when 'neutral'    then 2
      when 'caution'    then 3
      when 'concern'    then 4
      when 'critical'   then 5
    end
  ) stored;

create index habitat_findings_severity_weight_idx
  on hearth.habitat_findings (house_id, severity_weight desc);

-- 3. Category for dashboard grouping.
alter table hearth.habitat_findings
  add column category text;

-- Backfill from existing module_key values. New modules set this in
-- their own check() implementation.
update hearth.habitat_findings
set category = 'environmental'
where module_key in ('epa_radon_zone', 'epa_superfund_proximity', 'fema_flood_zone');

-- 4. Findings shape versioning.
alter table hearth.habitat_findings
  add column findings_version smallint not null default 1;