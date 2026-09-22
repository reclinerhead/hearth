import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured } from "@/lib/water-advisories/email";
import { resolvePlaceNames } from "@/lib/water-advisories/place";
import type { AdvisoryScope, AdvisoryStatus } from "@/lib/water-advisories/types";
import { WaterAdvisoryAdmin, type AdminCity } from "./water-advisory-admin";

/**
 * Admin page for the water advisory watcher (issue #331): per watched
 * city, the watcher's health, the advisories it has recorded, and the
 * subscriber list with add / remove / resend-confirmation actions.
 *
 * Server component. The proxy already bounced non-admins to /dashboard;
 * this re-checks as defense in depth. Every read runs under the admin's
 * session — the subscriber table's RLS is what makes it admin-only, so
 * a non-admin who somehow rendered this would see an empty list, not
 * someone else's neighbors.
 */
export default async function WaterAdvisoriesAdminPage() {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .schema("public")
    .from("profiles")
    .select("is_admin")
    .maybeSingle();
  if (profile?.is_admin !== true) redirect("/dashboard");

  const [sourcesRes, advisoriesRes, subscribersRes] = await Promise.all([
    supabase
      .from("water_advisory_sources")
      .select(
        "pwsid, kind, config, enabled, last_run_at, last_ok_at, consecutive_failures, last_error, failure_alerted_at",
      )
      .order("pwsid"),
    supabase
      .from("water_advisories")
      .select(
        "id, pwsid, source_url, title, summary, status, scope, published_on, on_emergency_banner, first_seen_at, last_changed_at",
      )
      .order("first_seen_at", { ascending: false })
      .limit(200),
    supabase
      .from("water_advisory_subscribers")
      .select(
        "id, pwsid, name, email, address_line1, address_line2, city, state, postal_code, status, created_at, confirmed_at, added_by_label",
      )
      .order("created_at", { ascending: false }),
  ]);

  // Surface loader errors rather than rendering an empty admin page that
  // looks like "no cities" — schema drift or an RLS slip must be visible.
  const loadError =
    sourcesRes.error?.message ??
    advisoriesRes.error?.message ??
    subscribersRes.error?.message ??
    null;

  const sources = sourcesRes.data ?? [];
  const places = await resolvePlaceNames(
    supabase,
    sources.map((s) => s.pwsid as string),
  );

  const cities: AdminCity[] = sources.map((s) => {
    const pwsid = s.pwsid as string;
    const place = places.get(pwsid)!;
    const config = (s.config ?? {}) as Record<string, unknown>;
    return {
      pwsid,
      shortPlace: place.shortPlace,
      placeName: place.placeName,
      kind: s.kind as string,
      listUrl: typeof config.list_url === "string" ? config.list_url : null,
      enabled: Boolean(s.enabled),
      lastRunAt: (s.last_run_at as string | null) ?? null,
      lastOkAt: (s.last_ok_at as string | null) ?? null,
      consecutiveFailures: Number(s.consecutive_failures ?? 0),
      lastError: (s.last_error as string | null) ?? null,
      advisories: (advisoriesRes.data ?? [])
        .filter((a) => a.pwsid === pwsid)
        .map((a) => ({
          id: a.id as string,
          title: a.title as string,
          summary: (a.summary as string) ?? "",
          status: a.status as AdvisoryStatus,
          scope: a.scope as AdvisoryScope,
          publishedOn: (a.published_on as string | null) ?? null,
          onEmergencyBanner: Boolean(a.on_emergency_banner),
          sourceUrl: a.source_url as string,
          firstSeenAt: a.first_seen_at as string,
          lastChangedAt: a.last_changed_at as string,
        })),
      subscribers: (subscribersRes.data ?? [])
        .filter((r) => r.pwsid === pwsid)
        .map((r) => ({
          id: r.id as string,
          name: r.name as string,
          email: r.email as string,
          address: [
            r.address_line1,
            r.address_line2,
            [r.city, r.state].filter(Boolean).join(", "),
            r.postal_code,
          ]
            .filter((part) => typeof part === "string" && part.length > 0)
            .join(" · "),
          status: r.status as "pending" | "confirmed" | "unsubscribed",
          createdAt: r.created_at as string,
          confirmedAt: (r.confirmed_at as string | null) ?? null,
          addedBy: r.added_by_label as string,
        })),
    };
  });

  return (
    <WaterAdvisoryAdmin
      cities={cities}
      loadError={loadError}
      notifyEnabled={process.env.WATER_ADVISORY_NOTIFY_ENABLED === "true"}
      emailConfigured={isEmailConfigured()}
      alertEmailConfigured={Boolean(process.env.WATER_ADVISORY_ALERT_EMAIL)}
    />
  );
}
