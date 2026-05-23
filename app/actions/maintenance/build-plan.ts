"use server";

// Server action that kicks off the maintenance-synthesis workflow.
// Triggered by the "Build maintenance plan" / "Rebuild maintenance plan"
// button on the inventory detail page.
//
// Returns immediately — the workflow runs in the background. The client
// reflects in-flight state via a local React useState set on click, and
// the inventory-row Realtime subscription flips it back out when the
// workflow writes last_synthesis_run at completion.

import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { runMaintenanceSynthesis } from "@/workflows/maintenance-synthesis";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function buildMaintenancePlanAction(
  inventoryId: string,
): Promise<ActionResult> {
  // RLS check via the cookie-bound client — the SELECT confirms the
  // user owns this inventory item (through hearth.houses.owner_id)
  // before we kick off background work that bypasses RLS.
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("inventory")
    .select("id, house_id, ai_insights")
    .eq("id", inventoryId)
    .single();

  if (error || !row) {
    return {
      ok: false,
      error: error?.message ?? "Item not found",
    };
  }

  // Belt-and-suspenders gating. The button is hidden on the client when
  // ai_insights.maintenance is null, but a malicious or stale client
  // could still call this action. Refuse on the server.
  const insights = row.ai_insights as {
    maintenance?: string | null;
  } | null;
  if (!insights || !insights.maintenance) {
    return {
      ok: false,
      error:
        "This item doesn't have actionable maintenance insights yet. Run Research first.",
    };
  }

  // Configuration error: surface it inline so Todd sees a real message
  // instead of a swallowed workflow failure when the env var is missing.
  if (!process.env.MAINTENANCE_SYNTHESIS_MODEL) {
    return {
      ok: false,
      error:
        "MAINTENANCE_SYNTHESIS_MODEL is not configured. Set it in .env.local and Vercel project settings.",
    };
  }

  try {
    await start(runMaintenanceSynthesis, [inventoryId]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to start synthesis",
    };
  }
}
