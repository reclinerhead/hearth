/**
 * Canonical site origin for SEO plumbing (metadataBase, sitemap,
 * robots, canonical URLs). Public pages must emit production-host
 * canonicals even when rendered on a preview deployment, so the
 * resolution order is:
 *
 *   1. NEXT_PUBLIC_SITE_URL — explicit override, set in Vercel env if
 *      the canonical host ever needs to differ from the project's
 *      production domain.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel injects the project's
 *      production domain (hearth.toddtech.llc) in every environment,
 *      including previews. No scheme, so we prefix https.
 *   3. localhost:3000 — local `next dev` / `pnpm build` fallback.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production && production.length > 0) return `https://${production}`;
  return "http://localhost:3000";
}
