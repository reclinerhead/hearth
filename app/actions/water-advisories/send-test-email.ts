"use server";

import { siteUrl } from "@/lib/public-pages/site-url";
import { createClient } from "@/lib/supabase/server";
import {
  buildAdvisoryEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/water-advisories/email";
import { resolvePlaceNames } from "@/lib/water-advisories/place";
import { requireAdmin } from "./shared";

export type SendTestEmailResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

/**
 * Send the "issued" template to the signed-in admin, rendered against the
 * latest stored advisory for the city (or a sample if the watcher hasn't
 * seeded yet). Bypasses the subscriber list and the notification log — it
 * exists to verify Resend wiring before WATER_ADVISORY_NOTIFY_ENABLED is
 * flipped (issue #331).
 */
export async function sendTestEmailAction(pwsid: string): Promise<SendTestEmailResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin;
  if (!admin.user.email) return { ok: false, error: "Your account has no email address." };
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't configured (RESEND_API_KEY / WATER_ADVISORY_FROM_EMAIL)." };
  }

  const [{ data: latest }, places] = await Promise.all([
    supabase
      .from("water_advisories")
      .select("title, summary, published_on, source_url")
      .eq("pwsid", pwsid)
      .order("first_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    resolvePlaceNames(supabase, [pwsid]),
  ]);
  const place = places.get(pwsid)!;

  const advisory = latest
    ? {
        title: latest.title as string,
        summary: (latest.summary as string) ?? "",
        published_on: (latest.published_on as string | null) ?? null,
        source_url: latest.source_url as string,
      }
    : {
        title: `Boil Water Advisory: ${place.shortPlace} (sample)`,
        summary:
          "This is sample advisory text. The watcher hasn't recorded a real advisory for this city yet.",
        published_on: null,
        source_url: siteUrl(),
      };

  try {
    await sendEmail(
      admin.user.email,
      buildAdvisoryEmail({
        event: "issued",
        advisory,
        place,
        addedBy: admin.label,
        unsubscribeUrl: `${siteUrl()}/api/advisories/unsubscribe?token=test-link-not-active`,
        test: true,
      }),
    );
  } catch (err) {
    console.error("sendTestEmailAction failed", err);
    return { ok: false, error: `The test email failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, to: admin.user.email };
}
