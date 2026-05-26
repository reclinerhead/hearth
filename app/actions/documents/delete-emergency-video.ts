"use server";

import { revalidatePath } from "next/cache";
import { pickPromotedSecondaryId } from "@/lib/documents/emergency-video-rules";
import { HEARTH_EMERGENCY_VIDEOS_BUCKET } from "@/lib/documents/paths";
import { documentDirectoryPath } from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/server";

export type DeleteEmergencyVideoInput = {
  documentId: string;
};

/**
 * Deletes an emergency-procedure-video row and its storage objects.
 *
 * Auto-promote: when the deleted row was the primary in its category
 * and at least one secondary remains, promote the most recently
 * created secondary to primary. The promote rule lives in
 * pickPromotedSecondaryId — pure, unit-covered.
 *
 * Same best-effort-storage / authoritative-row pattern as
 * cleanupDocumentAction. A failed remove() leaves bytes for a future
 * sweep job; the row going away is what matters to the UI.
 */
export async function deleteEmergencyVideoAction(
  input: DeleteEmergencyVideoInput,
): Promise<
  | { data: { ok: true }; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data: target, error: loadError } = await supabase
    .from("documents")
    .select(
      "id, house_id, kind, emergency_category, emergency_is_primary",
    )
    .eq("id", input.documentId)
    .single();

  if (loadError || !target) {
    return {
      data: null,
      error: loadError?.message ?? "Video not found.",
    };
  }
  if (target.kind !== "emergency_procedure_video") {
    return { data: null, error: "Not an emergency video." };
  }

  // Best-effort storage cleanup before deleting the row. Same
  // list-then-remove pattern as cleanupDocumentAction so the helper
  // handles whatever container (webm / mp4) plus the poster JPEG
  // without needing to predict the file names.
  const directory = documentDirectoryPath({
    houseId: target.house_id,
    documentId: target.id,
  });
  try {
    const { data: files } = await supabase.storage
      .from(HEARTH_EMERGENCY_VIDEOS_BUCKET)
      .list(directory);
    if (files && files.length > 0) {
      await supabase.storage
        .from(HEARTH_EMERGENCY_VIDEOS_BUCKET)
        .remove(files.map((f) => `${directory}/${f.name}`));
    }
  } catch {
    // Swallow — row delete is authoritative; orphaned bytes get a
    // future periodic sweep.
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", input.documentId);

  if (deleteError) {
    return { data: null, error: deleteError.message };
  }

  // Auto-promote path: only fires when the deleted row was primary
  // AND a sibling secondary still exists in the same category.
  if (target.emergency_is_primary && target.emergency_category) {
    const { data: survivors, error: survivorsError } = await supabase
      .from("documents")
      .select("id, emergency_is_primary, created_at")
      .eq("house_id", target.house_id)
      .eq("kind", "emergency_procedure_video")
      .eq("emergency_category", target.emergency_category);

    if (!survivorsError && survivors && survivors.length > 0) {
      const winnerId = pickPromotedSecondaryId(
        survivors.map((s) => ({
          id: s.id,
          emergency_is_primary: Boolean(s.emergency_is_primary),
          created_at: String(s.created_at),
        })),
      );
      if (winnerId) {
        await supabase
          .from("documents")
          .update({ emergency_is_primary: true })
          .eq("id", winnerId);
      }
    }
  }

  revalidatePath("/dashboard");

  return { data: { ok: true }, error: null };
}
