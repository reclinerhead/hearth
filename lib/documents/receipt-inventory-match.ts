/**
 * Pure matching logic for receipt → inventory attachment (issue #117).
 *
 * Extracted from the find-inventory-by-receipt server action so it can
 * be unit-tested against fixture inventory sets without standing up a
 * Supabase mock. The server action becomes a thin Supabase wrapper:
 * read the house's inventory rows, hand them and the receipt's
 * identifiers to this function, return the result.
 */

import { caseFoldSerial, normalizeSerial } from "./serial-normalize";

export type ReceiptMatchableInventory = {
  id: string;
  name: string;
  type: "appliance" | "system" | "exterior" | "property";
  subtype: "vehicle" | "pet" | null;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  room_id: string;
};

export type ReceiptMatchResult = {
  strong_match: ReceiptMatchableInventory | null;
  suggested_matches: ReceiptMatchableInventory[];
};

export type MatchInventoryByReceiptInput = {
  inventory: ReceiptMatchableInventory[];
  referencedSerials: string[];
  referencedModelNumbers: string[];
};

/**
 * Two-pass matcher:
 *
 *   1. Case-folded exact match on serial_number. A receipt that prints
 *      a VIN verbatim is essentially proof of attachment to the
 *      vehicle whose nameplate also has that VIN.
 *   2. Punctuation-normalized match on serial_number for entries that
 *      didn't hit in pass 1. Receipts often print VINs with separator
 *      characters ("1HGBH41J-XMN-109186") that the user's
 *      nameplate-captured serial doesn't have.
 *
 * Model numbers are a secondary signal — a model number alone isn't
 * unique (a homeowner might own two of the same washer), so model
 * matches surface as suggestions only, never strong. The literal
 * "unknown" sentinel on inventory.model_number (see
 * lib/inventory/model-number.ts) is filtered out — otherwise every
 * receipt with no model number would collide with every sentinel row.
 *
 * A single serial hit becomes the strong match. Multiple serial hits
 * surface as suggestions so the user can disambiguate.
 */
export function matchInventoryByReceipt(
  input: MatchInventoryByReceiptInput,
): ReceiptMatchResult {
  const empty: ReceiptMatchResult = {
    strong_match: null,
    suggested_matches: [],
  };

  if (
    input.referencedSerials.length === 0 &&
    input.referencedModelNumbers.length === 0
  ) {
    return empty;
  }

  const receiptSerialsCaseFolded = new Set(
    input.referencedSerials.map(caseFoldSerial).filter(isString),
  );
  const receiptSerialsNormalized = new Set(
    input.referencedSerials.map(normalizeSerial).filter(isString),
  );
  const receiptModelsCaseFolded = new Set(
    input.referencedModelNumbers.map(caseFoldSerial).filter(isString),
  );

  const serialHits: ReceiptMatchableInventory[] = [];
  const modelOnlyHits: ReceiptMatchableInventory[] = [];
  const serialHitIds = new Set<string>();

  for (const row of input.inventory) {
    const rowSerialCaseFolded = caseFoldSerial(row.serial_number);
    const rowSerialNormalized = normalizeSerial(row.serial_number);
    const rowModelCaseFolded = caseFoldSerial(row.model_number);

    const serialMatch =
      (rowSerialCaseFolded != null &&
        receiptSerialsCaseFolded.has(rowSerialCaseFolded)) ||
      (rowSerialNormalized != null &&
        receiptSerialsNormalized.has(rowSerialNormalized));

    if (serialMatch) {
      serialHits.push(row);
      serialHitIds.add(row.id);
      continue;
    }

    if (
      rowModelCaseFolded != null &&
      rowModelCaseFolded !== "UNKNOWN" &&
      receiptModelsCaseFolded.has(rowModelCaseFolded)
    ) {
      modelOnlyHits.push(row);
    }
  }

  let strongMatch: ReceiptMatchableInventory | null = null;
  const suggestions: ReceiptMatchableInventory[] = [];

  if (serialHits.length === 1) {
    strongMatch = serialHits[0];
  } else if (serialHits.length > 1) {
    suggestions.push(...serialHits);
  }

  for (const row of modelOnlyHits) {
    if (!serialHitIds.has(row.id)) suggestions.push(row);
  }

  return {
    strong_match: strongMatch,
    suggested_matches: suggestions,
  };
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
