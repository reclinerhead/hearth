"use server";

// Update server action for hearth.inventory rows. Backs the EDIT DETAILS
// modal on the inventory detail page (issue #57). RLS scopes both the
// read and the write through the user's houses, so the action does not
// re-check ownership itself.
//
// When the edit changes either of the two fields the "Research this
// model" panel grounds on (manufacturer, model_number) the stored
// ai_insights are invalidated in the same UPDATE — leaving a stale
// research summary tied to the old model number is worse than leaving
// the panel empty. `type` was previously invalidating too but is now
// treated as organizational only (issue #69). The client kicks off a
// fresh researchInventoryModel run when the action returns
// `researchInvalidated: true`. The "did key fields change?" decision
// lives in a pure helper (lib/inventory/research-significant-fields.ts)
// so it can be tested without a Supabase round-trip.
//
// Manufacture-date and hero_document_id were added by issue #105 as
// user-facing edits parallel to the existing decoded values and the
// implicit "most-recent attached photo" hero rule. Manufacture date
// is **not** a research-grounding field — research depends on
// manufacturer + model_number — and is intentionally left out of
// researchSignificantFieldsChanged.

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
    // YYYY-MM when set; null clears all six manufacture-date columns
    // in the same UPDATE. See "Manufacture date write contract" in
    // docs/TechnicalGuide.md for why we write the satellite columns
    // (precision, confidence, model, decoded_at, reasoning) alongside
    // the user-entered date.
    manufacture_date: string | null;
    // Nullable FK into hearth.documents. NULL means "fall back to the
    // most-recently attached photo" — the legacy rule. The DB FK has
    // ON DELETE SET NULL, so a deleted photo reverts this column to
    // null automatically.
    hero_document_id: string | null;
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
    .select("manufacturer, model_number, ai_insights")
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
      },
      {
        manufacturer: input.fields.manufacturer,
        model_number: input.fields.model_number,
      },
    );

  // Pull manufacture_date out of the spread — it's persisted across six
  // columns, not one, so the satellite columns need their own write
  // alongside the user-entered date.
  const { manufacture_date, ...restFields } = input.fields;
  const update: Record<string, unknown> = { ...restFields };

  if (manufacture_date === null) {
    // User cleared the field — null every related column in the same
    // UPDATE so the detail page's "Manufactured" tile fallback reverts
    // immediately. Otherwise stale satellite columns (e.g. "high"
    // confidence) would still keep the tile lit with no real value.
    update.manufacture_date = null;
    update.manufacture_date_precision = null;
    update.manufacture_date_confidence = null;
    update.manufacture_date_model = null;
    update.manufacture_date_decoded_at = null;
    update.manufacture_date_reasoning = null;
  } else {
    update.manufacture_date = manufacture_date;
    update.manufacture_date_precision = "month";
    update.manufacture_date_confidence = "high";
    update.manufacture_date_model = "user-entered";
    update.manufacture_date_decoded_at = new Date().toISOString();
    update.manufacture_date_reasoning = null;
  }

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
