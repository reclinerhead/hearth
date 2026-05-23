"use client";

import { useCallback, useRef, useState } from "react";
import { analyzeNameplateAction } from "@/app/actions/documents/analyze-nameplate";
import { attachDocumentToInventoryAction } from "@/app/actions/documents/attach-document-to-inventory";
import { checkDocumentDuplicateAction } from "@/app/actions/documents/check-duplicate";
import { createPendingDocumentAction } from "@/app/actions/documents/create-pending";
import {
  findMatchingInventoryAction,
  type MatchingInventoryItem,
} from "@/app/actions/documents/find-matching-inventory";
import { computeContentHash } from "@/lib/documents/content-hash";
import { processImage } from "@/lib/documents/process-image";
import { uploadDocumentFiles } from "@/lib/documents/upload";
import { createClient } from "@/lib/supabase/client";
import type { AiExtraction, DocumentRow } from "@/types/document";

/**
 * The orchestration hook for the Smart Uploader.
 *
 * Owns the client-side pipeline: hash → dedup check → resize → upload →
 * pending-row insert → analyze → (match | attach). Subtle ordering
 * matters and is enforced here:
 *  - hash before resize, so a byte-identical re-upload short-circuits
 *    before we touch storage at all
 *  - resize before upload, so we never push the original uncompressed
 *    bytes through the network
 *  - upload before row insert, so the row never references storage
 *    objects that don't exist
 *  - row insert before analyze, so the row can absorb the AI write
 *
 * The post-analyze fork depends on `targetInventoryId`:
 *  - no target → match-existing-inventory → "done" (modal opens the
 *    review-new stage so the user can pick "Save new" or "Add to X").
 *  - target → attach-to-target → "attached" (modal goes straight to
 *    the success stage, no review form). The inventory item is known
 *    from the entry-point context, so matching adds zero value here.
 *
 * The hook owns no cleanup logic — if the user retakes or cancels,
 * the modal calls cleanupDocumentAction directly with the document id
 * exposed in state. That keeps the hook focused on the forward path
 * and frees the modal to decide cleanup semantics per stage.
 */

export type DocumentUploadPhase =
  | "idle"
  | "hashing"
  | "uploading"
  | "creating-row"
  | "analyzing"
  | "matching"
  | "attaching"
  | "attached"
  | "done"
  | "error";

export type DocumentUploadState = {
  phase: DocumentUploadPhase;
  documentId: string | null;
  analysis: AiExtraction | null;
  matches: MatchingInventoryItem[] | null;
  duplicate: DocumentRow | null;
  error: string | null;
};

const INITIAL_STATE: DocumentUploadState = {
  phase: "idle",
  documentId: null,
  analysis: null,
  matches: null,
  duplicate: null,
  error: null,
};

export type UseDocumentUploadArgs = {
  houseId: string;
  /**
   * When set, the Smart Uploader runs in *target mode*: the document
   * row is created already attached to this inventory item, the
   * match-existing-inventory phase is skipped entirely (the user has
   * already told us which item this photo belongs to), and a successful
   * analyze flows straight to "attached" (the modal renders the success
   * stage with no user confirmation form). Used by the Add-photo button
   * on /inventory/[id].
   */
  targetInventoryId?: string;
};

export type UseDocumentUploadResult = {
  state: DocumentUploadState;
  start: (file: File) => Promise<void>;
  reset: () => void;
};

