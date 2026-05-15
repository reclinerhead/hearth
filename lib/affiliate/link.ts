/**
 * Wrap an outbound product URL so we have a single chokepoint for
 * affiliate-tag injection. Identity passthrough today.
 *
 * When we sign up for Amazon Associates (or similar), this is the only
 * place that needs to learn about `tag=` query params, AAX redirects,
 * or per-region storefronts. Modules call affiliateLink(...) on every
 * product URL they emit so the migration is a one-file change.
 */
export function affiliateLink(url: string): string {
  // TODO: append Associates tag once we have one. For now, identity.
  return url;
}
