// Zod schemas for the Grok 4.3 vision call. These define the contract
// between the model and the rest of the system — `generateObject`
// rejects any response that doesn't validate, so getting these right
// (or wrong) propagates everywhere downstream.
//
// Two modes:
//   - classification (Mode A) — used when no existingInventoryData is
//     passed. Discriminated on photo_kind so the model picks exactly
//     one of nameplate / appliance_photo / not_useful.
//   - delta (Mode B) — used when existingInventoryData is passed.
//     Returns only the fields the photo adds to or contradicts.

import { z } from "zod";

const equipmentType = z.enum([
  "appliance",
  "system",
  "exterior",
  "property",
]);

// Property subtype discriminator. Only meaningful when type='property';
// for other types the model returns null. v1 recognizes 'vehicle' (VIN
// plate / car badge) and 'pet' (vet record, microchip card, registration
// document). Other property — TVs, computers, stereos, art — stays
// subtype=null.
const inventorySubtype = z.enum(["vehicle", "pet"]).nullable();

// Bounded label/value lengths exist to prevent the model from returning
// long blobs that would break the detail page's chip layout. 40 chars on
// labels and 120 on values comfortably fit observed nameplate facts like
// "BTU Input" / "40,000" or "Max Working Pressure" / "150 PSI".
const pillSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
});

const nameplateBranch = z.object({
  photo_kind: z.literal("nameplate"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    subtype: inventorySubtype,
    confidence: z.number().min(0).max(1),
  }),
  extracted: z.object({
    manufacturer: z.string().nullable(),
    model_number: z.string().nullable(),
    serial_number: z.string().nullable(),
    installed_on: z.string().nullable(),
    // Expiration / valid-through date for time-bounded grant documents
    // photographed through the nameplate path — a vehicle registration
    // card, an insurance card, a warranty certificate. Null on ordinary
    // appliance/system nameplates and on any photo where no explicit
    // expiration is printed. When present (with issuing_authority), the
    // create-from-document path seeds a renewal task via the direct-event
    // maintenance pipeline — the same task the receipt path produces.
    // Issue #277.
    expiration_date: z.string().nullable(),
    // Issuing authority / vendor for a renewal document — the Secretary
    // of State office for a registration, the carrier for an insurance
    // card. Feeds the renewal classifier's per-issuer matching. Null when
    // expiration_date is null. Issue #277.
    issuing_authority: z.string().nullable(),
    notes: z.string().nullable(),
    pills: z.array(pillSchema),
  }),
  room_suggestion: z.string().nullable(),
});

const appliancePhotoBranch = z.object({
  photo_kind: z.literal("appliance_photo"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    subtype: inventorySubtype,
    confidence: z.number().min(0).max(1),
  }),
  extracted: z.null(),
  room_suggestion: z.string().nullable(),
});

const notUsefulBranch = z.object({
  photo_kind: z.literal("not_useful"),
  classification: z.null(),
  extracted: z.null(),
  room_suggestion: z.null(),
});

export const classificationSchema = z.discriminatedUnion("photo_kind", [
  nameplateBranch,
  appliancePhotoBranch,
  notUsefulBranch,
]);

export type ClassificationResult = z.infer<typeof classificationSchema>;

export const deltaSchema = z.object({
  deltas: z.record(
    z.string(),
    z.object({
      currentValue: z.string().nullable(),
      proposedValue: z.string(),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

export type DeltaResult = z.infer<typeof deltaSchema>;

// Receipt extraction (issue #117). Distinct from the classification
// branch above: a receipt isn't a "photo of an appliance," and there's
// no equivalent of `not_useful` worth modeling — a photo that isn't a
// receipt at all should fall out as low ai_confidence with everything
// null, not as a sibling kind.
//
// All structured fields are nullable so the model can be honest about
// what it could not legibly read. Cents-based money matches
// hearth.inventory.estimated_value_cents (bigint-safe in the column,
// integer in this schema).

const receiptLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().nullable(),
  unit_price_cents: z.number().int().nonnegative().nullable(),
  total_cents: z.number().int().nonnegative().nullable(),
});

export const receiptExtractionSchema = z.object({
  vendor_name: z.string().nullable(),
  vendor_address: z.string().nullable(),
  vendor_phone: z.string().nullable(),

  transaction_date: z.string().nullable(),

  // Expiration / valid-through / policy-period-end date for time-bounded
  // grants — vehicle registrations, insurance policies, warranties,
  // permits, licenses. Null on service / purchase / inspection
  // receipts. Consumed by the direct-event maintenance pipeline.
  expiration_date: z.string().nullable(),

  transaction_type: z
    .enum(["service", "purchase", "inspection", "other"])
    .nullable(),

  subtotal_cents: z.number().int().nonnegative().nullable(),
  tax_cents: z.number().int().nonnegative().nullable(),
  total_cents: z.number().int().nonnegative().nullable(),
  currency: z.string().nullable(),

  payment_method: z.string().nullable(),

  line_items: z.array(receiptLineItemSchema),

  // Serials / VINs / model numbers found anywhere on the receipt. The
  // inventory matcher reads these; order doesn't matter, completeness
  // does. Empty arrays are the normal case for receipts referencing no
  // identifiers (a vet visit, a plumber service call).
  referenced_serials: z.array(z.string()),
  referenced_model_numbers: z.array(z.string()),

  notes: z.string().nullable(),

  // Overall confidence on the extraction. Below the receipt-specific
  // threshold (NAMEPLATE_CONFIDENCE_THRESHOLD's receipt sibling, 0.5
  // by default), the review stage shows a "we couldn't read that
  // clearly" affordance rather than the standard fields.
  ai_confidence: z.number().min(0).max(1),
});

export type ReceiptExtractionResult = z.infer<typeof receiptExtractionSchema>;
