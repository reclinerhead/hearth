"use server";

import { createClient } from "@/lib/supabase/server";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";

export type DeleteDocumentPageInput = {
  documentId: string;
  pageNumber: number;
};

/**
 * Removes a single page-row from hearth.document_pages and its two
 * storage objects (page-{N}-optimized.jpg + page-{N}-thumb.jpg). Used
 * by the Smart Uploader's multi-page capture stage when the user
 * deletes a page mid-capture and recaptures it.
 *
 * Storage cleanup is best-effort; the row delete is the authoritative
 * signal that the page is gone.
 */
export async function deleteDocumentPageAction(
  input: DeleteDocumentPageInput,
): Promise<
  | { data: { ok: true }; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Load the row first so we know its storage paths (RLS scopes the
  // SELECT through the parent document's house ownership).
  const { data: page, error: loadError } = await supabase
    .from("document_pages")
    .select("id, storage_path, thumbnail_path")
    .eq("document_id", input.documentId)
    .eq("page_number", input.pageNumber)
    .single();

  if (loadError || !page) {
    return {
      data: null,
      error: loadError?.message ?? "Page not found",
    };
  }

  try {
    await supabase.storage
      .from(HEARTH_DOCUMENTS_BUCKET)
      .remove([page.storage_path, page.thumbnail_path]);
  } catch {
    // Best-effort — orphaned bytes are picked up by a future sweep.
  }

  const { error: deleteError } = await supabase
    .from("document_pages")
    .delete()
    .eq("id", page.id);

  if (deleteError) return { data: null, error: deleteError.message };
  return { data: { ok: true }, error: null };
}
