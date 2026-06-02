/**
 * Storage path construction for the `hearth-documents` bucket. The
 * Smart Uploader and any future server-side cleanup / signed-URL code
 * import from here so the path layout stays in one place.
 *
 * Paths are bucket-relative — no leading or trailing slash. Supabase
 * storage rejects paths that begin with '/'.
 */

export const HEARTH_DOCUMENTS_BUCKET = "hearth-documents";
export const HEARTH_EMERGENCY_VIDEOS_BUCKET = "hearth-emergency-videos";

/**
 * User-uploaded house photo bucket. One object per house at
 * `{house_id}/photo` (no extension — the stored content-type carries the
 * MIME). The leaf filename matches `USER_PHOTO_PATH` in DashboardLive's
 * upload handler, which is the source of truth for the path. Lives here
 * with the other bucket-name constants so cleanup / reconciliation code
 * has a single import for every private bucket.
 */
export const HOUSE_PHOTOS_BUCKET = "house-photos";
export const USER_PHOTO_FILENAME = "photo";

export const OPTIMIZED_FILENAME = "optimized.jpg";
export const THUMBNAIL_FILENAME = "thumb.jpg";

export const EMERGENCY_VIDEO_WEBM_FILENAME = "video.webm";
export const EMERGENCY_VIDEO_MP4_FILENAME = "video.mp4";
export const EMERGENCY_VIDEO_POSTER_FILENAME = "poster.jpg";

type DocumentPathArgs = {
  houseId: string;
  documentId: string;
};

function assertPathArgs(args: DocumentPathArgs): void {
  if (!args.houseId) {
    throw new Error("documents/paths: houseId must be a non-empty string");
  }
  if (!args.documentId) {
    throw new Error("documents/paths: documentId must be a non-empty string");
  }
}

/**
 * Directory prefix for a single document. Used with `.list()` and
 * `.remove()` against the whole document (both files at once).
 *
 *   documentDirectoryPath({ houseId, documentId })
 *   → "{houseId}/{documentId}"
 */
export function documentDirectoryPath(args: DocumentPathArgs): string {
  assertPathArgs(args);
  return `${args.houseId}/${args.documentId}`;
}

/**
 * Full object path for the optimized JPEG.
 *
 *   optimizedObjectPath({ houseId, documentId })
 *   → "{houseId}/{documentId}/optimized.jpg"
 */
export function optimizedObjectPath(args: DocumentPathArgs): string {
  assertPathArgs(args);
  return `${args.houseId}/${args.documentId}/${OPTIMIZED_FILENAME}`;
}

/**
 * Full object path for the thumbnail JPEG.
 *
 *   thumbnailObjectPath({ houseId, documentId })
 *   → "{houseId}/{documentId}/thumb.jpg"
 */
export function thumbnailObjectPath(args: DocumentPathArgs): string {
  assertPathArgs(args);
  return `${args.houseId}/${args.documentId}/${THUMBNAIL_FILENAME}`;
}

type PagePathArgs = DocumentPathArgs & { pageNumber: number };

function assertPageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 2) {
    throw new Error(
      "documents/paths: pageNumber must be an integer >= 2 (page 1 lives on the parent row)",
    );
  }
}

/**
 * Full object path for a multi-page document's optimized JPEG, pages 2+.
 * Page 1 still uses optimizedObjectPath — only pages 2..N land here.
 *
 *   pageOptimizedObjectPath({ houseId, documentId, pageNumber: 2 })
 *   → "{houseId}/{documentId}/page-2-optimized.jpg"
 */
export function pageOptimizedObjectPath(args: PagePathArgs): string {
  assertPathArgs(args);
  assertPageNumber(args.pageNumber);
  return `${args.houseId}/${args.documentId}/page-${args.pageNumber}-optimized.jpg`;
}

/**
 * Full object path for a multi-page document's thumbnail JPEG, pages 2+.
 *
 *   pageThumbnailObjectPath({ houseId, documentId, pageNumber: 2 })
 *   → "{houseId}/{documentId}/page-2-thumb.jpg"
 */
export function pageThumbnailObjectPath(args: PagePathArgs): string {
  assertPathArgs(args);
  assertPageNumber(args.pageNumber);
  return `${args.houseId}/${args.documentId}/page-${args.pageNumber}-thumb.jpg`;
}

type EmergencyVideoPathArgs = DocumentPathArgs & {
  container: "webm" | "mp4";
};

/**
 * Full object path for an emergency procedure video in the
 * `hearth-emergency-videos` bucket. Container is webm on Chrome /
 * Firefox / Edge, mp4 on Safari — picked by the compression
 * pipeline based on MediaRecorder.isTypeSupported.
 *
 *   emergencyVideoObjectPath({ houseId, documentId, container: 'webm' })
 *   → "{houseId}/{documentId}/video.webm"
 */
export function emergencyVideoObjectPath(args: EmergencyVideoPathArgs): string {
  assertPathArgs(args);
  const filename =
    args.container === "webm"
      ? EMERGENCY_VIDEO_WEBM_FILENAME
      : EMERGENCY_VIDEO_MP4_FILENAME;
  return `${args.houseId}/${args.documentId}/${filename}`;
}

/**
 * Full object path for an emergency video's poster-frame JPEG.
 *
 *   emergencyVideoPosterObjectPath({ houseId, documentId })
 *   → "{houseId}/{documentId}/poster.jpg"
 */
export function emergencyVideoPosterObjectPath(args: DocumentPathArgs): string {
  assertPathArgs(args);
  return `${args.houseId}/${args.documentId}/${EMERGENCY_VIDEO_POSTER_FILENAME}`;
}
