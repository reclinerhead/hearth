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
// non-null text. The other fields follow the standard merge rule.
const PROVENANCE_FIELDS = new Set<keyof MergeableHouseFacts>([
  "description_source",
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
 * the available fields. To turn re-runs into an accumulating process rather
 * than a destructive one, the persist step writes a field only when:
 *
 *   - The new value is non-null, AND
 *   - The new value differs from the current row value.
 *
 * A null from a fresh run never overwrites a non-null value already on the
 * row. description_source is a stronger rule: once set, it is never
 * overwritten even by a different non-null value, because that column is
 * the unmodified provenance copy.
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
  payload[field] = incomingValue;
}
