import type { SupabaseClient } from "@supabase/supabase-js";

// Signed URL TTL. Long enough that the same URL is reused across an
// entire normal usage window — which combined with sessionStorage
// caching below and the bucket's `cacheControl: 31536000, immutable`
// header gives the browser a stable cache key for the image bytes
// across navigations. Bounded to a week so a leaked URL can't be
// passed around indefinitely.
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

// Cache the issued URL for ~90% of its server-side validity so we
// never hand back a URL that's about to expire mid-render. ~6.3 days.
const CACHE_TTL_MS = Math.floor(SIGNED_URL_EXPIRES_IN_SECONDS * 0.9 * 1000);

const CACHE_PREFIX = "hearthSignedUrl";

// The set of private buckets this helper is wired to sign for. House
// images and photos were the original consumers; the hearth-documents
// bucket joined when the appliance surfaces needed the same
// across-navigation URL stability (see TechnicalGuide → Dashboard
// inventory tiles + Inventory detail page).
export type CachedSignedUrlBucket =
  | "house-images"
  | "house-photos"
  | "hearth-documents";

type CachedEntry = { url: string; expiresAt: number };

function cacheKey(
  bucket: CachedSignedUrlBucket,
  path: string,
  stamp: string | null,
): string {
  return `${CACHE_PREFIX}:${bucket}:${path}:${stamp ?? ""}`;
}

function readCachedUrl(
  bucket: CachedSignedUrlBucket,
  path: string,
  stamp: string | null,
): string | null {
  if (typeof window === "undefined") return null;
  const key = cacheKey(bucket, path, stamp);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CachedEntry>;
    if (typeof entry?.url !== "string" || typeof entry?.expiresAt !== "number") {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return entry.url;
  } catch {
    return null;
  }
}

function writeCachedUrl(
  bucket: CachedSignedUrlBucket,
  path: string,
  stamp: string | null,
  url: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      cacheKey(bucket, path, stamp),
      JSON.stringify({
        url,
        expiresAt: Date.now() + CACHE_TTL_MS,
      } satisfies CachedEntry),
    );
  } catch {
    // sessionStorage can throw in incognito with quota disabled or when
    // storage is full. Skipping the cache is the right fallback — the
    // image still loads, it just won't survive a navigation away.
  }
}

/**
 * Resolve a stored path within a supported private bucket to a signed
 * URL the browser can use directly. Works with either the user's
 * RLS-bound client or the service-role client.
 *
 * The issued URL is cached in `sessionStorage` keyed by
 * `(bucket, path, stamp)` so navigating away from and back to a page
 * reuses the same URL string — which is what lets the browser's HTTP
 * cache actually hit on the image bytes. The bucket objects
 * themselves are uploaded with `cacheControl: '31536000, immutable'`,
 * so once the bytes are in the browser cache they stay there for the
 * duration of that cache.
 *
 * `stamp` is the cache-bust knob for buckets where a path is stable
 * but the bytes can change in place (house-images and house-photos
 * use `generated_image_created_at` / `user_image_uploaded_at`).
 * `hearth-documents` paths embed a `{document_id}` segment that is
 * unique per upload, so callers pass `stamp: null` and rely on the
 * path itself as the version key.
 *
 * Returns null on any error so callers can fall back to a placeholder
 * rather than crash the surrounding render.
 */
export async function createCachedSignedUrl(
  supabase: SupabaseClient,
  bucket: CachedSignedUrlBucket,
  path: string,
  stamp: string | null,
): Promise<string | null> {
  const cached = readCachedUrl(bucket, path, stamp);
  if (cached) return cached;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data) return null;
  writeCachedUrl(bucket, path, stamp, data.signedUrl);
  return data.signedUrl;
}

/**
 * Cache-Control value used when uploading to either house-image
 * bucket. One-year `immutable` is appropriate because the storage
 * path is stable per asset version: a regenerate overwrites in place
 * (and the dashboard cache-busts via the `generated_image_created_at`
 * stamp on the row), and a user photo replace upserts to the same
 * path (cache-busted via `user_image_uploaded_at`).
 */
export const HOUSE_IMAGE_CACHE_CONTROL = "31536000, immutable";
