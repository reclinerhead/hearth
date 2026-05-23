"use server";

import { createClient } from "@/lib/supabase/server";
import {
  matchInventoryByReceipt,
  type ReceiptMatchableInventory,
  type ReceiptMatchResult,
} from "@/lib/documents/receipt-inventory-match";

export type FindInventoryByReceiptInput = {
  houseId: string;
  referencedSerials: string[];
  referencedModelNumbers: string[];
};

// Re-export the result shape under the action's old name so callers
// that imported it from this module keep compiling. The matcher's
// pure-logic types are the canonical source.
export type ReceiptInventoryCandidate = ReceiptMatchableInventory;
export type FindInventoryByReceiptResult = ReceiptMatchResult;

/**
 * Server-action wrapper around the pure matcher in
 * lib/documents/receipt-inventory-match.ts. Reads the house's inventory
 * rows under RLS and hands them to the matcher; ownership enforcement
 * is the load-bearing job of hearth.inventory's policies.
 */
export async function findInventoryByReceiptAction(
  input: FindInventoryByReceiptInput,
): Promise<
  | { data: FindInventoryByReceiptResult; error: null }
  | { data: null; error: string }
> {
  const empty: FindInventoryByReceiptResult = {
    strong_match: null,
    suggested_matches: [],
  };

  if (
    input.referencedSerials.length === 0 &&
    input.referencedModelNumbers.length === 0
  ) {
    return { data: empty, error: null };
  }

  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("inventory")
    .select(
      "id, name, type, subtype, manufacturer, model_number, serial_number, room_id",
    )
    .eq("house_id", input.houseId);

  if (error) return { data: null, error: error.message };
  const inventory = (rows ?? []) as ReceiptMatchableInventory[];
  if (inventory.length === 0) return { data: empty, error: null };

  const result = matchInventoryByReceipt({
    inventory,
    referencedSerials: input.referencedSerials,
    referencedModelNumbers: input.referencedModelNumbers,
  });

  return { data: result, error: null };
}
