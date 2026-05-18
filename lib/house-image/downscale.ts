// Client-side image downscaling for user photo uploads. Modern phone
// photos land in the 8-12 MB / 4000+ px wide range — far more than the
// dashboard tile ever renders, and a slow upload on a flaky mobile
// connection. We resize to a sane max width and re-encode as JPEG
// before handing the blob to Supabase Storage.
//
// The output target (1200 px wide) is chosen to cover a 2x retina
// render of the dashboard image tile, which is well under 600 CSS px
// in any layout. JPEG quality 0.85 is the usual perceptual sweet spot
// for photo content.

const DEFAULT_MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.85;
const OUTPUT_TYPE = "image/jpeg";

export type DownscaleResult = {
  blob: Blob;
  contentType: string;
};

/**
 * Decode a user-supplied image file and downscale it to at most
 * `maxWidth` pixels wide, preserving aspect ratio and EXIF
 * orientation. Re-encoded as JPEG.
 *
 * If the image is already at or below the target width we return the
 * original file unchanged — re-encoding a small image can actually
 * grow it and strips potentially-useful metadata.
 *
 * If the browser can't decode the file (e.g. HEIC on desktop Chrome),
 * or canvas export fails, we fall back to the original file. The
 * caller's MAX_UPLOAD_BYTES cap is still in force, so a fallback
 * upload is bounded.
 */
export async function downscaleImage(
  file: File,
  maxWidth: number = DEFAULT_MAX_WIDTH,
): Promise<DownscaleResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { blob: file, contentType: file.type };
  }

  if (bitmap.width <= maxWidth) {
    bitmap.close?.();
    return { blob: file, contentType: file.type };
  }

  const targetWidth = maxWidth;
  const targetHeight = Math.round((bitmap.height * maxWidth) / bitmap.width);

  try {
    const blob = await drawAndEncode(bitmap, targetWidth, targetHeight);
    return { blob, contentType: OUTPUT_TYPE };
  } catch {
    return { blob: file, contentType: file.type };
  } finally {
    bitmap.close?.();
  }
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: OUTPUT_TYPE, quality: JPEG_QUALITY });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      OUTPUT_TYPE,
      JPEG_QUALITY,
    );
  });
}
