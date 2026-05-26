"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  DocumentRow,
  EmergencyCategory,
} from "@/types/document";

export type SaveEmergencyVideoInput = {
  /** Pre-allocated client-side UUID; becomes hearth.documents.id. */
  documentId: string;
  houseId: string;
  category: EmergencyCategory;
  /** User-supplied disambiguator. Required when category is 'other'. */
  label: string | null;
  /** Path inside hearth-emergency-videos to the compressed video. */
  storagePath: string;
  /** Path inside hearth-emergency-videos to the poster JPEG. */
  posterStoragePath: string;
  /** Container MIME from the compression pipeline. */
  mimeType: string;
  /** Compressed video size in bytes. */
  fileSizeBytes: number;
  /** Probed video duration in whole seconds. */
  durationSeconds: number;
  /** Original filename from the device (or a synthesized name for in-context recordings). */
  originalFilename: string;
  /** Notes the user entered on the review stage. */
  notes: string | null;
};

/**
 * Saves a finished emergency-procedure-video document. Unlike the
 * photo / receipt flows there is no AI extraction step — the storage
 * uploads have already completed client-side via uploadEmergencyVideoFiles,
 * and this action inserts the row directly with status='attached'.
 *
 * Primary-flag selection: queries existing rows in the same
 * (house, category) and sets emergency_is_primary=true iff none exist.
 * Mirrors shouldSaveAsPrimary in lib/documents/emergency-video-rules.ts.
 */
export async function saveEmergencyVideoAction(
  input: SaveEmergencyVideoInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  if (input.category === "other" && !input.label?.trim()) {
    return {
      data: null,
      error: "A label is required when the category is 'Other'.",
    };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  // Decide primary/secondary by counting existing rows in this category.
  // The pure rule lives in lib/documents/emergency-video-rules.ts; the
  // server action just translates a head count into the boolean it
  // sets on the new row.
  const { count, error: countError } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("house_id", input.houseId)
    .eq("kind", "emergency_procedure_video")
    .eq("emergency_category", input.category);

  if (countError) {
    return { data: null, error: countError.message };
  }
  const isPrimary = (count ?? 0) === 0;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: input.documentId,
      house_id: input.houseId,
      inventory_id: null,
      uploaded_by: user.id,
      kind: "emergency_procedure_video",
      status: "attached",
      storage_bucket: "hearth-emergency-videos",
      storage_path: input.storagePath,
      // No legacy thumbnail for video kinds — the poster carries the
      // preview job. The column is NOT NULL on the existing schema, so
      // we mirror the storage_path here as a placeholder. Future
      // schema cleanup could relax thumbnail_path; today we keep the
      // column compatible without a migration.
      thumbnail_path: input.posterStoragePath,
      poster_storage_path: input.posterStoragePath,
      content_hash: null,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      original_filename: input.originalFilename,
      duration_seconds: input.durationSeconds,
      emergency_category: input.category,
      emergency_label: input.label?.trim() || null,
      emergency_is_primary: isPrimary,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };

  // The dashboard panel reads this row server-side, so a revalidate
  // is what makes the new video show up after save without a full
  // navigation.
  revalidatePath("/dashboard");

  return { data: data as DocumentRow, error: null };
}
