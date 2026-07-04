/**
 * Slug registry for the public habitat pages (epic #298, Phase 0).
 *
 * Public pages are keyed by human place slugs (`/water/kalamazoo-mi`),
 * never by machine identifiers — PWSIDs and county keys stay internal
 * plumbing per the product principle. This module is the single
 * mapping between the two worlds, and it is deliberately a hardcoded
 * allowlist: `generateStaticParams` reads it, `dynamicParams = false`
 * 404s everything outside it, so no user input ever reaches a
 * database or EPA query on a public route.
 *
 * Michigan-first. Phase 3 replaces the hand-seeded water-system list
 * with entries generated from the EPA CWS dataset; the module shape
 * (slug ↔ key, place display names) is what scales, so keep additions
 * in this format rather than inventing a second registry.
 */

export type PublicWaterSystemEntry = {
  /** URL segment under /water/. Lowercase kebab, `-mi` state suffix. */
  slug: string;
  /** EPA Public Water System ID — internal plumbing, never rendered. */
  pwsid: string;
  /** "Kalamazoo, Michigan" — used in metadata and page copy. */
  placeName: string;
  /** "Kalamazoo" — short form for headlines and CTAs. */
  shortPlace: string;
  stateCode: "MI";
};

export const PUBLIC_WATER_SYSTEMS: readonly PublicWaterSystemEntry[] = [
  {
    slug: "kalamazoo-mi",
    pwsid: "MI0003520",
    placeName: "Kalamazoo, Michigan",
    shortPlace: "Kalamazoo",
    stateCode: "MI",
  },
];

/**
 * Phase 2 seed — county-keyed places for the radon / Superfund
 * sections. Registered now so the resolver module is the one unit
 * that grows, but no route consumes these until Phase 2.
 */
export type PublicCountyEntry = {
  slug: string;
  countyName: string;
  stateCode: "MI";
};

export const PUBLIC_COUNTIES: readonly PublicCountyEntry[] = [
  {
    slug: "kalamazoo-county-mi",
    countyName: "Kalamazoo",
    stateCode: "MI",
  },
];

/**
 * Normalize an incoming URL segment before allowlist comparison.
 * Slugs are canonically lowercase; trimming guards against manual
 * URL entry. Anything that doesn't match after normalization is a
 * 404 — there is no fuzzy resolution on purpose.
 */
function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function resolveWaterSystemSlug(
  slug: string,
): PublicWaterSystemEntry | null {
  const normalized = normalizeSlug(slug);
  return PUBLIC_WATER_SYSTEMS.find((e) => e.slug === normalized) ?? null;
}

export function resolveCountySlug(slug: string): PublicCountyEntry | null {
  const normalized = normalizeSlug(slug);
  return PUBLIC_COUNTIES.find((e) => e.slug === normalized) ?? null;
}

/** Every water-system slug, for generateStaticParams and sitemap.ts. */
export function allWaterSystemSlugs(): string[] {
  return PUBLIC_WATER_SYSTEMS.map((e) => e.slug);
}
