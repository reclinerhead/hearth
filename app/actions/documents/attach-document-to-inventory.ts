"use server";

import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/types/document";

/**
 * Field names match hearth.inventory columns (model_number /
 * serial_number, not model / serial — the Smart Uploader builds this
 * map by letting the user check which AI deltas to accept).
 */
export type AcceptedInventoryFields = Partial<{
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_on: string | null;
  notes: string | null;
}>;

export type AttachDocumentToInventoryInput = {
  documentId: string;
  inventoryId: string;
  /**
   * Optional field merges into the inventory row. When undefined or
   * empty, the action just attaches without merging.
   */
  acceptedFields?: AcceptedInventoryFields;
};

/**
 * Attaches a document to an existing inventory row, optionally
 * merging accepted AI-extracted fields into the inventory record.
 *
 * RLS handles authorization on both the inventory UPDATE and the
 * document UPDATE — both delegate to hearth.houses.owner_id =
 * auth.uid(), so the caller can only touch rows in houses they own.
 */
export async function attachDocumentToInventoryAction(
  input: AttachDocumentToInventoryInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Merge accepted fields into the inventory row first, if any. We do
  // this before the document UPDATE so that on a merge failure the
  // document stays in its prior (unattached / analyzed) state — the
  // user can retry rather than ending up with an attached document
  // whose inventory row doesn't reflect their accepted edits.
  const accepted = input.acceptedFields ?? {};
  if (Object.keys(accepted).length > 0) {
    const { error: mergeError } = await supabase
      .from("inventory")
      .update(accepted)
      .eq("id", input.inventoryId);

    if (mergeError) {
      return { data: null, error: mergeError.message };
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({
      inventory_id: input.inventoryId,
      status: "attached",
    })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return {
      data: null,
      error: updateError?.message ?? "Failed to attach document",
    };
  }

  return { data: updated as DocumentRow, error: null };
}
