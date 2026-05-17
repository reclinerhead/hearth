import type { SupabaseClient } from "@supabase/supabase-js";

// The house-images bucket is private. The dashboard fetches a short-lived
// signed URL whenever the row's generated_image_url path is set or
// changes. 1 hour comfortably covers a dashboard session and is short
// enough that a leaked URL goes stale quickly.
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;
const BUCKET = "house-images";

/**
 * Resolve a stored path within the `house-images` bucket to a temporary
 * signed URL the browser can use directly. Works with either the user's
 * RLS-bound client (which the policy on storage.objects authorizes) or
 * the service-role client. Returns null on any error so the caller can
 * fall back to the placeholder image rather than blowing up the page.
 */
export async function createHouseImageSignedUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}
