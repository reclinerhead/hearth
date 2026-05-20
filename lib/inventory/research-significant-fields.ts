// Pure helper that decides whether an inventory edit invalidates the
// previously-generated "What we know about appliances like yours" research.
//
// The Research panel's lookup is grounded on two fields: manufacturer
// and model_number. If either of those moves between save attempts the
// previously stored ai_insights are stale and a re-run is required (see
// docs/TechnicalGuide.md "Inventory edit and delete"). Comparisons are
// trim/case-insensitive so "  Whirlpool" → "whirlpool" is not treated as
// a change worthy of burning a Sonar call.
//
// `type` was historically considered invalidating but is intentionally
// excluded (issue #69): it's an organizational label, not a research-
// grounding fact, and the same physical unit is the same unit whether
// the user files it under appliance, system, or exterior. The model's
// category-framing wording is fixed up the next time the user manually
// clicks "Research again" rather than forced now.
//
// Lives outside the server-action file so it can be unit-tested without
// pulling in "use server" + Supabase imports.

export type ResearchSignificantFields = {
  manufacturer: string | null;
  model_number: string | null;
};

export function researchSignificantFieldsChanged(
  before: ResearchSignificantFields,
  after: ResearchSignificantFields,
): boolean {
  if (normalize(before.manufacturer) !== normalize(after.manufacturer))
    return true;
  if (normalize(before.model_number) !== normalize(after.model_number))
    return true;
  return false;
}

function normalize(s: string | null): string | null {
  if (s === null) return null;
  const trimmed = s.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}
