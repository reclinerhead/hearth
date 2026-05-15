"use server";

import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { runBriefing } from "@/workflows/briefing";

export type RefreshBriefingResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Re-run the Day One Briefing workflow for a house the signed-in user owns.
 *
 * The workflow's persist step now merges results non-destructively (see
 * lib/briefing/merge.ts), so re-runs accumulate fields rather than
 * overwriting them. The dashboard's Realtime subscription reacts to
 * briefing_status transitions automatically — this action just verifies
 * the caller and queues the workflow.
 */
export async function refreshBriefing(
  houseId: string,
): Promise<RefreshBriefingResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // RLS already scopes SELECT to owner_id = auth.uid(), so this also acts
  // as the ownership check. A missing row from the user's POV means either
  // a bad houseId or someone else's row.
  const { data: house, error } = await supabase
    .from("houses")
    .select("id, briefing_status")
    .eq("id", houseId)
    .single();

  if (error || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  // Block double-starts at the server. The button is also disabled
  // client-side while briefing_status is 'running', but a stale client
  // (slow Realtime, lagging poll) could still fire — guard here too.
  if (house.briefing_status === "running") {
    return { ok: false, error: "A refresh is already in progress." };
  }

  try {
    await start(runBriefing, [houseId]);
  } catch (workflowError) {
    console.error("refresh briefing workflow start failed", workflowError);
    return {
      ok: false,
      error: "We couldn't start the refresh. Try again in a moment.",
    };
  }

  return { ok: true };
}
