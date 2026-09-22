"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { siteUrl } from "@/lib/public-pages/site-url";
import { createClient } from "@/lib/supabase/server";
import {
  buildConfirmationEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/water-advisories/email";
import { resolvePlaceNames } from "@/lib/water-advisories/place";
import { ADMIN_WATER_ADVISORIES_PATH, requireAdmin } from "./shared";

export type AddSubscriberInput = {
  pwsid: string;
  name: string;
  email: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

export type AddSubscriberResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s.length === 0 ? null : s))
  .optional();

const inputSchema = z.object({
  pwsid: z.string().trim().min(5).max(20),
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.email("Enter a valid email address.").trim().max(254),
  address_line1: optionalText,
  address_line2: optionalText,
  city: optionalText,
  state: optionalText,
  postal_code: optionalText,
});

/** 192 random bits, URL-safe. Never rendered in the app. */
function token(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Add a subscriber to a watched city's list and send the double-opt-in
 * confirmation (issue #331). Runs under the admin's session: the RLS
 * policies on water_advisory_subscribers gate on hearth.is_admin(), so a
 * non-admin's insert fails at the database even if they reach this action.
 */
export async function addSubscriberAction(
  raw: AddSubscriberInput,
): Promise<AddSubscriberResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin;

  const { data: source } = await supabase
    .from("water_advisory_sources")
    .select("pwsid")
    .eq("pwsid", input.pwsid)
    .maybeSingle();
  if (!source) return { ok: false, error: "That city isn't on the watch list." };

  const confirmToken = token();
  const { error: insertError } = await supabase
    .from("water_advisory_subscribers")
    .insert({
      pwsid: input.pwsid,
      name: input.name,
      email: input.email,
      address_line1: input.address_line1 ?? null,
      address_line2: input.address_line2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postal_code: input.postal_code ?? null,
      status: "pending",
      confirm_token: confirmToken,
      unsubscribe_token: token(),
      created_by: admin.user.id,
      added_by_label: admin.label,
    });
  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, error: "That email is already on this city's list." };
    }
    console.error("addSubscriberAction insert failed", insertError);
    return { ok: false, error: "We couldn't add that subscriber. Try again." };
  }

  revalidatePath(ADMIN_WATER_ADVISORIES_PATH);

  if (!isEmailConfigured()) {
    return {
      ok: true,
      warning:
        "Added as pending, but email isn't configured (RESEND_API_KEY / WATER_ADVISORY_FROM_EMAIL) so no confirmation was sent.",
    };
  }

  try {
    const places = await resolvePlaceNames(supabase, [input.pwsid]);
    await sendEmail(
      input.email,
      buildConfirmationEmail({
        name: input.name,
        place: places.get(input.pwsid)!,
        addedBy: admin.label,
        confirmUrl: `${siteUrl()}/api/advisories/confirm?token=${encodeURIComponent(confirmToken)}`,
      }),
    );
  } catch (err) {
    console.error("addSubscriberAction confirmation email failed", err);
    return {
      ok: true,
      warning:
        "Added as pending, but the confirmation email failed to send. Use “Resend confirmation” to try again.",
    };
  }

  return { ok: true };
}
