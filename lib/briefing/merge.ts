import type { ZillowLookupResult } from "./zillow";

// The subset of hearth.houses columns the briefing workflow can write.
// Kept narrow so the merge logic never accidentally touches address fields,
// owner_id, or anything else outside the briefing's remit.
export type MergeableHouseFacts = {
  year_built: number | null;
  living_area_sqft: number | null;
  lot_size_sqft: number | null;
  lot_size_acres: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  heating_summary: string | null;
  cooling_summary: string | null;
  parcel_id: string | null;
  description: string | null;
  description_source: string | null;
};

// description_source is provenance — once set, it records the original
// upstream copy and must never change, even if a later run returns different
// non-null text.
const PROVENANCE_FIELDS = new Set<keyof MergeableHouseFacts>([
  "description_source",
]);

// Structural facts about the property. These are the fields a homeowner is
// most likely to scrutinize (and most likely to notice as *wrong* if they
// change between refreshes), so once we've persisted a non-null value we
// keep it instead of letting a stochastic re-run silently clobber it with
// a different non-null value. A future surface for the user to manually
// correct a wrong first-run value can override this rule explicitly; this
// merge layer is for the unattended background-refresh path. Issue #151.
//
// Description is intentionally NOT in this set — a later run that produces
// a richer description should still be allowed to replace a thinner one,
// and description_source's provenance lock already preserves the original
// upstream copy for audit.
const STICKY_FACT_FIELDS = new Set<keyof MergeableHouseFacts>([
  "year_built",
  "living_area_sqft",
  "lot_size_sqft",
  "lot_size_acres",
  "bedrooms",
  "bathrooms",
  "heating_summary",
  "cooling_summary",
  "parcel_id",
]);

// Run-lifecycle fields. These describe the briefing run itself, not the
// property, so they always update regardless of the current row's values.
export type BriefingSuccessUpdate = Partial<MergeableHouseFacts> & {
  briefing_status: "completed";
  briefing_generated_at: string;
  briefing_error: null;
};

/**
 * Build the update payload to persist a fresh Zillow result against a house
 * row that may already hold data from a prior run.
 *
 * Sonar's results are stochastic — each run returns a different subset of
 * the available fields, AND occasionally returns a different (wrong) value
 * for a structural fact the prior run got right. The merge rule has three
 * tiers to handle that:
 *
 *   - Structural facts (year_built, sqft, lot, bedrooms, bathrooms,
 *     heating, cooling, parcel) are STICKY: once non-null on the row, a
 *     later run cannot overwrite them, even with a different non-null
 *     value. This is the issue #151 trust fix — the homeowner would
 *     immediately notice if year_built or lot size shifted between
 *     refreshes, and we'd rather hold the first value than let a drifting
 *     refresh silently rewrite it.
 *   - Description is liquid: a later run that produces a richer
 *     description is allowed to replace a thinner one, because verbose
 *     prose tends to improve across calls in a way that integers don't.
 *     description_source's provenance lock preserves the original copy
 *     for audit even when description itself updates.
 *   - description_source is provenance-locked: once set, never
 *     overwritten — that column is the unmodified upstream copy.
 *
 * A null from a fresh run never overwrites a non-null value on any field.
 *
 * Run-lifecycle fields (briefing_status / briefing_generated_at /
 * briefing_error) always update — they describe the run, not the property.
 *
 * The result contains only the fields that should actually change, plus the
 * unconditional lifecycle fields. Feeding it directly to a Supabase
 * .update() call means untouched fields are left exactly as they are in the
 * database.
 */
export function buildBriefingSuccessUpdate({
  current,
  result,
  now,
}: {
  current: MergeableHouseFacts;
  result: ZillowLookupResult;
  now: string;
}): BriefingSuccessUpdate {
  const incoming: MergeableHouseFacts = {
    year_built: result.yearBuilt,
    living_area_sqft: result.livingAreaSqft,
    lot_size_sqft: result.lotSizeSqft,
    lot_size_acres: result.lotSizeAcres,
    bedrooms: result.bedrooms,
    bathrooms: result.bathrooms,
    heating_summary: result.heating,
    cooling_summary: result.cooling,
    parcel_id: result.parcelNumber,
    description: result.description,
    description_source: result.description,
  };

  const dataFields: Partial<MergeableHouseFacts> = {};

  const fields = Object.keys(incoming) as Array<keyof MergeableHouseFacts>;
  for (const field of fields) {
    applyMerge(dataFields, current, incoming, field);
  }

  return {
    ...dataFields,
    briefing_status: "completed",
    briefing_generated_at: now,
    briefing_error: null,
  };
}

function applyMerge<K extends keyof MergeableHouseFacts>(
  payload: Partial<MergeableHouseFacts>,
  current: MergeableHouseFacts,
  incoming: MergeableHouseFacts,
  field: K,
): void {
  const incomingValue = incoming[field];

  if (PROVENANCE_FIELDS.has(field)) {
    // Provenance fields: only write when the row has no value yet and the
    // new run produced one. Anything else (current set, current null +
    // incoming null) is a no-op.
    if (current[field] === null && incomingValue !== null) {
      payload[field] = incomingValue;
    }
    return;
  }

  if (incomingValue === null) return;
  if (current[field] === incomingValue) return;

  // Sticky structural facts: once non-null, a later run cannot overwrite
  // the value. See STICKY_FACT_FIELDS for the rationale (issue #151).
  if (STICKY_FACT_FIELDS.has(field) && current[field] !== null) return;

  payload[field] = incomingValue;
}
