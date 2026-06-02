"use client";

import { useCallback, useRef, useState } from "react";
import { addDocumentPageAction } from "@/app/actions/documents/add-document-page";
import { analyzeReceiptAction } from "@/app/actions/documents/analyze-receipt";
import { checkDocumentDuplicateAction } from "@/app/actions/documents/check-duplicate";
import { createPendingDocumentAction } from "@/app/actions/documents/create-pending";
import { deleteDocumentPageAction } from "@/app/actions/documents/delete-document-page";
import {
  findInventoryByReceiptAction,
  type FindInventoryByReceiptResult,
} from "@/app/actions/documents/find-inventory-by-receipt";
import { computeContentHash } from "@/lib/documents/content-hash";
import { processImage } from "@/lib/documents/process-image";
import {
  uploadDocumentFiles,
  uploadDocumentPageFiles,
} from "@/lib/documents/upload";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow, ReceiptExtraction } from "@/types/document";

/**
 * The orchestration hook for the multi-page receipt path of the Smart
 * Uploader (issue #117).
 *
 * Distinct from useDocumentUpload because the receipt flow is
 * incremental — the user adds pages one at a time, then explicitly
 * triggers extraction. Trying to overload the single-photo hook with
 * an array shape would tangle the two state machines beyond what's
 * easy to reason about.
 *
 * Pipeline per added page:
 *   - hash → resize → upload (parallel optimized + thumb) → row insert
 *   - Page 1 creates the hearth.documents row with kind='receipt'.
 *   - Pages 2+ insert into hearth.document_pages.
 *
 * Finalize:
 *   - analyzeReceiptAction reads every page's signed URL and runs the
 *     receipt-shaped generateObject call once, persisting metadata.
 *   - When no targetInventoryId: also call findInventoryByReceiptAction
 *     so the review stage can offer strong-match attach.
 */

export type ReceiptUploadPhase =
  | "idle"
  | "adding-page"
  | "duplicate"
  | "processing"
  | "saving"
  | "done"
  | "error";

export type ReceiptPage = {
  pageNumber: number;
  /** Object URL of the original file for review-strip preview. */
  previewUrl: string;
  /** SHA-256 of the pre-resize bytes — for client-side dedup. */
  contentHash: string;
};

export type ReceiptUploadState = {
  phase: ReceiptUploadPhase;
  /** hearth.documents.id, set once page 1 is uploaded. */
  documentId: string | null;
  pages: ReceiptPage[];
  extraction: ReceiptExtraction | null;
  matches: FindInventoryByReceiptResult | null;
  /**
   * Set when page 1 is a byte-identical re-upload of a document already
   * in this house. The Smart Uploader surfaces the shared DuplicateStage
   * and no new row or storage object is created. Only the page-1 branch
   * can populate this — pages 2+ aren't under the house-scoped unique
   * index.
   */
  duplicate: DocumentRow | null;
  error: string | null;
};

const INITIAL_STATE: ReceiptUploadState = {
  phase: "idle",
  documentId: null,
  pages: [],
  extraction: null,
  matches: null,
  duplicate: null,
  error: null,
};

export type UseReceiptUploadArgs = {
  houseId: string;
  /** When set, the receipt is born already attached to this inventory item. */
  targetInventoryId?: string;
};

export type UseReceiptUploadResult = {
  state: ReceiptUploadState;
  addPage: (file: File) => Promise<void>;
  removePage: (pageNumber: number) => Promise<void>;
  finalize: () => Promise<void>;
  reset: () => void;
};

// 5-page cap chosen during issue review (raised from 3-page lean).
// Real-world receipts almost always fit; the cap keeps the Grok call
// cost-predictable and the review-stage thumbnail strip readable.
export const RECEIPT_MAX_PAGES = 5;

