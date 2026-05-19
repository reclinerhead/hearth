"use server";

import { createClient } from "@/lib/supabase/server";
import type { DocumentKind, DocumentRow } from "@/types/document";

export type CreatePendingDocumentInput = {
  /** Pre-allocated client-side UUID; becomes hearth.documents.id. */
  documentId: string;
  houseId: string;
  /** Phase 1 callers pass "nameplate" or "photo". */
  kind: DocumentKind;
  storagePath: string;
  thumbnailPath: string;
  contentHash: string;
  mimeType: string;
  fileSizeBytes: number;
  originalFilename: string;
  /**
   * When set, the document is created already attached to an inventory
   * item — used when the Smart Uploader opens from an inventory detail
   * page rather than the dashboard's general entry point.
   */
  inventoryId?: string | null;
};

/**
 * Inserts a hearth.documents row with status='analyzing'. The Smart
 * Uploader has already uploaded the storage objects by the time this
 * runs — this row references those paths but doesn't write them.
 *
 * RLS on hearth.documents (and on the auth session) does the ownership
 * enforcement; the explicit getUser() call sets `uploaded_by`.
 */
export async function createPendingDocumentAction(
  input: CreatePendingDocumentInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: input.documentId,
      house_id: input.houseId,
      inventory_id: input.inventoryId ?? null,
      uploaded_by: user.id,
      kind: input.kind,
      status: "analyzing",
      storage_path: input.storagePath,
      thumbnail_path: input.thumbnailPath,
      content_hash: input.contentHash,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      original_filename: input.originalFilename,
    })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as DocumentRow, error: null };
}
