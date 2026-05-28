"use client";

import { useCallback, useRef, useState } from "react";
import { addDocumentPageAction } from "@/app/actions/documents/add-document-page";
import { analyzeCcrAction } from "@/app/actions/documents/analyze-ccr";
import { createPendingDocumentAction } from "@/app/actions/documents/create-pending";
import { finalizeCcrUploadAction } from "@/app/actions/documents/finalize-ccr-upload";
import { computeContentHash } from "@/lib/documents/content-hash";
import { renderPdfToPages } from "@/lib/documents/process-pdf";
import {
  uploadDocumentFiles,
  uploadDocumentPageFiles,
} from "@/lib/documents/upload";
import { createClient } from "@/lib/supabase/client";
import type { CcrDedupReason, CcrExtraction } from "@/types/document";

/**
 * Orchestration hook for the CCR (Consumer Confidence Report) upload
 * flow. Issue #194 (follow-up to #176, WQA-3).
 *
 * One-shot pipeline — unlike the receipt hook there is no incremental
 * page capture, no review-and-attach step. The user picks a single PDF
 * and we drive it through:
 *
 *   1. Hash the PDF bytes (becomes hearth.documents.content_hash, the
 *      key for byte-identical re-upload detection).
 *   2. Render every PDF page to an optimized + thumbnail JPEG pair via
 *      `renderPdfToPages`.
 *   3. Upload page 1's files + INSERT the parent hearth.documents row
 *      with kind='water_quality_report', status='analyzing'.
 *   4. Upload pages 2+'s files + INSERT each into hearth.document_pages
 *      sequentially (so the action layer's page enumeration is stable).
 *   5. Call analyzeCcrAction — runs the model, persists the raw
 *      extraction, flips status to 'analyzed'.
 *   6. Call finalizeCcrUploadAction — runs the two-stage dedup, writes
 *      the shared-cache row + contributor row, flips status to
 *      'attached'.
 *
 * Soft-fail at every step. A failure mid-pipeline transitions to the
 * "error" phase carrying a message; the storage objects and (possibly
 * partial) document row are not auto-cleaned up — same discipline as
 * the receipt hook. A periodic sweep of orphaned uploads is the
 * documented future-phase backstop.
 */

export type CcrUploadPhase =
  | "idle"
  | "hashing"
  | "rendering"
  | "uploading"
  | "analyzing"
  | "finalizing"
  | "done"
  | "error";

export type CcrUploadState = {
  phase: CcrUploadPhase;
  /** Number of PDF pages detected (set after rendering completes). */
  pageCount: number | null;
  /** Per-page upload progress, in the range [0, pageCount]. */
  pagesUploaded: number;
  /** hearth.documents.id, set once page 1 is inserted. */
  documentId: string | null;
  /** The raw extraction returned by `analyzeCcrAction`. */
  extraction: CcrExtraction | null;
  /** The dedup reason returned by `finalizeCcrUploadAction`. */
  dedupReason: CcrDedupReason | null;
  /** water_system_reports.id once finalize completes. */
  reportId: string | null;
  error: string | null;
};

const INITIAL_STATE: CcrUploadState = {
  phase: "idle",
  pageCount: null,
  pagesUploaded: 0,
  documentId: null,
  extraction: null,
  dedupReason: null,
  reportId: null,
  error: null,
};

export type UseCcrUploadArgs = {
  houseId: string;
  /**
   * PWSID resolved by the WQA module for this house. The hook threads
   * this into `analyzeCcrAction` as the expected PWSID context.
   */
  pwsid: string;
  /** Display name of the utility (from `system_card.pws_name`). */
  utilityName: string | null;
  /**
   * Short paragraph summarizing what Hearth already knows about the
   * utility (system type, source water, population). Used as grounding
   * context in the user prompt. Optional.
   */
  knownSystemContext?: string | null;
};

export type UseCcrUploadResult = {
  state: CcrUploadState;
  /** Drives the full upload pipeline against a single PDF File. */
  upload: (file: File) => Promise<void>;
  reset: () => void;
};

