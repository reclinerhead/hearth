import type { MergeableHouseFacts } from "./merge";

type FactKey = keyof MergeableHouseFacts;

// Order matters — this is the order labels appear in the dashboard's
// post-refresh summary. lot_size_sqft and lot_size_acres collapse to a
// single "Lot size" entry because they describe the same fact in
// different units. description_source is intentionally absent because
// provenance is invisible to the user — only the visible `description`
// counts as a change worth surfacing.
const FIELD_LABELS: Array<[FactKey, string]> = [
  ["year_built", "Year built"],
  ["living_area_sqft", "Living area"],
  ["lot_size_sqft", "Lot size"],
  ["lot_size_acres", "Lot size"],
  ["bedrooms", "Bedrooms"],
  ["bathrooms", "Bathrooms"],
  ["heating_summary", "Heating"],
  ["cooling_summary", "Cooling"],
  ["parcel_id", "Parcel ID"],
  ["description", "Description"],
];

/**
 * Compare two snapshots of a house's mergeable facts and return human-readable
 * labels for the fields the refresh actually changed.
 *
 * Mirrors the persist-step merge rule: a field counts as changed only when
 * the new value is non-null AND different from the old value. A null in the
 * "after" snapshot is never a change — it means the refresh didn't surface
 * anything for that field, and the previous value was preserved.
 *
 * Returns labels in `FIELD_LABELS` order, with duplicates (lot size) collapsed.
 */
export function diffHouseFacts(
  before: MergeableHouseFacts,
  after: MergeableHouseFacts,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const [field, label] of FIELD_LABELS) {
    const newValue = after[field];
    if (newValue === null) continue;
    if (newValue === before[field]) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    ordered.push(label);
  }
  return ordered;
}
