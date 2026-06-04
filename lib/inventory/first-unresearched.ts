// First-research onboarding signal (issue #262).
//
// Drives the dismissible "Research this model" coachmark on the inventory
// detail page. The coachmark is a one-time, house-wide teach: it points a
// brand-new user at the keystone Research action until they've researched
// their first item anywhere in the house, then never again.
//
// The I/O (the "does any inventory row in this house carry non-null
// ai_insights?" query) lives in the detail page's server component; this
// module is just the pure two-condition decision so it can be unit-tested
// without a Supabase round-trip.

/**
 * Whether the first-research coachmark is eligible to show for an inventory
 * item. True only when BOTH conditions hold:
 *   (a) this item has not been researched (its `ai_insights` is null), AND
 *   (b) no item in the house has been researched yet.
 *
 * Once the household has researched anything, the teach is done — we don't
 * re-show it on a later fresh item (the user already understands the feature).
 * The caller is still responsible for the surface-level gates that aren't part
 * of this signal: property items have no Research panel, and an item missing a
 * manufacturer/model can't be researched, so both suppress the coachmark
 * regardless of what this returns.
 */
export function deriveIsFirstUnresearchedItem(input: {
  /** This item already has committed `ai_insights`. */
  itemHasInsights: boolean;
  /** Any item in the house already has committed `ai_insights`. */
  houseHasResearchedItem: boolean;
}): boolean {
  return !input.itemHasInsights && !input.houseHasResearchedItem;
}
