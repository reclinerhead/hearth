/**
 * Canvas-based image resize for the Smart Uploader.
 *
 * Takes a user-selected image File and produces two new File objects:
 * an optimized 1920px JPEG and a 600px thumbnail JPEG. Both encode at
 * fixed quality. The original bytes are not preserved by this module —
 * the caller is expected to have already hashed them via
 * ./content-hash if dedup matters.
 *
 * Browser-only: uses `URL.createObjectURL`, `HTMLImageElement`, and
 * `HTMLCanvasElement`. Process-image tests opt into jsdom and mock the
 * Canvas pipeline (jsdom does not implement Canvas decoding).
 */

import { OPTIMIZED_FILENAME, THUMBNAIL_FILENAME } from "./paths";

export const OPTIMIZED_MAX_DIMENSION = 1920;
export const OPTIMIZED_JPEG_QUALITY = 0.88;

export const THUMBNAIL_MAX_DIMENSION = 600;
export const THUMBNAIL_JPEG_QUALITY = 0.82;

export type ProcessImageResult = {
  /** 1920px-max JPEG, quality 0.88. */
  optimized: File;
  /** 600px-max thumbnail JPEG, quality 0.82. */
  thumbnail: File;
};

async function resizeToFile(
  source: HTMLImageElement,
  maxDimension: number,
  quality: number,
  outputFilename: string,
): Promise<File> {
  // Scale DOWN only — never enlarge a smaller image. If the source is
  // already within bounds, output dimensions equal source dimensions.
  const ratio = Math.min(
    1,
    maxDimension / Math.max(source.naturalWidth, source.naturalHeight),
  );
  const width = Math.round(source.naturalWidth * ratio);
  const height = Math.round(source.naturalHeight * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("canvas.toBlob returned null")),
      "image/jpeg",
      quality,
    );
  });

  return new File([blob], outputFilename, { type: "image/jpeg" });
}

/**
 * Resize a user-selected image File into an optimized JPEG and a
 * thumbnail JPEG via the browser Canvas API. The two resizes run in
 * parallel.
 *
 * Output File objects use OPTIMIZED_FILENAME and THUMBNAIL_FILENAME so
 * the upload step can trust the names without re-deriving them.
 *
 * Throws if the input File can't be decoded (corrupt image, unsupported
 * codec). HEIC support depends on the browser — iOS Safari decodes
 * HEIC natively; desktop Chrome does not. Decode errors should surface
 * to the user as a retake prompt.
 */
export async function processImage(file: File): Promise<ProcessImageResult> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error(`Failed to decode image: ${file.name}`));
      el.src = objectUrl;
    });

    const [optimized, thumbnail] = await Promise.all([
      resizeToFile(
        img,
        OPTIMIZED_MAX_DIMENSION,
        OPTIMIZED_JPEG_QUALITY,
        OPTIMIZED_FILENAME,
      ),
      resizeToFile(
        img,
        THUMBNAIL_MAX_DIMENSION,
        THUMBNAIL_JPEG_QUALITY,
        THUMBNAIL_FILENAME,
      ),
    ]);

    return { optimized, thumbnail };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
