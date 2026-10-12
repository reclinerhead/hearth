/**
 * GET /api/water/{slug}/advisories — the public JSON advisories feed
 * (issue #358). The machine-readable twin of the advisories block on
 * `/water/{slug}`; shape and discipline in `lib/public-pages/advisory-feed.ts`.
 *
 * Lives outside `app/(public)/` because that group allows no route
 * handlers (epic #298 hard rule 6). Unauthenticated on purpose — every
 * field is already on the indexed page — so the proxy exempts
 * `/api/water/`; `robots.ts` already disallows `/api/` and the response
 * also says `noindex`.
 *
 * Caching (Next 16, no Cache Components): GET handlers are dynamic by
 * default, so this one opts in. `force-static` + `generateStaticParams`
 * prerender one response per allowlisted slug; `dynamicParams = false`
 * 404s anything else before any data access; `revalidate` regenerates at
 * most every 10 minutes, which keeps `watcher.lastOkAt` honest while no
 * advisory changes and bounds database reads by time, not traffic. The
 * watcher cron also calls `revalidatePath` on this path when a run
 * records a new or changed row, so an advisory lands within its half hour.
 * The read uses the service-role client at generation time with no
 * session, the same posture as the public page (public-pages.md).
 */

import { buildAdvisoryFeed } from "@/lib/public-pages/advisory-feed";
import { allWaterSystemSlugs, resolveWaterSystemSlug } from "@/lib/public-pages/slugs";
import { resolveAdvisoryFeed } from "@/lib/public-pages/water-data";

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = 600;

export function generateStaticParams(): { systemSlug: string }[] {
  return allWaterSystemSlugs().map((systemSlug) => ({ systemSlug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ systemSlug: string }> },
): Promise<Response> {
  const { systemSlug } = await params;
  // dynamicParams = false already 404s an unknown slug; this is the
  // belt-and-braces check that nothing outside the allowlist reaches a query.
  const entry = resolveWaterSystemSlug(systemSlug);
  if (!entry) return new Response("Not found", { status: 404 });

  const now = new Date();
  const input = await resolveAdvisoryFeed(entry.pwsid, now).catch(() => null);
  return Response.json(buildAdvisoryFeed(entry, input, now), {
    headers: { "X-Robots-Tag": "noindex" },
  });
}