export function useReceiptUpload(
  args: UseReceiptUploadArgs,
): UseReceiptUploadResult {
  const [state, setState] = useState<ReceiptUploadState>(INITIAL_STATE);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    runningRef.current = false;
    // Revoke any object URLs we created for preview thumbnails.
    setState((prev) => {
      for (const p of prev.pages) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      return INITIAL_STATE;
    });
  }, []);

  const addPage = useCallback(
    async (file: File) => {
      if (runningRef.current) return;
      runningRef.current = true;
      const previewUrl = URL.createObjectURL(file);
      setState((s) => ({ ...s, phase: "adding-page", error: null }));

      try {
        const contentHash = await computeContentHash(file);

        // Client-side dedup within this in-progress receipt — catches
        // a user re-photographing the same page twice. Cross-document
        // dedup isn't enforced server-side for pages, by design.
        const dupPage = state.pages.find((p) => p.contentHash === contentHash);
        if (dupPage) {
          URL.revokeObjectURL(previewUrl);
          throw new Error(
            `Page ${dupPage.pageNumber} is already in this receipt — pick a different photo or retake that page.`,
          );
        }

        // Page 1 only: cross-document, house-scoped duplicate pre-check —
        // the same guard the photo path runs (use-document-upload.ts). A
        // byte-identical re-upload short-circuits to the duplicate stage
        // before we touch storage or insert, instead of tripping the
        // documents_house_id_content_hash_unique index and surfacing a
        // raw Postgres error in the UI. Pages 2+ aren't under that index
        // (they live in hearth.document_pages and use content_hash for
        // in-session dedup only), so we guard page 1 exclusively.
        if (state.pages.length === 0) {
          const dupCheck = await checkDocumentDuplicateAction({
            houseId: args.houseId,
            contentHash,
          });
          if (dupCheck.error !== null) throw new Error(dupCheck.error);
          if (dupCheck.data.exists) {
            URL.revokeObjectURL(previewUrl);
            setState((s) => ({
              ...s,
              phase: "duplicate",
              duplicate: dupCheck.data.existingDocument,
              error: null,
            }));
            return;
          }
        }

        const { optimized, thumbnail } = await processImage(file);
        const supabase = createClient();

        if (state.pages.length === 0) {
          // Page 1 path: create the parent document row alongside the
          // upload. The documentId is generated client-side so we can
          // upload to storage before the server round-trip — same
          // upload-then-insert ordering as the photo flow.
          const documentId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : fallbackUuid();

          const { optimizedPath, thumbnailPath } = await uploadDocumentFiles({
            supabase,
            houseId: args.houseId,
            documentId,
            optimized,
            thumbnail,
          });

          const created = await createPendingDocumentAction({
            documentId,
            houseId: args.houseId,
            kind: "receipt",
            storagePath: optimizedPath,
            thumbnailPath,
            contentHash,
            mimeType: optimized.type || "image/jpeg",
            fileSizeBytes: optimized.size,
            originalFilename: file.name || "receipt-page-1.jpg",
            inventoryId: args.targetInventoryId ?? null,
          });
          if (created.error !== null) throw new Error(created.error);

          setState((s) => ({
            ...s,
            phase: "idle",
            documentId,
            pages: [{ pageNumber: 1, previewUrl, contentHash }],
            error: null,
          }));
          return;
        }

        // Page 2+: insert into hearth.document_pages.
        const documentId = state.documentId;
        if (!documentId) {
          throw new Error(
            "Receipt session is missing the parent document id — try retaking page 1.",
          );
        }
        const pageNumber = state.pages.length + 1;

        const { optimizedPath, thumbnailPath } =
          await uploadDocumentPageFiles({
            supabase,
            houseId: args.houseId,
            documentId,
            pageNumber,
            optimized,
            thumbnail,
          });

        const inserted = await addDocumentPageAction({
          documentId,
          pageNumber,
          storagePath: optimizedPath,
          thumbnailPath,
          contentHash,
          mimeType: optimized.type || "image/jpeg",
          fileSizeBytes: optimized.size,
          originalFilename: file.name || `receipt-page-${pageNumber}.jpg`,
        });
        if (inserted.error !== null) throw new Error(inserted.error);

        setState((s) => ({
          ...s,
          phase: "idle",
          pages: [...s.pages, { pageNumber, previewUrl, contentHash }],
          error: null,
        }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to add page";
        URL.revokeObjectURL(previewUrl);
        setState((s) => ({ ...s, phase: "error", error: message }));
      } finally {
        runningRef.current = false;
      }
    },
    [args.houseId, args.targetInventoryId, state.pages, state.documentId],
  );

  const removePage = useCallback(
    async (pageNumber: number) => {
      if (runningRef.current) return;
      const documentId = state.documentId;
      if (!documentId) return;
      // Page 1 cannot be removed on its own — the parent document row
      // would still exist with a missing primary image. The capture
      // stage's UI surfaces "Cancel and start over" instead, which
      // routes through the modal's normal close-with-cleanup path.
      if (pageNumber === 1) return;
      runningRef.current = true;
      try {
        const result = await deleteDocumentPageAction({
          documentId,
          pageNumber,
        });
        if (result.error !== null) throw new Error(result.error);
        setState((s) => {
          const removed = s.pages.find((p) => p.pageNumber === pageNumber);
          if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
          // Renumber later pages so we never end up with a gap (page 4
          // existing without a page 3). The server-side renumber is the
          // second pass below.
          const next = s.pages
            .filter((p) => p.pageNumber !== pageNumber)
            .sort((a, b) => a.pageNumber - b.pageNumber)
            .map((p, i) => ({ ...p, pageNumber: i + 1 }));
          return { ...s, pages: next };
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to remove page";
        setState((s) => ({ ...s, phase: "error", error: message }));
      } finally {
        runningRef.current = false;
      }
    },
    [state.documentId],
  );

  const finalize = useCallback(async () => {
    if (runningRef.current) return;
    if (!state.documentId) return;
    if (state.pages.length === 0) return;
    runningRef.current = true;
    setState((s) => ({ ...s, phase: "processing", error: null }));
    try {
      const analyzed = await analyzeReceiptAction({
        documentId: state.documentId,
      });
      if (analyzed.error !== null) throw new Error(analyzed.error);
      const extraction = analyzed.data.ai_extraction;
      if (!extraction || extraction.mode !== "receipt") {
        throw new Error("Analysis did not return a receipt extraction");
      }

      // In target mode the inventory item is already known — skip the
      // matcher round-trip entirely. The Smart Uploader will surface
      // the review stage with the chosen item pre-locked.
      let matches: FindInventoryByReceiptResult = {
        strong_match: null,
        suggested_matches: [],
      };
      if (!args.targetInventoryId) {
        const matchResult = await findInventoryByReceiptAction({
          houseId: args.houseId,
          referencedSerials: extraction.referenced_serials,
          referencedModelNumbers: extraction.referenced_model_numbers,
        });
        if (matchResult.error !== null) throw new Error(matchResult.error);
        matches = matchResult.data;
      }

      setState((s) => ({
        ...s,
        phase: "done",
        extraction,
        matches,
        error: null,
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze receipt";
      setState((s) => ({ ...s, phase: "error", error: message }));
    } finally {
      runningRef.current = false;
    }
  }, [
    args.houseId,
    args.targetInventoryId,
    state.documentId,
    state.pages.length,
  ]);

  return { state, addPage, removePage, finalize, reset };
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
