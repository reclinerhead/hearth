"use server";

import { inventoryNameMatches } from "@/lib/inventory/match-name";
import { createClient } from "@/lib/supabase/server";

export type FindMatchingInventoryInput = {
  houseId: string;
  inventoryName: string;
  inventoryType: "appliance" | "system" | "exterior";
};

export type MatchingInventoryItem = {
  id: string;
  name: string;
  type: "appliance" | "system" | "exterior";
  room_id: string;
};

/**
 * Surface inventory rows in the house that look like the same physical
 * item as the proposed classification, so the Smart Uploader's review
 * stage can offer "add this photo to existing X" instead of forcing
 * a duplicate row.
 *
 * Strategy: filter by `type` in Postgres (cheap, indexed-ish, cuts the
 * candidate set to one equipment category), then run the normalized
 * name matcher in-process. N per house is small enough that fighting
 * Postgres for fuzzy matching isn't worth the complexity — see
 * lib/inventory/match-name.ts for the alias rules and the rationale.
 *
 * The `type` filter is load-bearing: a "Microwave" appliance row must
 * never collide with a (theoretical) "Microwave" system row even when
 * the names normalize identically.
 *
 * RLS scopes the SELECT to houses the caller owns; the explicit
 * house_id filter is the access pattern, not the access check.
 */
export async function findMatchingInventoryAction(
  input: FindMatchingInventoryInput,
): Promise<
  | { data: MatchingInventoryItem[]; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inventory")
    .select("id, name, type, room_id")
    .eq("house_id", input.houseId)
    .eq("type", input.inventoryType);

  if (error) return { data: null, error: error.message };

  const rows = (data as MatchingInventoryItem[]) ?? [];
  const matches = rows.filter((row) =>
    inventoryNameMatches(row.name, input.inventoryName),
  );
  return { data: matches, error: null };
}
