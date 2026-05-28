-- Issue #193 — Add user-supplied PWSID override to hearth.houses
--
-- When the Water Quality Awareness module resolves a PWSID via EPA's
-- point-in-polygon query, it lands one of two confidence levels on the
-- persisted finding's system_card: "verified" (direct match at the
-- house's exact coordinates) or "inferred" (nearest-polygon fallback
-- within 500m). The findings UI surfaces an "is this right?" affordance
-- on inferred resolutions; this migration wires the two terminal states
-- the user can drive the system into:
--
--   user_confirmed — User saw an inferred match, clicked "Yes, that's
--                    right." PWSID is the same as what EPA inferred,
--                    but we now treat it as authoritative.
--   user_corrected — User entered a different PWSID via the inline
--                    correction input. Overrides whatever EPA's polygon
--                    layer would have returned.
--
-- Both states make the confirmation strip vanish for good. Subsequent
-- WQA re-runs honor the user-supplied PWSID by skipping point-in-polygon
-- entirely and using `water_system_user_pwsid` as the resolved value.
--
-- Format check matches EPA's PWSID convention (2-letter state code +
-- 7-digit identifier, e.g. "MI0003520"). The check is anchored so a
-- typo with extra whitespace or characters fails fast at the column
-- rather than silently breaking EPA lookups downstream.
--
-- The confidence column's CHECK constraint deliberately omits 'verified'
-- and 'inferred' — those land on the persisted finding's system_card
-- from the resolution path, never from the houses row. A houses-row
-- confidence value only exists when the user has acted on the prompt.
--
-- Both columns are nullable; the absence of a value means "user hasn't
-- confirmed or corrected" and the WQA module falls through to the
-- existing EPA polygon resolution.

alter table hearth.houses
  add column water_system_user_pwsid text
    check (water_system_user_pwsid ~ '^[A-Z]{2}[0-9]{7}$'),
  add column water_system_pwsid_confidence text
    check (water_system_pwsid_confidence in ('user_confirmed', 'user_corrected'));

-- Cross-column invariant: a confidence value only makes sense when a
-- PWSID is present, and vice versa. Both null is the unconfirmed state;
-- both set is the confirmed/corrected state. Anything else is broken
-- data — guard at the schema layer rather than relying on application
-- discipline.
alter table hearth.houses
  add constraint houses_water_system_user_pwsid_paired_check
  check (
    (water_system_user_pwsid is null and water_system_pwsid_confidence is null)
    or
    (water_system_user_pwsid is not null and water_system_pwsid_confidence is not null)
  );

comment on column hearth.houses.water_system_user_pwsid is
  'User-supplied PWSID override for the Water Quality Awareness module. When set, WQA''s check() skips EPA polygon resolution and uses this PWSID directly. Null means no user override; the module falls back to EPA''s point-in-polygon + nearest-polygon resolution. Format: 2-letter state code + 7-digit number. Issue #193.';

comment on column hearth.houses.water_system_pwsid_confidence is
  'How the user-supplied PWSID landed here. user_confirmed = user accepted an inferred EPA match; user_corrected = user entered a different PWSID. Never set by the module itself — only by the confirmation UI in the WQA findings panel. Issue #193.';
