/**
 * Client-side PDF → per-page JPEG renderer for the CCR upload flow.
 *
 * The extraction pipeline ([`lib/documents/ai/analyze.ts:analyzeCcrPdf`])
 * accepts ordered image URLs and treats them as the pages of one logical
 * document. CCRs are usually PDFs the utility publishes online, so we
 * render each PDF page to a Canvas in the browser, then encode the
 * Canvas as JPEG, then push each page through the existing per-page
 * upload primitives that already power multi-page receipts.
 *
 * The model side stays unchanged — same `{ type: 'image', image: URL }`
 * message shape as receipts.
 *
 * `pdfjs-dist` v5+ ships an ES module bundle and a separate worker.
 * The worker is copied into `public/pdfjs/` at install time by
 * `scripts/copy-pdfjs-worker.mjs` (hooked from `postinstall`), and the
 * browser loads it via the static path below. The earlier
 * `new URL(..., import.meta.url)` pattern triggered an
 * `empty-import-meta` warning when the Vercel Workflow bundler reached
 * this file transitively through the habitat-module registry — the
 * code is never actually executed in that CJS context (browser-only
 * pipeline) but the warning was noisy. A static path resolves the
 * warning cleanly without changing runtime behavior.
 */

/**
 * Public URL the static worker is served from. Matches the destination
 * `scripts/copy-pdfjs-worker.mjs` writes to. If the pdfjs-dist version
 * is upgraded, the postinstall script picks up the new bytes on the
 * next `pnpm install` — no code change required here.
 */
const PDFJS_WORKER_SRC = "/pdfjs/pdf.worker.min.mjs";

import { OPTIMIZED_FILENAME, THUMBNAIL_FILENAME } from "./paths";
import {
  OPTIMIZED_JPEG_QUALITY,
  OPTIMIZED_MAX_DIMENSION,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_DIMENSION,
  type ProcessImageResult,
} from "./process-image";

/**
 * Max PDF pages we'll render. CCRs are typically 4-12 pages; capping at
 * 20 catches the long-tail of glossy brochure variants without letting
 * a malformed or extra-long PDF blow the model's context window.
 */
export const CCR_MAX_PDF_PAGES = 20;

/**
 * Scale factor passed to pdfjs's `page.getViewport`. 2.0 yields a
 * rendered canvas roughly 2× the PDF's native point dimensions, which
 * for a US-letter CCR page comes out at ~1700×2200 — well above the
 * 1920px optimized-output target, so the downstream resize has room to
 * downscale rather than upscale. Bumping higher costs memory without
 * improving OCR-style legibility for the model.
 */
const RENDER_SCALE = 2.0;

/**
 * Render the source canvas to a JPEG File at the given max dimension
 * and quality. Mirrors the inner loop of `process-image.ts:resizeToFile`
 * — same JPEG quality tuning, same downscale-only discipline (a page
 * smaller than the target dimension is encoded at its native size).
 */
async function canvasToScaledJpeg(
  source: HTMLCanvasElement,
  maxDimension: number,
  quality: number,
  outputFilename: string,
): Promise<File> {
  const ratio = Math.min(
    1,
    maxDimension / Math.max(source.width, source.height),
  );
  const width = Math.round(source.width * ratio);
  const height = Math.round(source.height * ratio);

  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    target.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("canvas.toBlob returned null")),
      "image/jpeg",
      quality,
    );
  });
  return new File([blob], outputFilename, { type: "image/jpeg" });
}

/**
 * Render a PDF File to an array of `ProcessImageResult` (optimized +
 * thumbnail JPEGs per page). Pages are returned in document order.
 *
 * Throws when:
 *   * The PDF can't be parsed (corrupt file, encrypted with a password)
 *   * The PDF has more than `CCR_MAX_PDF_PAGES` pages
 *   * Any page's Canvas allocation fails
 *
 * Lazy-imports `pdfjs-dist` so the ~600KB worker only loads when the
 * user actually picks a PDF.
 */
export async function renderPdfToPages(
  file: File,
): Promise<ProcessImageResult[]> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is served as a static asset from public/pdfjs/, copied
  // there by scripts/copy-pdfjs-worker.mjs at install time. Setting
  // workerSrc once per page load is idempotent (pdfjs guards against
  // double-init internally).
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

  const buffer = await file.arrayBuffer();
  // pdfjs reads the buffer; pass a fresh `Uint8Array` so its internal
  // consumption doesn't invalidate the original ArrayBuffer reference.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  if (pdf.numPages > CCR_MAX_PDF_PAGES) {
    pdf.destroy();
    throw new Error(
      `This PDF has ${pdf.numPages} pages — Hearth currently supports up to ${CCR_MAX_PDF_PAGES}-page CCRs. Try a shorter version or contact us if your utility publishes long reports.`,
    );
  }

  const pages: ProcessImageResult[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas 2D context unavailable while rendering PDF page");
      }
      // Newer pdfjs accepts `canvas` directly on the render parameter
      // (the `canvasContext` form is deprecated); the runtime supports
      // both. The cast keeps both shapes typing-clean.
      await page.render({
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;

      const [optimized, thumbnail] = await Promise.all([
        canvasToScaledJpeg(
          canvas,
          OPTIMIZED_MAX_DIMENSION,
          OPTIMIZED_JPEG_QUALITY,
          OPTIMIZED_FILENAME,
        ),
        canvasToScaledJpeg(
          canvas,
          THUMBNAIL_MAX_DIMENSION,
          THUMBNAIL_JPEG_QUALITY,
          THUMBNAIL_FILENAME,
        ),
      ]);

      pages.push({ optimized, thumbnail });
      page.cleanup();
    }
  } finally {
    pdf.destroy();
  }

  return pages;
}
