"use server";

import { createClient } from "@/lib/supabase/server";

export type FindMatchingInventoryInput = {
  houseId: string;
  inventoryName: string;
};

export type MatchingInventoryItem = {
  id: string;
  name: string;
  type: "appliance" | "system" | "exterior";
  room_id: string;
};

/**
 * Case-insensitive match on hearth.inventory.name within the house.
 * Returns zero or more items. The Smart Uploader's review stage uses
 * the result to decide between "create new" and "link to existing".
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
    .ilike("name", input.inventoryName);

  if (error) return { data: null, error: error.message };
  return { data: (data as MatchingInventoryItem[]) ?? [], error: null };
}
