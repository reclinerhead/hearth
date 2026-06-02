"use server";

// Delete server action for hearth.inventory rows. Backs the DELETE
// button inside the EDIT DETAILS modal (issue #57). RLS scopes the
// reads and writes through the user's houses, so the action doesn't
// re-check ownership itself.
//
// Two delete modes, chosen by the user in the confirmation modal:
//
//   cascadeDocuments: true  (default in the UI)
//     Deletes all hearth.documents rows attached to the item AND their
//     storage objects (best-effort, same pattern as cleanupDocumentAction).
//     The user wanted the appliance and its receipts/manuals/photos
//     gone in one motion.
//
//   cascadeDocuments: false
//     Deletes only the inventory row. The FK constraint on
//     hearth.documents.inventory_id is ON DELETE SET NULL, so linked
//     documents survive as unattached items in the user's house —
//     useful for keeping a receipt for tax records after replacing
//     the appliance it was tied to.
//
// Ordering: documents are deleted before the inventory row in the
// cascade path. The inventory delete is the authoritative end-state
// signal (the row going away is what redirects the UI), so we don't
// want the inventory delete to succeed and leave docs behind on a
// transient docs-delete failure. Storage cleanup is best-effort and
// runs between the doc-row delete and the inventory-row delete; a
// failed storage call leaves orphaned bytes for a future periodic
// sweep, matching the trade-off in cleanupDocumentAction.

import { revalidatePath } from "next/cache";
import {
  documentDirectoryPath,
  HEARTH_DOCUMENTS_BUCKET,
} from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/server";

export type DeleteInventoryItemInput = {
  inventoryId: string;
  cascadeDocuments: boolean;
};

export type DeleteInventoryItemSuccess = {
  deletedDocumentCount: number;
};

export async function deleteInventoryItemAction(
  input: DeleteInventoryItemInput,
): Promise<
  | { data: DeleteInventoryItemSuccess; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Load the inventory row first so we know the house_id (needed for
  // storage path construction) and so a bad id surfaces a clear error
  // before we touch any documents. RLS scopes the SELECT to houses the
  // user owns, so a missing row here means a bad id or someone else's.
  const { data: inv, error: loadError } = await supabase
    .from("inventory")
    .select("id, house_id")
    .eq("id", input.inventoryId)
    .single();

  if (loadError || !inv) {
    return {
      data: null,
      error: loadError?.message ?? "Item not found",
    };
  }

  let deletedDocumentCount = 0;

  if (input.cascadeDocuments) {
    const { data: docs, error: docsLoadError } = await supabase
      .from("documents")
      .select("id")
      .eq("inventory_id", input.inventoryId);

    if (docsLoadError) {
      return { data: null, error: docsLoadError.message };
    }

    const docIds = (docs ?? []).map((d) => d.id);
    deletedDocumentCount = docIds.length;

    if (docIds.length > 0) {
      // Delete the rows first (authoritative). Storage cleanup runs
      // best-effort against the same id set after the rows are gone.
      const { error: docsDeleteError } = await supabase
        .from("documents")
        .delete()
        .in("id", docIds);

      if (docsDeleteError) {
        return { data: null, error: docsDeleteError.message };
      }

      // Sweep each document's directory rather than enumerating known
      // filenames. A multi-page receipt has page-2+ images
      // (page-{N}-optimized.jpg / page-{N}-thumb.jpg) alongside the
      // page-1 optimized.jpg / thumb.jpg; listing the directory removes
      // every object regardless of page count, where the old
      // optimized+thumb enumeration left page-2+ bytes orphaned. Same
      // directory-sweep pattern as cleanupDocumentAction.
      try {
        await Promise.all(
          docIds.map(async (docId) => {
            const directory = documentDirectoryPath({
              houseId: inv.house_id,
              documentId: docId,
            });
            const { data: files } = await supabase.storage
              .from(HEARTH_DOCUMENTS_BUCKET)
              .list(directory);
            if (files && files.length > 0) {
              await supabase.storage
                .from(HEARTH_DOCUMENTS_BUCKET)
                .remove(files.map((f) => `${directory}/${f.name}`));
            }
          }),
        );
      } catch {
        // Best-effort — orphaned bytes get picked up by a future
        // periodic sweep. Don't fail the delete on a storage hiccup.
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("inventory")
    .delete()
    .eq("id", input.inventoryId);

  if (deleteError) {
    return { data: null, error: deleteError.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/inventory/${input.inventoryId}`);

  return {
    data: { deletedDocumentCount },
    error: null,
  };
}
