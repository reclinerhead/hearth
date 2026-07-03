import type { MetadataRoute } from "next";
import { allWaterSystemSlugs } from "@/lib/public-pages/slugs";
import { siteUrl } from "@/lib/public-pages/site-url";

/**
 * Sitemap for the public surfaces (epic #298, Phase 0). Authenticated
 * routes deliberately never appear here — robots.ts disallows them.
 * Phase 3's programmatic scale-out grows the /water/ set by growing
 * the slug registry; this file doesn't change.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    {
      url: base,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${base}/how-it-works`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...allWaterSystemSlugs().map((slug) => ({
      url: `${base}/water/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
