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
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
  emergencyVideoObjectPath,
  emergencyVideoPosterObjectPath,
  optimizedObjectPath,
  pageOptimizedObjectPath,
  pageThumbnailObjectPath,
  thumbnailObjectPath,
} from "./paths";
import type { VideoContainer } from "./process-video";

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

export type UploadEmergencyVideoFilesArgs = {
  supabase: SupabaseClient;
  houseId: string;
  documentId: string;
  /** Compressed video Blob from processVideo. */
  video: Blob;
  /** Poster JPEG Blob from processVideo. */
  poster: Blob;
  /** Container picked by the compression pipeline (webm or mp4). */
  container: VideoContainer;
  /** MIME of the video Blob (e.g. 'video/webm;codecs=vp9,opus'). */
  videoMimeType: string;
};

export type UploadEmergencyVideoFilesResult = {
  /** Path written to hearth.documents.storage_path. */
  videoPath: string;
  /** Path written to hearth.documents.poster_storage_path. */
  posterPath: string;
};

/**
 * Uploads the compressed emergency-video Blob and its poster JPEG to
 * the hearth-emergency-videos bucket in parallel. Same partial-failure
 * cleanup contract as uploadDocumentFiles, but against a different
 * bucket and using video/poster paths.
 *
 * Throws on any storage error.
 */
export async function uploadEmergencyVideoFiles(
  args: UploadEmergencyVideoFilesArgs,
): Promise<UploadEmergencyVideoFilesResult> {
  const videoPath = emergencyVideoObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
    container: args.container,
  });
  const posterPath = emergencyVideoPosterObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
  });

  const bucket = args.supabase.storage.from(HEARTH_EMERGENCY_VIDEOS_BUCKET);

  const videoOptions = {
    upsert: false,
    cacheControl: "31536000, immutable",
    contentType: args.videoMimeType,
  } as const;
  const posterOptions = {
    upsert: false,
    cacheControl: "31536000, immutable",
    contentType: "image/jpeg",
  } as const;

  const [videoResult, posterResult] = await Promise.allSettled([
    bucket.upload(videoPath, args.video, videoOptions),
    bucket.upload(posterPath, args.poster, posterOptions),
  ]);

  const videoOk =
    videoResult.status === "fulfilled" && !videoResult.value.error;
  const posterOk =
    posterResult.status === "fulfilled" && !posterResult.value.error;

  if (videoOk && posterOk) {
    return { videoPath, posterPath };
  }

  const cleanupPaths: string[] = [];
  if (videoOk) cleanupPaths.push(videoPath);
  if (posterOk) cleanupPaths.push(posterPath);
  if (cleanupPaths.length > 0) {
    await bucket.remove(cleanupPaths).catch(() => undefined);
  }

  const firstError =
    (videoResult.status === "fulfilled" && videoResult.value.error) ||
    (posterResult.status === "fulfilled" && posterResult.value.error) ||
    (videoResult.status === "rejected" && videoResult.reason) ||
    (posterResult.status === "rejected" && posterResult.reason) ||
    new Error("Upload failed for an unknown reason");

  throw firstError;
}

export type UploadDocumentPageFilesArgs = {
  supabase: SupabaseClient;
  houseId: string;
  documentId: string;
  /** 1-indexed; page 1 uses uploadDocumentFiles instead. */
  pageNumber: number;
  optimized: File;
  thumbnail: File;
};

export type UploadDocumentPageFilesResult = {
  /** Path that should be written to hearth.document_pages.storage_path. */
  optimizedPath: string;
  /** Path that should be written to hearth.document_pages.thumbnail_path. */
  thumbnailPath: string;
};

/**
 * Uploads pages 2+ of a multi-page document. Same parallel-upload +
 * partial-failure-cleanup contract as uploadDocumentFiles; the only
 * difference is the path layout (page-{N}-optimized.jpg /
 * page-{N}-thumb.jpg under the document's directory).
 */
export async function uploadDocumentPageFiles(
  args: UploadDocumentPageFilesArgs,
): Promise<UploadDocumentPageFilesResult> {
  const optimizedPath = pageOptimizedObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
    pageNumber: args.pageNumber,
  });
  const thumbnailPath = pageThumbnailObjectPath({
    houseId: args.houseId,
    documentId: args.documentId,
    pageNumber: args.pageNumber,
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
