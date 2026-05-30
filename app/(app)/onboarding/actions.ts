"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  extractAddress,
  type MapboxRetrievedFeature,
} from "./extract-address";

export type CreateHouseResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createHouseFromMapboxFeature(
  feature: MapboxRetrievedFeature,
): Promise<CreateHouseResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  let address;
  try {
    address = extractAddress(feature);
  } catch {
    return {
      ok: false,
      error: "We couldn't read that address. Try selecting it again.",
    };
  }

  const { data: inserted, error } = await supabase
    .from("houses")
    .insert({
      owner_id: user.id,
      ...address,
      mapbox_raw: feature as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on the (owner_id, mapbox_id) index. The user
    // already has this house — funnel them to the dashboard rather than
    // surfacing a SQL error.
    if (error.code === "23505") {
      redirect("/dashboard");
    }
    console.error("houses.insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return {
      ok: false,
      error: "We couldn't save your house. Please try again.",
    };
  }

  if (inserted?.id) {
    // Set this house as the user's active house. For onboarding (first
    // house) this is essentially a no-op against the null default; for
    // the /houses/new flow this moves them to the newly added property
    // so the dashboard they land on is the right one. The profile
    // UPDATE policy from #98 allows the user to write active_house_id.
    // A failure here doesn't block the redirect — resolveActiveHouseId's
    // fallback path resolves to the most-recently-created house, which
    // is the new one anyway.
    const { error: profileError } = await supabase
      .schema("public")
      .from("profiles")
      .update({ active_house_id: inserted.id })
      .eq("id", user.id);
    if (profileError) {
      console.error("set active_house_id on new house failed", profileError);
    }
  }

  // Invalidate the (app) layout cache so the top-nav address chip and the
  // home-details modal pick up the new active house instead of serving
  // the stale snapshot from /houses/new (or /onboarding). Without this,
  // /dashboard server-renders the new house in its own body but the
  // shared layout above it keeps the prior data — the same staleness
  // /setActiveHouseAction guards against on every switch.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
