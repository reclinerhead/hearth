"use server";

import { createClient } from "@/lib/supabase/server";
import type { OnboardingState } from "@/types/house";

/**
 * Fire-and-forget: stamp `onboarding_state.foundation_celebration_seen = true`
 * on a house the first time the foundation-complete celebration auto-shows
 * (issue #269).
 *
 * The celebration ("THE FOUNDATION IS SET / Hearth knows your home now.") is a
 * one-time reward beat. It used to be gated by a per-tab `sessionStorage` flag,
 * which re-revealed it every new session; this durable stamp replaces that so
 * the beat auto-shows exactly once, ever. The dashboard `?` trigger remains the
 * deliberate, user-initiated way back into the panel (`reopen` mode) afterward.
 *
 * Called from the milestones panel on the final-flip load and intentionally NOT
 * awaited by the UI: the celebration renders immediately and this settles in
 * the background. The next dashboard load reads the persisted value and the
 * beat stays hidden.
 *
 * Idempotent — re-stamping true is a no-op, and we skip the write entirely when
 * the key is already set so we don't churn the row. RLS on hearth.houses scopes
 * both the read and the write to the owner, so a `houseId` the caller doesn't
 * own simply matches no rows. Mirrors `mark-habitat-reviewed.ts`.
 */
export type MarkFoundationCelebrationSeenResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export async function markFoundationCelebrationSeenAction(
  houseId: string,
): Promise<MarkFoundationCelebrationSeenResult> {
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
  if (current.foundation_celebration_seen === true) {
    // Already seen — skip the write to avoid churning the row.
    return { ok: true, changed: false };
  }

  const { error: updateError } = await supabase
    .from("houses")
    .update({
      onboarding_state: { ...current, foundation_celebration_seen: true },
    })
    .eq("id", houseId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, changed: true };
}
