"use server";

// On-demand "Research this model" server action. Loads the inventory row
// (RLS scopes it through the user's houses), calls Perplexity Sonar via
// the Vercel AI Gateway, and writes the structured result into the
// hearth.inventory.ai_insights jsonb column.
//
// The Sonar call typically takes 5-15 seconds. We block on it (no
// streaming for v1) and surface a loading state in the UI. Re-running is
// idempotent on the row — the new result overwrites whatever was there,
// which lets Todd iterate on the prompt during development without any
// extra plumbing.

import { revalidatePath } from "next/cache";
import {
  getInventoryInsightsModel,
  researchInventoryModel,
} from "@/lib/inventory-insights/research";
import { createClient } from "@/lib/supabase/server";

export type ResearchInventoryModelInput = {
  inventoryId: string;
};

export type ResearchInventoryModelSuccess = {
  generated_at: string;
};

type InventoryItemRow = {
  id: string;
  name: string;
  type: "appliance" | "system" | "exterior";
  manufacturer: string | null;
  model_number: string | null;
  notes: string | null;
  ai_pills: { label: string; value: string }[] | null;
};

export async function researchInventoryModelAction(
  input: ResearchInventoryModelInput,
): Promise<
  | { data: ResearchInventoryModelSuccess; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data: item, error: loadError } = await supabase
    .from("inventory")
    .select("id, name, type, manufacturer, model_number, notes, ai_pills")
    .eq("id", input.inventoryId)
    .single();

  if (loadError || !item) {
    return {
      data: null,
      error: loadError?.message ?? "Item not found",
    };
  }

  const typed = item as InventoryItemRow;

  let insights;
  try {
    insights = await researchInventoryModel({
      manufacturer: typed.manufacturer,
      model_number: typed.model_number,
      inventory_name: typed.name,
      inventory_type: typed.type,
      ai_pills: typed.ai_pills,
      notes: typed.notes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Research call failed";
    return { data: null, error: message };
  }

  const generated_at = new Date().toISOString();
  const model_used = getInventoryInsightsModel() || null;

  const { error: updateError } = await supabase
    .from("inventory")
    .update({
      ai_insights: {
        headline: insights.headline,
        body: insights.body,
        source_urls: insights.source_urls,
        found_specific_model: insights.found_specific_model,
        generated_at,
        model_used,
      },
    })
    .eq("id", input.inventoryId);

  if (updateError) {
    return { data: null, error: updateError.message };
  }

  revalidatePath(`/inventory/${input.inventoryId}`);

  return { data: { generated_at }, error: null };
}