export function useDocumentUpload(
  args: UseDocumentUploadArgs,
): UseDocumentUploadResult {
  const [state, setState] = useState<DocumentUploadState>(INITIAL_STATE);
  // Guards against double-fire from React strict-mode effects or a fast
  // double-click on "Analyze". `start` is async and we don't want two
  // pipelines racing on the same File.
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    runningRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const start = useCallback(
    async (file: File) => {
      if (runningRef.current) return;
      runningRef.current = true;

      // Same uuid becomes the row PK *and* the storage directory segment.
      // Generating it here means we can upload to storage before any
      // server round-trip — which is how the upload-then-insert ordering
      // works without ever orphaning bytes against a row that doesn't
      // exist yet.
      const documentId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : fallbackUuid();

      setState({
        phase: "hashing",
        documentId,
        analysis: null,
        matches: null,
        duplicate: null,
        error: null,
      });

      try {
        const contentHash = await computeContentHash(file);

        const dupCheck = await checkDocumentDuplicateAction({
          houseId: args.houseId,
          contentHash,
        });
        if (dupCheck.error !== null) throw new Error(dupCheck.error);
        if (dupCheck.data.exists) {
          setState({
            phase: "done",
            documentId,
            analysis: null,
            matches: null,
            duplicate: dupCheck.data.existingDocument,
            error: null,
          });
          return;
        }

        setState((s) => ({ ...s, phase: "uploading" }));

        const { optimized, thumbnail } = await processImage(file);
        const supabase = createClient();
        const { optimizedPath, thumbnailPath } = await uploadDocumentFiles({
          supabase,
          houseId: args.houseId,
          documentId,
          optimized,
          thumbnail,
        });

        setState((s) => ({ ...s, phase: "creating-row" }));

        // Kind tracks what the user is actually uploading. In target
        // mode they're adding an additional photo of a known item —
        // never a nameplate — so write 'photo' directly and skip the
        // analysis-then-demote dance. In discovery mode we still write
        // 'nameplate' optimistically and let analyze demote on
        // appliance_photo classification.
        const targetMode = Boolean(args.targetInventoryId);
        const created = await createPendingDocumentAction({
          documentId,
          houseId: args.houseId,
          kind: targetMode ? "photo" : "nameplate",
          storagePath: optimizedPath,
          thumbnailPath,
          contentHash,
          mimeType: optimized.type || "image/jpeg",
          fileSizeBytes: optimized.size,
          originalFilename: file.name || "photo.jpg",
          inventoryId: args.targetInventoryId ?? null,
        });
        if (created.error !== null) throw new Error(created.error);

        // Target mode short-circuit (load-bearing — see issue #23
        // follow-up). The user opened the Smart Uploader from
        // /inventory/[id], so they've already told us which item this
        // photo belongs to. Running the Grok vision classify call
        // here would burn ~30-45s of latency + Gateway credits for
        // zero user benefit, and would route legitimate non-appliance
        // photos (a car body, a pet) into the "couldn't identify"
        // failure stage when they should just attach cleanly.
        //
        // Skip analysis entirely: just flip status from analyzing →
        // attached and resolve to the terminal "attached" phase. The
        // modal jumps straight to the success stage.
        if (targetMode && args.targetInventoryId) {
          setState((s) => ({ ...s, phase: "attaching" }));
          const attached = await attachDocumentToInventoryAction({
            documentId,
            inventoryId: args.targetInventoryId,
          });
          if (attached.error !== null) throw new Error(attached.error);
          setState({
            phase: "attached",
            documentId,
            analysis: null,
            matches: null,
            duplicate: null,
            error: null,
          });
          return;
        }

        setState((s) => ({ ...s, phase: "analyzing" }));

        const analyzed = await analyzeNameplateAction({ documentId });
        if (analyzed.error || !analyzed.data) {
          throw new Error(
            analyzed.error ?? "Analysis did not return a document",
          );
        }
        const aiExtraction = analyzed.data.ai_extraction;
        if (!aiExtraction) {
          throw new Error("Analysis returned no extraction");
        }

        // not_useful and delta both short-circuit matching. Delta only
        // ever fires from a future inventory-detail "compare this new
        // photo to the existing record" entry that hasn't shipped; the
        // typecheck still wants us to handle every branch here.
        if (
          aiExtraction.mode === "classification" &&
          aiExtraction.photo_kind === "not_useful"
        ) {
          setState({
            phase: "done",
            documentId,
            analysis: aiExtraction,
            matches: null,
            duplicate: null,
            error: null,
          });
          return;
        }

        if (aiExtraction.mode === "delta") {
          setState({
            phase: "done",
            documentId,
            analysis: aiExtraction,
            matches: null,
            duplicate: null,
            error: null,
          });
          return;
        }

        // Defensive narrow: this hook never analyzes receipts (receipts
        // go through useReceiptUpload + analyzeReceiptAction). If the
        // union ever grows another non-classification mode, this guard
        // keeps the type system honest and surfaces the gap explicitly
        // rather than dereferencing classification on a row that has
        // none.
        if (aiExtraction.mode !== "classification") return;

        setState((s) => ({ ...s, phase: "matching", analysis: aiExtraction }));

        const matchName = aiExtraction.classification.name;
        const matchType = aiExtraction.classification.type;
        const matches = await findMatchingInventoryAction({
          houseId: args.houseId,
          inventoryName: matchName,
          inventoryType: matchType,
        });
        if (matches.error !== null) throw new Error(matches.error);

        setState({
          phase: "done",
          documentId,
          analysis: aiExtraction,
          matches: matches.data,
          duplicate: null,
          error: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        setState((prev) => ({
          ...prev,
          phase: "error",
          documentId: prev.documentId ?? documentId,
          error: message,
        }));
      } finally {
        runningRef.current = false;
      }
    },
    [args.houseId, args.targetInventoryId],
  );

  return { state, start, reset };
}

function fallbackUuid(): string {
  // crypto.randomUUID is available on every browser this app targets.
  // The fallback exists only so the type checker is happy in
  // environments where the global isn't visible (SSR type-narrowing).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
