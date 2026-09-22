"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_WATER_ADVISORIES_PATH, requireAdmin } from "./shared";

export type RemoveSubscriberResult = { ok: true } | { ok: false; error: string };

/**
 * Remove a subscriber (issue #331). A confirmed address is marked
 * `unsubscribed` (its notification history stays intact and the unique
 * (pwsid, email) key still prevents an accidental re-add without intent);
 * a row that never confirmed is deleted outright — there is nothing to
 * keep.
 */
export async function removeSubscriberAction(
  subscriberId: string,
): Promise<RemoveSubscriberResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin;

  const { data: sub } = await supabase
    .from("water_advisory_subscribers")
    .select("id, status")
    .eq("id", subscriberId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "We couldn't find that subscriber." };

  const { error } =
    sub.status === "confirmed"
      ? await supabase
          .from("water_advisory_subscribers")
          .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
          .eq("id", sub.id)
      : await supabase.from("water_advisory_subscribers").delete().eq("id", sub.id);

  if (error) {
    console.error("removeSubscriberAction failed", error);
    return { ok: false, error: "We couldn't remove that subscriber. Try again." };
  }

  revalidatePath(ADMIN_WATER_ADVISORIES_PATH);
  return { ok: true };
}
