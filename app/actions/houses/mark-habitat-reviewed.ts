"use server";

import { createClient } from "@/lib/supabase/server";
import type { OnboardingState } from "@/types/house";

/**
 * Fire-and-forget: stamp `onboarding_state.habitat_reviewed = true` on a
 * house the first time the user opens one of its habitat finding modals
 * (issue #216). This is the one onboarding milestone with no natural data
 * signal — *viewing* findings is not a write — so it lives in the
 * `onboarding_state` jsonb rather than being derived from a table.
 *
 * Called from the habitat finding trigger and intentionally NOT awaited by
 * the UI: the modal opens immediately and this settles in the background.
 * The milestone panel reads the persisted value on the next dashboard load.
 *
 * Idempotent — re-stamping true is a no-op, and we skip the write entirely
 * when the key is already set so a user who reopens findings repeatedly
 * doesn't churn the row. RLS on hearth.houses scopes both the read and the
 * write to the owner, so a `houseId` the caller doesn't own simply matches
 * no rows.
 */
export type MarkHabitatReviewedResult =
  | { ok: true }
  | { ok: false; error: string };

export async function markHabitatReviewedAction(
  houseId: string,
): Promise<MarkHabitatReviewedResult> {
  const supabase = await createClient();

  const { data: house, error: readError } = await supabase
    .from("houses")
    .select("onboarding_state")
    .eq("id", houseId)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: readError.message };
  }
  if (!house) {
    // Not owned (RLS) or gone — nothing to stamp.
    return { ok: false, error: "House not found." };
  }

  const current = (house.onboarding_state ?? {}) as OnboardingState;
  if (current.habitat_reviewed === true) {
    // Already reviewed — skip the write to avoid churning the row.
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("houses")
    .update({ onboarding_state: { ...current, habitat_reviewed: true } })
    .eq("id", houseId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}
