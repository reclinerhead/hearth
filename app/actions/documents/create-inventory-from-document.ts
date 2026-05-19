"use server";

import { createClient } from "@/lib/supabase/server";
import type {
  AiExtraction,
  DocumentRow,
  NameplateExtractionPill,
} from "@/types/document";

export type CreateInventoryFromDocumentInput = {
  documentId: string;
  name: string;
  type: "appliance" | "system" | "exterior";
  roomId: string;
  fields: {
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
  };
  notes: string | null;
};

export type CreateInventoryFromDocumentResult = {
  inventoryId: string;
  document: DocumentRow;
};

/**
 * Inserts a new hearth.inventory row using the user-confirmed values
 * from the Smart Uploader review stage, then attaches the document to
 * it and flips status='attached'.
 *
 * Two sequential queries rather than a single Postgres function: keeps
 * the code simple. If a real failure mode emerges (e.g. the inventory
 * insert succeeds but the document update fails), escalate to an RPC.
 */
export async function createInventoryFromDocumentAction(
  input: CreateInventoryFromDocumentInput,
): Promise<
  | { data: CreateInventoryFromDocumentResult; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Look up the document so we know which house this belongs to and
  // can copy any nameplate-extracted pills into the new inventory row.
  // RLS ensures the caller can only load documents in their own houses.
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("house_id, ai_extraction")
    .eq("id", input.documentId)
    .single();

  if (docError || !doc) {
    return {
      data: null,
      error: docError?.message ?? "Document not found",
    };
  }

  const aiPills = extractPills(doc.ai_extraction as AiExtraction | null);

  const { data: inv, error: invError } = await supabase
    .from("inventory")
    .insert({
      house_id: doc.house_id,
      name: input.name,
      type: input.type,
      room_id: input.roomId,
      manufacturer: input.fields.manufacturer,
      model_number: input.fields.model_number,
      serial_number: input.fields.serial_number,
      installed_on: input.fields.installed_on,
      notes: input.notes,
      ai_pills: aiPills,
    })
    .select("id")
    .single();

  if (invError || !inv) {
    return {
      data: null,
      error: invError?.message ?? "Inventory insert failed",
    };
  }

  const { data: updatedDoc, error: updateError } = await supabase
    .from("documents")
    .update({
      inventory_id: inv.id,
      status: "attached",
    })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (updateError || !updatedDoc) {
    return {
      data: null,
      error: updateError?.message ?? "Document update failed",
    };
  }

  return {
    data: {
      inventoryId: inv.id,
      document: updatedDoc as DocumentRow,
    },
    error: null,
  };
}

// Pull the pills array out of a document's ai_extraction blob if and only
// if the extraction is a successful nameplate classification. Appliance
// photos and not_useful classifications have no pills to copy; delta-mode
// extractions don't apply here because this action is the create-new path.
function extractPills(
  extraction: AiExtraction | null,
): NameplateExtractionPill[] | null {
  if (!extraction || extraction.mode !== "classification") return null;
  if (extraction.photo_kind !== "nameplate") return null;
  return extraction.extracted.pills;
}
