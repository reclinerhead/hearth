/**
 * Parallel upload of the optimized + thumbnail JPEGs produced by
 * processImage to the `hearth-documents` bucket.
 *
 * Browser-only: takes a Supabase browser client (the Smart Uploader is
 * a client component). Storage RLS scopes writes by house ownership
 * via the first path segment — see "Storage RLS" in the technical
 * guide.
 *
 * On partial failure, the helper cleans up whichever upload succeeded
 * so the bucket never accumulates orphaned bytes from an in-progress
 * Smart Uploader flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HEARTH_DOCUMENTS_BUCKET,
  optimizedObjectPath,
  thumbnailObjectPath,
} from "./paths";

export type UploadDocumentFilesArgs = {
  supabase: SupabaseClient;
  houseId: string;
  documentId: string;
  optimized: File;
  thumbnail: File;
};

export type UploadDocumentFilesResult = {
  /** Path that should be written to hearth.documents.storage_path. */
  optimizedPath: string;
  /** Path that should be written to hearth.documents.thumbnail_path. */
  thumbnailPath: string;
};

/**
 * Uploads the optimized JPEG and thumbnail JPEG to the hearth-documents
 * bucket in parallel.
 *
 * Both uploads use upsert=false (each document has its own UUID
 * directory; collisions indicate a caller bug, not a legitimate
 * replacement). cacheControl is '31536000, immutable' since the bytes
 * at these paths never change once written.
 *
 * On any upload failure, the function attempts a best-effort cleanup
 * of whichever upload succeeded, then re-throws the original error.
 *
 * Throws on any storage error.
 */
export async function uploadDocumentFiles(
  args: UploadDocumentFilesArgs,
): Promise<UploadDocumentFilesResult> {
  const optimizedPath = optimizedObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
  });
  const thumbnailPath = thumbnailObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
  });

  const bucket = args.supabase.storage.from(HEARTH_DOCUMENTS_BUCKET);

  const uploadOptions = {
    upsert: false,
    cacheControl: "31536000, immutable",
    contentType: "image/jpeg",
  } as const;

  const [optimizedResult, thumbnailResult] = await Promise.allSettled([
    bucket.upload(optimizedPath, args.optimized, uploadOptions),
    bucket.upload(thumbnailPath, args.thumbnail, uploadOptions),
  ]);

  const optimizedOk =
    optimizedResult.status === "fulfilled" && !optimizedResult.value.error;
  const thumbnailOk =
    thumbnailResult.status === "fulfilled" && !thumbnailResult.value.error;

  if (optimizedOk && thumbnailOk) {
    return { optimizedPath, thumbnailPath };
  }

  const cleanupPaths: string[] = [];
  if (optimizedOk) cleanupPaths.push(optimizedPath);
  if (thumbnailOk) cleanupPaths.push(thumbnailPath);
  if (cleanupPaths.length > 0) {
    // Best-effort; swallow errors so we surface the original cause.
    await bucket.remove(cleanupPaths).catch(() => undefined);
  }

  const firstError =
    (optimizedResult.status === "fulfilled" && optimizedResult.value.error) ||
    (thumbnailResult.status === "fulfilled" && thumbnailResult.value.error) ||
    (optimizedResult.status === "rejected" && optimizedResult.reason) ||
    (thumbnailResult.status === "rejected" && thumbnailResult.reason) ||
    new Error("Upload failed for an unknown reason");

  throw firstError;
}
