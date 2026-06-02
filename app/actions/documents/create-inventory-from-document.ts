"use server";

import { normalizeModelNumberForCreate } from "@/lib/inventory/model-number";
import { processDirectEventTaskFromDocument } from "@/lib/maintenance/direct-event";
import { createClient } from "@/lib/supabase/server";
import type {
  AiExtraction,
  DocumentRow,
  EquipmentType,
  InventorySubtype,
  NameplateExtractionPill,
} from "@/types/document";

export type CreateInventoryFromDocumentInput = {
  documentId: string;
  name: string;
  type: EquipmentType;
  // Only meaningful when type='property'. For other types the modal
  // sends null. Ignored at write time when subtype is not 'vehicle'
  // or 'pet'; future subtypes plug in via the InventorySubtype union.
  subtype: InventorySubtype | null;
  roomId: string;
  fields: {
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
    purchased_on: string | null;
    estimated_value_cents: number | null;
  };
  // Subtype-specific bag. Persisted verbatim into hearth.inventory.metadata.
  // The application layer validates via lib/inventory/metadata-schemas; an
  // empty object is fine and is what non-property items always write.
  metadata: Record<string, unknown>;
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
    .select("house_id, ai_extraction, metadata")
    .eq("id", input.documentId)
    .single();

  if (docError || !doc) {
    return {
      data: null,
      error: docError?.message ?? "Document not found",
    };
  }

  const aiPills = extractPills(doc.ai_extraction as AiExtraction | null);

  // subtype only persists for type='property' — defending the column
  // against accidental writes from a stale modal state where the user
  // toggled property → appliance after the subtype was already set.
  const persistedSubtype =
    input.type === "property" ? input.subtype : null;

  const { data: inv, error: invError } = await supabase
    .from("inventory")
    .insert({
      house_id: doc.house_id,
      name: input.name,
      type: input.type,
      subtype: persistedSubtype,
      room_id: input.roomId,
      manufacturer: input.fields.manufacturer,
      model_number: normalizeModelNumberForCreate(input.fields.model_number),
      serial_number: input.fields.serial_number,
      installed_on: input.fields.installed_on,
      purchased_on: input.fields.purchased_on,
      estimated_value_cents: input.fields.estimated_value_cents,
      metadata: input.metadata,
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

  // When the source document is a renewal document (a registration /
  // insurance card the user photographed to create this vehicle), the
  // nameplate extraction carried an expiration_date + issuing_authority.
  // Copy them into documents.metadata under the same keys the receipt
  // path uses (expiration_date / vendor_name) so the direct-event
  // pipeline below — which reads metadata, not ai_extraction — can seed
  // the renewal task. Merged over any existing metadata to stay
  // defensive against future writers. Issue #277.
  const renewal = extractRenewalMetadata(doc.ai_extraction as AiExtraction | null);
  const updatePayload: {
    inventory_id: string;
    status: "attached";
    metadata?: Record<string, unknown>;
  } = {
    inventory_id: inv.id,
    status: "attached",
  };
  if (renewal) {
    const existingMetadata =
      (doc.metadata as Record<string, unknown> | null) ?? {};
    updatePayload.metadata = {
      ...existingMetadata,
      expiration_date: renewal.expiration_date,
      vendor_name: renewal.vendor_name,
    };
  }

  const { data: updatedDoc, error: updateError } = await supabase
    .from("documents")
    .update(updatePayload)
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (updateError || !updatedDoc) {
    return {
      data: null,
      error: updateError?.message ?? "Document update failed",
    };
  }

  // Seed the renewal maintenance task now that the document is attached,
  // mirroring saveReceiptAction. Awaited so the inventory detail page
  // re-renders with the task already visible. The pipeline gates
  // internally on expiration_date / inventory_id / status, so a non-
  // renewal create (an appliance from its nameplate) exits cheaply
  // without a write. Issue #277.
  if (renewal) {
    await processDirectEventTaskFromDocument(input.documentId);
  }

  return {
    data: {
      inventoryId: inv.id,
      document: updatedDoc as DocumentRow,
    },
    error: null,
  };
}

// Pull the renewal handle (expiration date + issuing authority) out of a
// nameplate extraction, if present. Returns null for any non-nameplate
// extraction, and for nameplates that carry no expiration (ordinary
// equipment labels, a bare VIN plate) — those create an inventory item
// with no renewal task. The expiration_date shape is validated by the
// direct-event pipeline's own YYYY-MM-DD guard, so this helper only
// needs presence, not format-correctness. Issue #277.
function extractRenewalMetadata(
  extraction: AiExtraction | null,
): { expiration_date: string; vendor_name: string | null } | null {
  if (!extraction || extraction.mode !== "classification") return null;
  if (extraction.photo_kind !== "nameplate") return null;
  const expiration = extraction.extracted.expiration_date;
  if (typeof expiration !== "string" || expiration.length === 0) return null;
  return {
    expiration_date: expiration,
    vendor_name: extraction.extracted.issuing_authority,
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
