"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/types/document";

export type UpdateEmergencyVideoInput = {
  documentId: string;
  /**
   * New label, or null to clear. Required to be non-empty when the
   * row's category is 'other' — the check happens server-side after
   * loading the row.
   */
  label?: string | null;
  /** New notes, or null to clear. */
  notes?: string | null;
};

/**
 * Edits the label and/or notes on an emergency-procedure-video row.
 * Both fields are optional in the input — pass only the ones you
 * want to change. Returns the updated row.
 */
export async function updateEmergencyVideoAction(
  input: UpdateEmergencyVideoInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  if (input.label === undefined && input.notes === undefined) {
    return { data: null, error: "Nothing to update." };
  }

  const supabase = await createClient();

  const { data: current, error: loadError } = await supabase
    .from("documents")
    .select("id, kind, emergency_category")
    .eq("id", input.documentId)
    .single();

  if (loadError || !current) {
    return {
      data: null,
      error: loadError?.message ?? "Video not found.",
    };
  }
  if (current.kind !== "emergency_procedure_video") {
    return { data: null, error: "Not an emergency video." };
  }

  if (input.label !== undefined) {
    const trimmed = input.label?.trim() ?? null;
    if (current.emergency_category === "other" && !trimmed) {
      return {
        data: null,
        error: "Label is required for 'Other' category videos.",
      };
    }
  }

  const update: Record<string, string | null> = {};
  if (input.label !== undefined) {
    update.emergency_label = input.label?.trim() || null;
  }
  if (input.notes !== undefined) {
    update.notes = input.notes?.trim() || null;
  }

  const { data, error } = await supabase
    .from("documents")
    .update(update)
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? "Update failed." };
  }

  revalidatePath("/dashboard");

  return { data: data as DocumentRow, error: null };
}
