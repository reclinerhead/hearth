/**
 * SHA-256 content hashing for Smart Uploader dedup.
 *
 * The hash is computed on the user's *original* file bytes — before
 * any Canvas resize — and matched against `hearth.documents.content_hash`
 * via the per-house partial unique index. See the technical guide's
 * "No originals — deliberate trade-off" section for the precise dedup
 * semantics this enables.
 *
 * Browser-only: uses `crypto.subtle.digest`. The Vitest tests opt into
 * jsdom (which provides `crypto.subtle`) via a per-file environment
 * directive.
 */

/**
 * Compute the SHA-256 hex digest of a File or Blob.
 *
 * Returns a 64-character lowercase hex string.
 */
export async function computeContentHash(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
