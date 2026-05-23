// Per-kind Zod schemas for hearth.documents.metadata. The database
// column is open-shape jsonb; this module is the application contract
// that keeps writes well-formed and reads safely typed.
//
// Mirrors lib/inventory/metadata-schemas.ts in spirit: each schema
// returns its parsed shape, the parsers fall back to {} on invalid
// input so a future schema change can't crash an existing renderer.

import { z } from "zod";

// Cents-based money fields (bigint-safe — same reasoning as
// hearth.inventory.estimated_value_cents). A high-end vehicle service
// invoice or a piece of art easily exceeds 2_147_483_647 (~$21.4M)
// once you treat cents as integers; bigint avoids quiet overflow.
const centsSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional();

const receiptLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  // Quantity is a number — most receipts are integers but some print
  // fractional quantities ("1.5 hrs labor"), so we allow floats.
  quantity: z.number().nullable().optional(),
  unit_price_cents: centsSchema,
  total_cents: centsSchema,
});

export const receiptMetadataSchema = z.object({
  vendor_name: z.string().nullable(),
  vendor_address: z.string().nullable(),
  vendor_phone: z.string().nullable(),

  // ISO date when the transaction happened. We tolerate a string here
  // rather than z.date() because the model returns strings and we don't
  // want a malformed date to invalidate the whole extraction — the
  // detail-page renderer skips a malformed value rather than crashing.
  transaction_date: z.string().nullable(),

  // ISO date string. Populated when the document represents a
  // time-bounded grant whose expiration matters for renewal purposes
  // — vehicle registration, insurance policy, warranty, permit,
  // license. The model is instructed to populate this only when the
  // document explicitly states an expiration / valid-through /
  // policy-period-end date, and to leave it null on service receipts,
  // purchase receipts, and inspection reports where "expiration" is
  // not a meaningful concept.
  //
  // Distinct from transaction_date: a registration card has a
  // transaction_date of "when I paid the SOS" and an expiration_date
  // of "when this registration lapses." Insurance policies often
  // print both an effective date and an expiration date; we capture
  // the expiration here and the effective date lands in
  // transaction_date. Consumed by the direct-event maintenance
  // pipeline (issue #4) to seed renewal tasks.
  expiration_date: z.string().nullable(),

  // High-level transaction category, used for the future "service vs
  // purchase" filtering in the inventory documents list. The model is
  // instructed to pick from this set; unrecognized values fall back
  // through the parser as "other".
  transaction_type: z
    .enum(["service", "purchase", "inspection", "other"])
    .nullable(),

  subtotal_cents: centsSchema,
  tax_cents: centsSchema,
  total_cents: centsSchema,

  // ISO 4217 three-letter code. Almost always "USD" today; defensible
  // to leave nullable so a future international expansion doesn't need
  // a schema change.
  currency: z.string().nullable(),

  payment_method: z.string().nullable(),

  line_items: z.array(receiptLineItemSchema),

  // Serials and model numbers found anywhere on the receipt. These are
  // what the inventory matcher reads — completeness matters more than
  // order. Empty arrays are normal for receipts that reference no
  // identifiers (a vet visit, a plumber service call).
  referenced_serials: z.array(z.string()),
  referenced_model_numbers: z.array(z.string()),

  notes: z.string().nullable(),
});

export type ReceiptMetadata = z.infer<typeof receiptMetadataSchema>;

/**
 * Safe parser for hearth.documents.metadata on a receipt row. Returns
 * the parsed object on success, or an empty-but-shape-complete object
 * on failure — same fall-through pattern as the inventory metadata
 * parsers. Renderers can rely on the array fields existing as arrays
 * and the optional fields being null rather than undefined.
 */
export function parseReceiptMetadata(value: unknown): ReceiptMetadata {
  const parsed = receiptMetadataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return emptyReceiptMetadata();
}

export function emptyReceiptMetadata(): ReceiptMetadata {
  return {
    vendor_name: null,
    vendor_address: null,
    vendor_phone: null,
    transaction_date: null,
    expiration_date: null,
    transaction_type: null,
    subtotal_cents: null,
    tax_cents: null,
    total_cents: null,
    currency: null,
    payment_method: null,
    line_items: [],
    referenced_serials: [],
    referenced_model_numbers: [],
    notes: null,
  };
}