export function useCcrUpload(args: UseCcrUploadArgs): UseCcrUploadResult {
  const [state, setState] = useState<CcrUploadState>(INITIAL_STATE);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    runningRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setState((s) => ({
        ...s,
        phase: "hashing",
        error: null,
      }));

      try {
        // Step 1 — hash the ORIGINAL PDF bytes. This is what makes
        // byte-identical re-upload detection in finalize-ccr-upload
        // work. Per-page JPEG hashes (set on document_pages.content_hash
        // later) are for within-session per-page dedup that doesn't
        // really matter for PDFs but stays consistent with the receipt
        // flow.
        const documentContentHash = await computeContentHash(file);

        setState((s) => ({ ...s, phase: "rendering" }));

        // Step 2 — render every PDF page to JPEG pair.
        const pages = await renderPdfToPages(file);
        if (pages.length === 0) {
          throw new Error("This PDF doesn't appear to have any pages.");
        }
        setState((s) => ({
          ...s,
          phase: "uploading",
          pageCount: pages.length,
        }));

        const supabase = createClient();
        const documentId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : fallbackUuid();

        // Step 3 — upload page 1 + insert parent document row.
        const page1 = pages[0];
        const { optimizedPath, thumbnailPath } = await uploadDocumentFiles({
          supabase,
          houseId: args.houseId,
          documentId,
          optimized: page1.optimized,
          thumbnail: page1.thumbnail,
        });

        const created = await createPendingDocumentAction({
          documentId,
          houseId: args.houseId,
          kind: "water_quality_report",
          storagePath: optimizedPath,
          thumbnailPath,
          contentHash: documentContentHash,
          mimeType: page1.optimized.type || "image/jpeg",
          fileSizeBytes: page1.optimized.size,
          originalFilename: file.name || "ccr.pdf",
          inventoryId: null,
        });
        if (created.error !== null) throw new Error(created.error);

        setState((s) => ({
          ...s,
          documentId,
          pagesUploaded: 1,
        }));

        // Step 4 — upload pages 2+ sequentially. Sequential keeps the
        // page enumeration stable and avoids hitting Supabase storage
        // concurrency limits on a big PDF; CCRs are 4-12 pages so the
        // latency penalty is minor.
        for (let i = 1; i < pages.length; i++) {
          const pageNumber = i + 1;
          const pageData = pages[i];

          // Per-page hash: hash the optimized JPEG bytes. Used only for
          // within-session dedup (which has no real consequence for
          // PDFs); we set it for schema consistency with the receipt
          // flow.
          const pageHash = await computeContentHash(pageData.optimized);

          const uploaded = await uploadDocumentPageFiles({
            supabase,
            houseId: args.houseId,
            documentId,
            pageNumber,
            optimized: pageData.optimized,
            thumbnail: pageData.thumbnail,
          });

          const inserted = await addDocumentPageAction({
            documentId,
            pageNumber,
            storagePath: uploaded.optimizedPath,
            thumbnailPath: uploaded.thumbnailPath,
            contentHash: pageHash,
            mimeType: pageData.optimized.type || "image/jpeg",
            fileSizeBytes: pageData.optimized.size,
            originalFilename: `${file.name || "ccr"}-page-${pageNumber}.jpg`,
          });
          if (inserted.error !== null) throw new Error(inserted.error);

          setState((s) => ({ ...s, pagesUploaded: pageNumber }));
        }

        // Step 5 — analyze.
        setState((s) => ({ ...s, phase: "analyzing" }));
        const analyzed = await analyzeCcrAction({
          documentId,
          pwsid: args.pwsid,
          expectedUtilityName: args.utilityName,
          knownSystemContext: args.knownSystemContext ?? null,
        });
        if (analyzed.error !== null) throw new Error(analyzed.error);

        // Step 6 — finalize (dedup + persist).
        setState((s) => ({
          ...s,
          phase: "finalizing",
          extraction: analyzed.data.extraction,
        }));
        const finalized = await finalizeCcrUploadAction({
          documentId,
        });
        if (finalized.error !== null) throw new Error(finalized.error);

        setState((s) => ({
          ...s,
          phase: "done",
          dedupReason: finalized.data.dedupReason,
          reportId: finalized.data.reportId,
        }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "CCR upload failed";
        setState((s) => ({ ...s, phase: "error", error: message }));
      } finally {
        runningRef.current = false;
      }
    },
    [args.houseId, args.knownSystemContext, args.pwsid, args.utilityName],
  );

  return { state, upload, reset };
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
