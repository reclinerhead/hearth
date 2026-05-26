"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, EmergencyCategory } from "@/types/document";

export type PromoteEmergencyVideoInput = {
  /** The row to promote to primary. Must be a secondary in its category. */
  documentId: string;
};

/**
 * Promotes a secondary emergency-procedure-video to primary, demoting
 * whatever row was the previous primary in the same (house, category).
 *
 * Implemented as two sequential UPDATEs rather than a Postgres function
 * — small enough that the extra round-trip is fine and easier to read.
 * RLS makes both writes safe across houses.
 */
export async function promoteEmergencyVideoAction(
  input: PromoteEmergencyVideoInput,
): Promise<
  | { data: { promoted: DocumentRow }; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Load the target row first so we can derive (house_id, category)
  // and verify it is in fact an emergency video. RLS scopes the
  // SELECT to houses the user owns.
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
  if (!target.emergency_category) {
    return { data: null, error: "Video is missing a category." };
  }
  if (target.emergency_is_primary) {
    // Already primary — return as a no-op success so callers don't
    // need to special-case the re-tap-on-primary path.
    return { data: { promoted: target as DocumentRow }, error: null };
  }

  const category = target.emergency_category as EmergencyCategory;

  // Demote the current primary in this category. There should be at
  // most one row matching the predicate; if there's none (the prior
  // primary was deleted out from under us between page-load and
  // promote), the UPDATE is a no-op and we still promote target.
  const { error: demoteError } = await supabase
    .from("documents")
    .update({ emergency_is_primary: false })
    .eq("house_id", target.house_id)
    .eq("kind", "emergency_procedure_video")
    .eq("emergency_category", category)
    .eq("emergency_is_primary", true);

  if (demoteError) {
    return { data: null, error: demoteError.message };
  }

  const { data: promoted, error: promoteError } = await supabase
    .from("documents")
    .update({ emergency_is_primary: true })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (promoteError || !promoted) {
    return {
      data: null,
      error: promoteError?.message ?? "Promote failed.",
    };
  }

  revalidatePath("/dashboard");

  return { data: { promoted: promoted as DocumentRow }, error: null };
}
