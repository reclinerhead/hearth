import { describe, expect, it } from "vitest";
import {
  matchInventoryByReceipt,
  type ReceiptMatchableInventory,
} from "./receipt-inventory-match";

function row(
  partial: Partial<ReceiptMatchableInventory> & { id: string },
): ReceiptMatchableInventory {
  return {
    name: "Item",
    type: "appliance",
    subtype: null,
    manufacturer: null,
    model_number: null,
    serial_number: null,
    room_id: "room-1",
    ...partial,
  };
}

describe("matchInventoryByReceipt", () => {
  it("returns empty when the receipt referenced nothing", () => {
    const result = matchInventoryByReceipt({
      inventory: [row({ id: "a", serial_number: "ABC123" })],
      referencedSerials: [],
      referencedModelNumbers: [],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toEqual([]);
  });

  it("returns empty when no inventory rows match", () => {
    const result = matchInventoryByReceipt({
      inventory: [row({ id: "a", serial_number: "XYZ" })],
      referencedSerials: ["ABC123"],
      referencedModelNumbers: [],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toEqual([]);
  });

  it("makes an exact case-folded serial match a strong match", () => {
    const target = row({
      id: "furnace",
      name: "Furnace",
      serial_number: "P9384HG2J19",
    });
    const result = matchInventoryByReceipt({
      inventory: [target, row({ id: "other" })],
      referencedSerials: ["p9384hg2j19"],
      referencedModelNumbers: [],
    });
    expect(result.strong_match?.id).toBe("furnace");
    expect(result.suggested_matches).toEqual([]);
  });

  it("matches a punctuation-stripped VIN", () => {
    const target = row({
      id: "car",
      name: "Land Cruiser",
      type: "property",
      subtype: "vehicle",
      serial_number: "1HGBH41JXMN109186",
    });
    const result = matchInventoryByReceipt({
      inventory: [target],
      // Receipt prints VIN with hyphens, nameplate captured without.
      referencedSerials: ["1HGBH41J-XMN-109186"],
      referencedModelNumbers: [],
    });
    expect(result.strong_match?.id).toBe("car");
  });

  it("demotes multiple serial hits to suggestions", () => {
    const a = row({ id: "a", serial_number: "ABC" });
    const b = row({ id: "b", serial_number: "ABC" });
    const result = matchInventoryByReceipt({
      inventory: [a, b],
      referencedSerials: ["abc"],
      referencedModelNumbers: [],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toHaveLength(2);
  });

  it("surfaces model-only matches as suggestions, not strong", () => {
    const target = row({
      id: "washer",
      name: "Washing Machine",
      model_number: "WTW5000DW",
    });
    const result = matchInventoryByReceipt({
      inventory: [target],
      referencedSerials: [],
      referencedModelNumbers: ["WTW5000DW"],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toEqual([target]);
  });

  it("does not collide on the 'unknown' model_number sentinel", () => {
    const sentinelRow = row({
      id: "x",
      name: "Custom-built thing",
      model_number: "unknown",
    });
    const result = matchInventoryByReceipt({
      inventory: [sentinelRow],
      referencedSerials: [],
      referencedModelNumbers: ["unknown"],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toEqual([]);
  });

  it("does not double-suggest a row that already hit on serial", () => {
    const target = row({
      id: "a",
      serial_number: "ABC",
      model_number: "MOD-123",
    });
    const result = matchInventoryByReceipt({
      inventory: [target],
      referencedSerials: ["abc"],
      referencedModelNumbers: ["MOD-123"],
    });
    expect(result.strong_match?.id).toBe("a");
    expect(result.suggested_matches).toEqual([]);
  });

  it("ignores rows with null serial and null model", () => {
    const naked = row({ id: "a" });
    const result = matchInventoryByReceipt({
      inventory: [naked],
      referencedSerials: ["ABC"],
      referencedModelNumbers: ["XYZ"],
    });
    expect(result.strong_match).toBeNull();
    expect(result.suggested_matches).toEqual([]);
  });

  it("strong serial match wins over a model-number suggestion on a different row", () => {
    const carBySerial = row({
      id: "car",
      serial_number: "1HGBH41JXMN109186",
      type: "property",
      subtype: "vehicle",
    });
    const carByModelOnly = row({
      id: "spare-engine",
      model_number: "ENG-5000",
    });
    const result = matchInventoryByReceipt({
      inventory: [carBySerial, carByModelOnly],
      referencedSerials: ["1HGBH41J-XMN-109186"],
      referencedModelNumbers: ["ENG-5000"],
    });
    expect(result.strong_match?.id).toBe("car");
    expect(result.suggested_matches).toEqual([carByModelOnly]);
  });
});
