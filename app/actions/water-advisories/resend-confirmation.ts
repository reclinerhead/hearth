"use server";

import { siteUrl } from "@/lib/public-pages/site-url";
import { createClient } from "@/lib/supabase/server";
import {
  buildConfirmationEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/water-advisories/email";
import { resolvePlaceNames } from "@/lib/water-advisories/place";
import { requireAdmin } from "./shared";

export type ResendConfirmationResult = { ok: true } | { ok: false; error: string };

/** Re-send the double-opt-in email to a still-pending subscriber (issue #331). */
export async function resendConfirmationAction(
  subscriberId: string,
): Promise<ResendConfirmationResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin;

  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't configured (RESEND_API_KEY / WATER_ADVISORY_FROM_EMAIL)." };
  }

  const { data: sub } = await supabase
    .from("water_advisory_subscribers")
    .select("id, pwsid, name, email, status, confirm_token, added_by_label")
    .eq("id", subscriberId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "We couldn't find that subscriber." };
  if (sub.status !== "pending") {
    return { ok: false, error: "Only pending subscribers can be re-sent a confirmation." };
  }

  try {
    const places = await resolvePlaceNames(supabase, [sub.pwsid as string]);
    await sendEmail(
      sub.email as string,
      buildConfirmationEmail({
        name: sub.name as string,
        place: places.get(sub.pwsid as string)!,
        addedBy: sub.added_by_label as string,
        confirmUrl: `${siteUrl()}/api/advisories/confirm?token=${encodeURIComponent(sub.confirm_token as string)}`,
      }),
    );
  } catch (err) {
    console.error("resendConfirmationAction failed", err);
    return { ok: false, error: "The confirmation email failed to send. Try again in a minute." };
  }
  return { ok: true };
}
