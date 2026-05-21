// Pure helpers for the Smart Uploader's match-existing-inventory step.
//
// findMatchingInventoryAction used to lean on Postgres `ilike` for an
// exact case-insensitive match against hearth.inventory.name. That worked
// only when the AI returned the same classification.name on every photo
// of the same item — in practice the model drifts between equivalent
// forms ("Microwave" / "Microwave Oven", "Washer" / "Washing Machine",
// "Dryer" / "Clothes Dryer", "Water Heater" / "Hot Water Heater") and
// the user ends up creating a duplicate inventory row.
//
// These helpers normalize both sides to a canonical form before comparing.
// The alias map is intentionally tight — only the synonym pairs we've
// actually observed in Grok output land here, per CLAUDE.md's "keep tight"
// guidance for hand-built normalization rules. Add a pair only when the
// model has been seen returning it.
//
// Lives outside the server-action file so it can be unit-tested without
// pulling in "use server" + Supabase imports — same pattern as
// research-significant-fields.ts.

// Whole-string aliases mapped to their canonical form. The match is on
// the fully-normalized string (lowercased, punctuation-stripped,
// whitespace-collapsed) so that "Pressure Washer" never accidentally
// collapses to "Washing Machine" and "Dishwasher" never accidentally
// matches "Washer". Substring rewrites would risk both.
const ALIAS_RULES: ReadonlyMap<string, string> = new Map([
  ["microwave oven", "microwave"],
  ["washer", "washing machine"],
  ["clothes washer", "washing machine"],
  ["clothes dryer", "dryer"],
  ["hot water heater", "water heater"],
  ["fridge", "refrigerator"],
  ["ac", "air conditioner"],
  ["air conditioning", "air conditioner"],
  ["gas furnace", "furnace"],
]);

export function normalizeInventoryName(name: string): string {
  let s = name.toLowerCase().trim();
  // Replace any non-alphanumeric character with a space so that
  // "Air-Conditioner" and "Air Conditioner" land at the same canonical.
  s = s.replace(/[^a-z0-9 ]/g, " ");
  // Collapse runs of whitespace introduced by the punctuation strip.
  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) return "";
  return ALIAS_RULES.get(s) ?? s;
}

export function inventoryNameMatches(a: string, b: string): boolean {
  const na = normalizeInventoryName(a);
  const nb = normalizeInventoryName(b);
  // Empty-on-empty is not a match — an inventory row with a blank name
  // shouldn't silently swallow every new photo. Guard explicitly.
  if (na.length === 0 || nb.length === 0) return false;
  return na === nb;
}
