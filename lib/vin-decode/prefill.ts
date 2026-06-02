// Pure prefill helpers shared by the two VIN-decode callers:
//
//   1. The detail-page decode route (app/api/inventory/[id]/decode-vin)
//      — enriches an existing inventory row after the fact.
//   2. The pre-save decode route (app/api/vin/decode) — decodes at
//      Smart Uploader review time, before any row exists, so the review
//      stage can prefill Manufacturer / Model / Name.
//
// Both turn an NHTSA decode into the same handful of display fields and
// apply the same "YYYY Make Model" naming + generic-name heuristics.
// Keeping the logic here (rather than private to one route) is what
// lets the two paths stay in lockstep — a name composed one way on the
// detail page and another way at review time would be a silent drift.

import type { VinDecodeResult } from "./decode";

// Parse NHTSA's ModelYear string. The endpoint returns it as a numeric
// string ("2018") or null/empty when the year isn't encoded (some
// pre-1981 VINs, some non-US vehicles).
export function parseModelYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1900 || parsed > 2100) return null;
  return parsed;
}

// NHTSA returns Make / Manufacturer fields in SCREAMING CAPS. Match the
// Hearth voice — Title Case — so the inventory row reads cleanly
// alongside user-entered manufacturers like "Whirlpool" or "Carrier".
export function toTitleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((token) => {
      if (token.length === 0) return token;
      if (/^\s+$/.test(token) || token === "-") return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join("");
}

// Compose a "YYYY Make Model" display name from the available fields.
// Returns null when not enough is known — we won't build a name from a
// partial value like "Toyota" alone.
export function composeVehicleName(args: {
  year: number | null;
  make: string | null;
  model: string | null;
}): string | null {
  const parts = [
    args.year ? String(args.year) : null,
    args.make ?? null,
    args.model ?? null,
  ].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length < 2) return null;
  return parts.join(" ");
}

// Heuristic: does a row's `name` look like a generic placeholder the
// user would be happy to see replaced? The list covers the vocabulary
// we've seen in practice plus the empty / whitespace case. Anything
// else is treated as personalized — we don't touch "Beth's Car" or
// "Dad's Truck" even though they're short, because the user clearly
// meant something specific.
export const GENERIC_VEHICLE_NAMES = new Set([
  "vehicle",
  "car",
  "truck",
  "suv",
  "van",
  "minivan",
  "motorcycle",
  "bike",
  "auto",
  "automobile",
  "my car",
  "my truck",
  "my vehicle",
]);

export function isGenericVehicleName(
  name: string | null | undefined,
): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  if (normalized === "") return true;
  return GENERIC_VEHICLE_NAMES.has(normalized);
}

// The decoded fields the review stage and the detail page prefill from.
// `displayName` is the composed "YYYY Make Model" (or null when fewer
// than two parts are known); the caller decides whether to apply it
// based on whether the current name is generic.
export type VinPrefill = {
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
  displayName: string | null;
};

// Turn a raw NHTSA decode into the trimmed, display-ready prefill the
// pre-save path applies. Title-cases Make, parses ModelYear, and
// composes the "YYYY Make Model" name from the decoded values alone
// (the detail-page route composes against effective row values
// instead, so it keeps its own composeVehicleName call).
export function buildVinPrefill(result: VinDecodeResult): VinPrefill {
  const manufacturer = result.raw.Make ? toTitleCase(result.raw.Make) : null;
  const model = result.raw.Model ?? null;
  const modelYear = parseModelYear(result.raw.ModelYear ?? null);
  const displayName = composeVehicleName({ year: modelYear, make: manufacturer, model });
  return { manufacturer, model, modelYear, displayName };
}
