import { describe, expect, it } from "vitest";
import {
  emptyReceiptMetadata,
  parseReceiptMetadata,
  receiptMetadataSchema,
} from "./metadata-schemas";

describe("receiptMetadataSchema", () => {
  it("accepts a fully-populated receipt", () => {
    const value = {
      vendor_name: "Riverbend Heating & Cooling",
      vendor_address: "1234 Main St, Kalamazoo, MI 49001",
      vendor_phone: "269-555-0123",
      transaction_date: "2024-11-15",
      transaction_type: "service",
      subtotal_cents: 28000,
      tax_cents: 1960,
      total_cents: 29960,
      currency: "USD",
      payment_method: "Visa ending in 4242",
      line_items: [
        {
          description: "Furnace tune-up, full inspection",
          quantity: 1,
          unit_price_cents: 18000,
          total_cents: 18000,
        },
      ],
      referenced_serials: ["P9384HG2J19"],
      referenced_model_numbers: ["59SC5A100S21"],
      notes: "Annual maintenance",
    };
    const result = receiptMetadataSchema.safeParse(value);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal-fields receipt with empty arrays", () => {
    const value = {
      vendor_name: null,
      vendor_address: null,
      vendor_phone: null,
      transaction_date: null,
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
    const result = receiptMetadataSchema.safeParse(value);
    expect(result.success).toBe(true);
  });

  it("rejects non-integer cents", () => {
    const value = {
      ...emptyReceiptMetadata(),
      total_cents: 29.96 as unknown as number,
    };
    const result = receiptMetadataSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown transaction_type", () => {
    const value = {
      ...emptyReceiptMetadata(),
      transaction_type: "freebie" as unknown as null,
    };
    const result = receiptMetadataSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it("rejects a line_item with a blank description", () => {
    const value = {
      ...emptyReceiptMetadata(),
      line_items: [
        {
          description: "",
          quantity: 1,
          unit_price_cents: 100,
          total_cents: 100,
        },
      ],
    };
    const result = receiptMetadataSchema.safeParse(value);
    expect(result.success).toBe(false);
  });
});

describe("parseReceiptMetadata", () => {
  it("returns the parsed shape on valid input", () => {
    const parsed = parseReceiptMetadata({
      ...emptyReceiptMetadata(),
      vendor_name: "Vendor",
      total_cents: 100,
      line_items: [
        {
          description: "Item",
          quantity: null,
          unit_price_cents: null,
          total_cents: null,
        },
      ],
    });
    expect(parsed.vendor_name).toBe("Vendor");
    expect(parsed.total_cents).toBe(100);
    expect(parsed.line_items).toHaveLength(1);
  });

  it("returns an empty-but-complete shape on invalid input", () => {
    const parsed = parseReceiptMetadata({ garbage: true });
    expect(parsed.vendor_name).toBeNull();
    expect(parsed.line_items).toEqual([]);
    expect(parsed.referenced_serials).toEqual([]);
    expect(parsed.referenced_model_numbers).toEqual([]);
  });

  it("returns an empty shape for null/undefined inputs (defensive)", () => {
    expect(parseReceiptMetadata(null).line_items).toEqual([]);
    expect(parseReceiptMetadata(undefined).line_items).toEqual([]);
  });

  it("emptyReceiptMetadata round-trips through the schema", () => {
    const empty = emptyReceiptMetadata();
    const result = receiptMetadataSchema.safeParse(empty);
    expect(result.success).toBe(true);
  });
});
