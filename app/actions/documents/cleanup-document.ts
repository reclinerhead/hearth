"use server";

import { createClient } from "@/lib/supabase/server";
import {
  HEARTH_DOCUMENTS_BUCKET,
  documentDirectoryPath,
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

  // Best-effort storage cleanup. List the document's directory and
  // remove everything inside — this handles single-page documents (two
  // files: optimized + thumb) and multi-page receipts (two per page,
  // page 1 plus N-1 children) without the caller needing to know how
  // many pages exist. The bucket's RLS scopes both list and remove to
  // houses the user owns, same as elsewhere.
  const directory = documentDirectoryPath({
    houseId: doc.house_id,
    documentId: doc.id,
  });
  try {
    const { data: files } = await supabase.storage
      .from(HEARTH_DOCUMENTS_BUCKET)
      .list(directory);
    if (files && files.length > 0) {
      await supabase.storage
        .from(HEARTH_DOCUMENTS_BUCKET)
        .remove(files.map((f) => `${directory}/${f.name}`));
    }
  } catch {
    // Swallow — the row delete below is the authoritative cleanup, and
    // the document_pages cascade catches the child rows too.
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
