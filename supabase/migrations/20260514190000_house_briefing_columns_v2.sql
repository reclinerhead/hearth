-- Add additional Zillow briefing fields.
--
-- lot_size_acres complements the existing lot_size_sqft column. Zillow
-- displays lot size in acres above ~0.25 acres and in sqft below; storing
-- both lets us preserve provenance (what the source actually said) and
-- render in whichever unit reads more naturally in a given UI context.
-- The briefing workflow populates whichever Zillow provides; if only one
-- is returned, the validator computes the other.
--
-- heating_summary and cooling_summary are short free-form strings
-- ("Forced air, Gas", "Central"). Left untyped because Zillow's vocabulary
-- isn't constrained enough to justify an enum before we see real variance.
--
-- parcel_id already exists on hearth.houses from the initial migration;
-- this migration does not re-add it. The Zillow workflow populates it
-- from the Details section of the Home Details panel.

alter table hearth.houses
  add column lot_size_acres numeric(8, 4),
  add column heating_summary text,
  add column cooling_summary text;

-- numeric(8,4) supports lot sizes up to 9999.9999 acres with four
-- decimal places of precision. Zillow typically displays 2-3 decimals
-- (e.g. "0.25 Acres", "1.34 Acres"); the extra precision headroom
-- accommodates assessor data which can run to four decimals.
