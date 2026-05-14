"use server";

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

  const { error } = await supabase.from("houses").insert({
    owner_id: user.id,
    ...address,
    mapbox_raw: feature as unknown as Record<string, unknown>,
  });

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

  redirect("/dashboard");
}
