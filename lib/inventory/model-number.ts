// The AI Insights "Research this model" button is gated on the presence
// of both manufacturer and model_number. Items with no model number on
// the label (radon systems, custom-built equipment, generic exterior
// assets) would be locked out of the lookup even when manufacturer +
// type is plenty for the model to ground on. The convention this module
// codifies: when no model number is captured, store the literal sentinel
// "unknown" so the gating check naturally passes, and filter the sentinel
// out of any display surface that combines manufacturer + model_number
// into an item identifier.
//
// See docs/TechnicalGuide.md "Inventory edit and delete" for the parallel
// convention around research-significant fields.

export const UNKNOWN_MODEL_NUMBER = "unknown";

export function normalizeModelNumberForCreate(value: string | null): string {
  if (value === null) return UNKNOWN_MODEL_NUMBER;
  const trimmed = value.trim();
  return trimmed === "" ? UNKNOWN_MODEL_NUMBER : trimmed;
}

export function isUnknownModelNumber(value: string | null): boolean {
  if (value === null) return true;
  return value.trim().toLowerCase() === UNKNOWN_MODEL_NUMBER;
}

export function displayModelNumber(value: string | null): string | null {
  if (isUnknownModelNumber(value)) return null;
  return value!.trim();
}
