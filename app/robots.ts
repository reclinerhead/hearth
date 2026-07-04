import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/public-pages/site-url";

/**
 * Robots policy (epic #298, Phase 0). The public surfaces (landing,
 * /how-it-works, /water/*) are crawlable; everything session-bound is
 * disallowed — there's nothing indexable behind the auth wall anyway
 * (the proxy 307s crawlers to /login), but saying so keeps crawl
 * budget on the pages that matter. Vercel already serves
 * `X-Robots-Tag: noindex` on preview deployments, so previews never
 * leak into the index regardless of this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/dashboard",
          "/documents/",
          "/entities/",
          "/houses/",
          "/inventory",
          "/onboarding",
          "/reports",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
