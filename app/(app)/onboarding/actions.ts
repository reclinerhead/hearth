"use server";

import { redirect } from "next/navigation";
import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { runBriefing } from "@/workflows/briefing";
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

  // Ensure the shared public.profiles row exists for this user. The Supabase
  // project is shared with other apps that own public.profiles and create
  // rows from their own application code on signup, not via an auth.users
  // trigger. A Hearth-only signup never touches those apps, so the profile
  // row might not exist yet — and hearth.houses.owner_id has a FK into
  // public.profiles. Idempotent: does nothing if a row is already there.
  const { error: profileError } = await supabase
    .schema("public")
    .from("profiles")
    .upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) {
    console.error("profiles.upsert failed", {
      code: profileError.code,
      message: profileError.message,
    });
    return {
      ok: false,
      error: "We couldn't set up your account. Please try again.",
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

  // Kick off the Day One Briefing in the background. The dashboard
  // subscribes to row updates via Realtime and shows progress in place,
  // so we don't await here. If start() throws (workflow infrastructure
  // issue), log and continue — the dashboard handles the resulting
  // 'pending' status gracefully and the user shouldn't be blocked from
  // reaching their dashboard.
  if (inserted?.id) {
    try {
      await start(runBriefing, [inserted.id]);
    } catch (briefingError) {
      console.error("briefing workflow start failed", briefingError);
    }
  }

  redirect("/dashboard");
}
