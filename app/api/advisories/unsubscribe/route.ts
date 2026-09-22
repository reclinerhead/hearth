/**
 * One-click unsubscribe for the water advisory list (issue #331).
 *
 * GET /api/advisories/unsubscribe?token=…  — same posture as the confirm
 * route: no session, token is the capability, service-role client for
 * the one-row write, static HTML response. Idempotent: hitting the link
 * twice is fine.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { renderTokenPage } from "@/lib/water-advisories/token-page";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return renderTokenPage({
      status: 400,
      title: "That link isn't valid",
      body: "The unsubscribe link is missing or malformed. Reply to the advisory email and we'll remove you by hand.",
    });
  }

  const supabase = createServiceClient();
  const { data: sub, error } = await supabase
    .from("water_advisory_subscribers")
    .select("id, status")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (error) {
    console.error("[advisories/unsubscribe] lookup failed:", error.message);
    return renderTokenPage({
      status: 500,
      title: "Something went wrong",
      body: "We couldn't process that link right now. Try again in a minute.",
    });
  }
  if (!sub) {
    return renderTokenPage({
      status: 404,
      title: "That link isn't valid",
      body: "We don't recognize this unsubscribe link.",
    });
  }

  if (sub.status !== "unsubscribed") {
    const { error: updateError } = await supabase
      .from("water_advisory_subscribers")
      .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
      .eq("id", sub.id);
    if (updateError) {
      console.error("[advisories/unsubscribe] update failed:", updateError.message);
      return renderTokenPage({
        status: 500,
        title: "Something went wrong",
        body: "We couldn't unsubscribe you right now. Try the link again in a minute.",
      });
    }
  }

  return renderTokenPage({
    title: "You're unsubscribed",
    body: "You won't get any more water advisory emails from Hearth. If that was a mistake, ask whoever added you to add you again.",
  });
}
