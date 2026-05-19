"use server";

import { createClient } from "@/lib/supabase/server";
import {
  HEARTH_DOCUMENTS_BUCKET,
  optimizedObjectPath,
  thumbnailObjectPath,
} from "@/lib/documents/paths";

export type CleanupDocumentInput = {
  documentId: string;
};

/**
 * Deletes a document row and its storage objects. Used by the Smart
 * Uploader for the retake / cancel paths.
 *
 * Storage removal is best-effort — if it fails (transient storage
 * error, partial state from a half-completed upload, etc.), the row
 * is still deleted and the orphaned bytes get picked up by a future
 * periodic sweep. The row going away is the authoritative signal that
 * the document is gone.
 */
export async function cleanupDocumentAction(
  input: CleanupDocumentInput,
): Promise<
  | { data: { ok: true }; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Read the row first to learn its house_id (for path construction)
  // and confirm the user has access — RLS scopes SELECT to houses they
  // own, so a missing row here means a bad id or someone else's.
  const { data: doc, error: loadError } = await supabase
    .from("documents")
    .select("id, house_id")
    .eq("id", input.documentId)
    .single();

  if (loadError || !doc) {
    return {
      data: null,
      error: loadError?.message ?? "Document not found",
    };
  }

  const pathsToRemove = [
    optimizedObjectPath({ houseId: doc.house_id, documentId: doc.id }),
    thumbnailObjectPath({ houseId: doc.house_id, documentId: doc.id }),
  ];

  // Best-effort storage cleanup. We don't .list() the directory because
  // we know exactly which two files were uploaded by Smart Uploader.
  try {
    await supabase.storage
      .from(HEARTH_DOCUMENTS_BUCKET)
      .remove(pathsToRemove);
  } catch {
    // Swallow — the row delete below is the authoritative cleanup.
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", input.documentId);

  if (deleteError) {
    return { data: null, error: deleteError.message };
  }

  return { data: { ok: true }, error: null };
}
