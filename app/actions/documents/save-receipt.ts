"use server";

import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/types/document";

export type SaveReceiptInput = {
  documentId: string;
  inventoryId: string;
  /**
   * Optional user-edited notes from the review stage. When provided,
   * persists into hearth.documents.notes alongside the structured
   * metadata write. The model-extracted notes already live in
   * metadata.notes and ai_extraction.notes; this field is the user's
   * own additional commentary.
   */
  userNotes?: string | null;
};

/**
 * Final save step for a receipt. Attaches the document to the chosen
 * inventory item and flips status from 'analyzed' to 'attached'.
 *
 * Notes-only since extraction has already written ai_extraction and
 * metadata earlier in analyzeReceiptAction — this action does not
 * rewrite either of those columns. Receipt extraction is the model's
 * job; line-item editing in the review stage is out of scope for v1
 * (issue #117).
 *
 * RLS does the authorization on both tables — the caller can only
 * touch rows in houses they own.
 */
export async function saveReceiptAction(
  input: SaveReceiptInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const updatePayload: {
    inventory_id: string;
    status: "attached";
    notes?: string | null;
  } = {
    inventory_id: input.inventoryId,
    status: "attached",
  };
  if (input.userNotes !== undefined) {
    updatePayload.notes = input.userNotes;
  }

  const { data, error } = await supabase
    .from("documents")
    .update(updatePayload)
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (error || !data) {
    return {
      data: null,
      error: error?.message ?? "Failed to save receipt",
    };
  }

  return { data: data as DocumentRow, error: null };
}
