// Static typical-service-life table for big-ticket home systems and
// appliances (issue #212). Pure module, versioned with code.
//
// This is the deliberately pragmatic half of the lifecycle outlook: a
// hardcoded "typical years of service" per category, accurate enough to
// rank a homeowner's top-three replacement horizons against their real
// inventory. We do NOT read the LLM `service_life` free-text on
// inventory insights here — that field is prose, not a structured
// number. The seam to upgrade to research-derived, confidence-banded
// per-item estimates belongs to the full capital-planning timeline page
// later; this table is what ships today.
//
// Categories are resolved from the item's free-text `name` by keyword
// match (the same spirit as the nameplate canonical-name list), layered
// on top of the shared `normalizeInventoryName` so the synonym aliases it
// already encodes ("Hot Water Heater" → "water heater", "Fridge" →
// "refrigerator", "AC" → "air conditioner", "Gas Furnace" → "furnace")
// come for free. This keeps "Carrier furnace" and "Asphalt shingle roof"
// landing on the right bucket without forcing a typed category column
// onto the inventory schema.

import { normalizeInventoryName } from "./match-name";

export type ServiceLifeEntry = {
  /** Canonical human label for the matched category, used in copy. */
  label: string;
  /**
   * Typical expected service life in years (single number). The
   * "approaching" / "past" thresholds are derived from this in
   * lifecycle-outlook.ts, not stored here.
   */
  typicalYears: number;
};

type CategoryRule = {
  entry: ServiceLifeEntry;
  /**
   * Keywords matched against the normalized item name. Multi-word
   * keywords (containing a space) are substring-matched; single-word
   * keywords are matched against the name's word set so short tokens like
   * "ac" don't accidentally fire inside unrelated words (e.g. "furnace").
   */
  keywords: string[];
};

// Typical residential single-number estimates — first-guess seeds, refine
// in review. Ordered most-specific-first so an overlap resolves to the
// more precise category.
const CATEGORY_RULES: CategoryRule[] = [
  { entry: { label: "Water heater", typicalYears: 11 }, keywords: ["water heater"] },
  {
    entry: { label: "Water softener", typicalYears: 12 },
    keywords: ["water softener", "softener"],
  },
  {
    entry: { label: "Air conditioner", typicalYears: 15 },
    keywords: ["air conditioner", "air conditioning", "central air", "ac"],
  },
  { entry: { label: "Furnace", typicalYears: 18 }, keywords: ["furnace"] },
  {
    entry: { label: "Refrigerator", typicalYears: 13 },
    keywords: ["refrigerator", "fridge"],
  },
  { entry: { label: "Dishwasher", typicalYears: 10 }, keywords: ["dishwasher"] },
  {
    entry: { label: "Washing machine", typicalYears: 11 },
    keywords: ["washing machine"],
  },
  { entry: { label: "Dryer", typicalYears: 13 }, keywords: ["dryer"] },
  { entry: { label: "Sump pump", typicalYears: 8 }, keywords: ["sump pump", "sump"] },
  { entry: { label: "Roof", typicalYears: 22 }, keywords: ["roof"] },
];

/**
 * Resolve an inventory item's free-text name to a service-life entry, or
 * null when the name doesn't match any tracked big-ticket category. A
 * null result means the item simply isn't rankable in the lifecycle
 * outlook and drops out — it is not an error.
 */
export function resolveServiceLife(name: string): ServiceLifeEntry | null {
  const normalized = normalizeInventoryName(name);
  if (!normalized) return null;
  const words = new Set(normalized.split(" "));
  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      const matched = keyword.includes(" ")
        ? normalized.includes(keyword)
        : words.has(keyword);
      if (matched) return rule.entry;
    }
  }
  return null;
}
