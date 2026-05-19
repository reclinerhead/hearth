// Pure helper that decides whether an inventory edit invalidates the
// previously-generated "What we know about appliances like yours" research.
//
// The Research panel's lookup is grounded on three fields: manufacturer,
// model_number, and type. If any of those move between save attempts the
// previously stored ai_insights are stale and a re-run is required (see
// docs/TechnicalGuide.md "Inventory edit and delete"). Comparisons are
// trim/case-insensitive so "  Whirlpool" → "whirlpool" is not treated as
// a change worthy of burning a Sonar call.
//
// Lives outside the server-action file so it can be unit-tested without
// pulling in "use server" + Supabase imports.

import type { EquipmentType } from "@/types/document";

export type ResearchSignificantFields = {
  manufacturer: string | null;
  model_number: string | null;
  type: EquipmentType;
};

export function researchSignificantFieldsChanged(
  before: ResearchSignificantFields,
  after: ResearchSignificantFields,
): boolean {
  if (before.type !== after.type) return true;
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
