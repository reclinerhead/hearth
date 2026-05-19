"use server";

// Update server action for hearth.inventory rows. Backs the EDIT DETAILS
// modal on the inventory detail page (issue #57). RLS scopes both the
// read and the write through the user's houses, so the action does not
// re-check ownership itself.
//
// When the edit changes any of the three fields the "Research this
// model" panel grounds on (manufacturer, model_number, type) the stored
// ai_insights are invalidated in the same UPDATE — leaving a stale
// research summary tied to the old model number is worse than leaving
// the panel empty. The client kicks off a fresh researchInventoryModel
// run when the action returns `researchInvalidated: true`. The "did key
// fields change?" decision lives in a pure helper
// (lib/inventory/research-significant-fields.ts) so it can be tested
// without a Supabase round-trip.

import { revalidatePath } from "next/cache";
import { researchSignificantFieldsChanged } from "@/lib/inventory/research-significant-fields";
import { createClient } from "@/lib/supabase/server";
import type { EquipmentType } from "@/types/document";

export type UpdateInventoryItemInput = {
  inventoryId: string;
  fields: {
    name: string;
    type: EquipmentType;
    room_id: string;
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
    last_serviced_on: string | null;
    next_service_due_on: string | null;
    notes: string | null;
  };
};

export type UpdateInventoryItemSuccess = {
  researchInvalidated: boolean;
};

export async function updateInventoryItemAction(
  input: UpdateInventoryItemInput,
): Promise<
  | { data: UpdateInventoryItemSuccess; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("inventory")
    .select("manufacturer, model_number, type, ai_insights")
    .eq("id", input.inventoryId)
    .single();

  if (loadError || !existing) {
    return {
      data: null,
      error: loadError?.message ?? "Item not found",
    };
  }

  const researchInvalidated =
    existing.ai_insights !== null &&
    researchSignificantFieldsChanged(
      {
        manufacturer: existing.manufacturer,
        model_number: existing.model_number,
        type: existing.type as EquipmentType,
      },
      {
        manufacturer: input.fields.manufacturer,
        model_number: input.fields.model_number,
        type: input.fields.type,
      },
    );

  const update: Record<string, unknown> = { ...input.fields };
  if (researchInvalidated) {
    // Clear the stale insights in the same UPDATE so the panel doesn't
    // briefly show outdated content between save and the client-side
    // re-research trigger. The client always re-renders the server
    // component (via router.refresh) after this action returns.
    update.ai_insights = null;
  }

  const { error: updateError } = await supabase
    .from("inventory")
    .update(update)
    .eq("id", input.inventoryId);

  if (updateError) {
    return { data: null, error: updateError.message };
  }

  revalidatePath(`/inventory/${input.inventoryId}`);
  revalidatePath("/dashboard");

  return {
    data: { researchInvalidated },
    error: null,
  };
}
