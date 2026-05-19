/**
 * Storage path construction for the `hearth-documents` bucket. The
 * Smart Uploader and any future server-side cleanup / signed-URL code
 * import from here so the path layout stays in one place.
 *
 * Paths are bucket-relative — no leading or trailing slash. Supabase
 * storage rejects paths that begin with '/'.
 */

export const HEARTH_DOCUMENTS_BUCKET = "hearth-documents";

export const OPTIMIZED_FILENAME = "optimized.jpg";
export const THUMBNAIL_FILENAME = "thumb.jpg";

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
