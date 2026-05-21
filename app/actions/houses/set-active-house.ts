"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SetActiveHouseResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Set the user's active house and redirect to /dashboard.
 *
 * RLS on hearth.houses scopes SELECT/UPDATE to owner_id = auth.uid(), so the
 * pre-check confirms ownership before we write to public.profiles. The
 * profile UPDATE policy from #98 allows the user to write active_house_id
 * but pins plan_tier / role / is_admin from client-side mutation.
 *
 * The action always lands on /dashboard rather than the user's current
 * route — switching properties is a context-shift event, and landing on
 * a deep page in the new context can be jarring (matches the Vercel
 * project-switcher pattern). The layout-wide revalidatePath ensures the
 * (app) layout re-runs resolveActiveHouseId even if the user was already
 * on /dashboard when they switched.
 */
export async function setActiveHouseAction(
  houseId: string,
): Promise<SetActiveHouseResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // Verify the user owns the target house. RLS on hearth.houses scopes
  // this SELECT to their owned rows; a row from another user returns
  // nothing rather than an error.
  const { data: house } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .maybeSingle();

  if (!house?.id) {
    return { ok: false, error: "We couldn't find that property." };
  }

  const { error: updateError } = await supabase
    .schema("public")
    .from("profiles")
    .update({ active_house_id: houseId })
    .eq("id", user.id);

  if (updateError) {
    console.error("profiles.active_house_id update failed", updateError);
    return { ok: false, error: "We couldn't switch properties. Try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
