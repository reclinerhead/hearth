/**
 * Double opt-in confirmation for the water advisory list (issue #331).
 *
 * GET /api/advisories/confirm?token=…  — no session. The token IS the
 * capability (192 random bits, unique per subscriber), so this route is
 * proxy-exempt and uses the service-role client the same way the cron
 * does: there is no user session to bind RLS to. The write is narrow
 * (one row, matched by token, pending → confirmed) and the response is a
 * static HTML page rather than a redirect into the app — the subscriber
 * is a neighbor, not a Hearth user.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { resolvePlaceNames } from "@/lib/water-advisories/place";
import { renderTokenPage } from "@/lib/water-advisories/token-page";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return renderTokenPage({
      status: 400,
      title: "That link isn't valid",
      body: "The confirmation link is missing or malformed. Ask whoever added you to send a new one.",
    });
  }

  const supabase = createServiceClient();
  const { data: sub, error } = await supabase
    .from("water_advisory_subscribers")
    .select("id, status, pwsid")
    .eq("confirm_token", token)
    .maybeSingle();

  if (error) {
    console.error("[advisories/confirm] lookup failed:", error.message);
    return renderTokenPage({
      status: 500,
      title: "Something went wrong",
      body: "We couldn't check that link right now. Try again in a minute.",
    });
  }
  if (!sub) {
    return renderTokenPage({
      status: 404,
      title: "That link isn't valid",
      body: "We don't recognize this confirmation link. Ask whoever added you to send a new one.",
    });
  }

  const places = await resolvePlaceNames(supabase, [sub.pwsid as string]);
  const place = places.get(sub.pwsid as string)!;

  if (sub.status === "confirmed") {
    return renderTokenPage({
      title: "You're already on the list",
      body: `You'll get an email when a boil water advisory affecting ${place.shortPlace} water customers is issued, updated, or lifted.`,
    });
  }
  if (sub.status === "unsubscribed") {
    return renderTokenPage({
      title: "This address was unsubscribed",
      body: "Ask whoever added you to add you again if you'd like alerts.",
    });
  }

  const { error: updateError } = await supabase
    .from("water_advisory_subscribers")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", sub.id)
    .eq("status", "pending");

  if (updateError) {
    console.error("[advisories/confirm] update failed:", updateError.message);
    return renderTokenPage({
      status: 500,
      title: "Something went wrong",
      body: "We couldn't confirm your address right now. Try the link again in a minute.",
    });
  }

  return renderTokenPage({
    title: "You're on the list",
    body: `Hearth will email you when a boil water advisory affecting ${place.shortPlace} water customers is issued, updated, or lifted. Every email has a one-click unsubscribe link.`,
  });
}
