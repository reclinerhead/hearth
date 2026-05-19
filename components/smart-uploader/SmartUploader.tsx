"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cleanupDocumentAction } from "@/app/actions/documents/cleanup-document";
import type { MatchingInventoryItem } from "@/app/actions/documents/find-matching-inventory";
import { createClient } from "@/lib/supabase/client";
import type {
  AppliancePhotoExtraction,
  DocumentRow,
  NameplateExtraction,
} from "@/types/document";
import { useDocumentUpload } from "./hooks/use-document-upload";
import { AnalysisFailedStage } from "./stages/AnalysisFailedStage";
import { CaptureStage } from "./stages/CaptureStage";
import { DuplicateStage } from "./stages/DuplicateStage";
import { NotUsefulStage } from "./stages/NotUsefulStage";
import { PathPickerStage } from "./stages/PathPickerStage";
import { ProcessingStage } from "./stages/ProcessingStage";
import {
  ReviewNewStage,
  type SeededRoomOption,
} from "./stages/ReviewNewStage";

/**
 * Smart Uploader — top-level modal for the photo-capture flow. Owns
 * the stage state machine. The upload pipeline itself lives in
 * useDocumentUpload; this component subscribes to that hook's state
 * and decides what the user sees at each step.
 *
 * Modal mechanics (scroll-lock, focus trap, ESC, backdrop close,
 * return focus) match EditHomeDetailsModal. Once a third modal lands
 * we'll pull a shared base out of the three.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const SUCCESS_DISMISS_MS = 600;

export type SmartUploaderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  houseId: string;
  /**
   * Plumbed for future entry points (an inventory-detail "Add another
   * photo" button). In phase 1.4 the navbar entry point never sets
   * this — the modal always runs in "no target" mode.
   */
  targetInventoryId?: string;
  /**
   * Fires after a successful save (create-from-document or
   * attach-to-existing). The parent uses this to trigger the
   * dashboard refresh — Smart Uploader doesn't know which refresh
   * pattern the host page wants.
   */
  onSaved?: (result: { inventoryId: string }) => void;
};

type Stage =
  | { name: "path-picker" }
  | { name: "capture"; path: "photo"; file: File | null; previewUrl: string | null }
  | { name: "processing" }
  | { name: "duplicate"; existingDocument: DocumentRow }
  | {
      name: "review-new";
      documentId: string;
      analysis: NameplateExtraction | AppliancePhotoExtraction;
      matches: MatchingInventoryItem[];
    }
  | { name: "manual-entry"; documentId: string }
  | { name: "not-useful"; documentId: string }
  | { name: "analysis-failed"; documentId: string | null; message: string }
  | { name: "success" };

export function SmartUploader(props: SmartUploaderProps) {
  const { open, onOpenChange, houseId, targetInventoryId, onSaved } = props;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const [stage, setStage] = useState<Stage>({ name: "path-picker" });
  const [rooms, setRooms] = useState<SeededRoomOption[] | null>(null);

  const { state: uploadState, start, reset: resetUpload } =
    useDocumentUpload({ houseId, targetInventoryId });

  // Reset everything when the modal opens. Keeping state between opens
  // would let a half-finished previous flow leak in — the upload hook
  // has its own `runningRef` too, so this is also the moment to clear
  // any stale state on the hook. The setState here is the legitimate
  // "synchronize with external trigger" use of useEffect (the trigger
  // is the `open` prop, owned by a parent), so we silence the rule.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStage({ name: "path-picker" });
      resetUpload();
    }
  }, [open, resetUpload]);

  // Fetch rooms once per open. Server-side via the browser client is
  // fine here — RLS scopes the read to houses the user owns, and the
  // list is small enough that we don't need pagination.
  useEffect(() => {
    if (!open || rooms !== null) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name")
        .eq("house_id", houseId)
        .order("sort_order");
      if (cancelled) return;
      if (error || !data) {
        // Surface as a soft fallback rather than blocking the flow; the
        // review dropdown will be empty but the save still works if
        // the user can pick an existing inventory item.
        setRooms([]);
        return;
      }
      setRooms(data as SeededRoomOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rooms, houseId]);

  // Drive stage transitions off the hook's state. The state machine in
  // this component owns the *user-facing* stages; the hook owns the
  // pipeline mechanics. We translate one into the other here. The hook
  // is the external system (it controls its own state internally via
  // useState + useRef), so an effect that mirrors its terminal phases
  // into the user-facing stage is the legitimate "synchronize with
  // external system" pattern useEffect+setState exists for.
  useEffect(() => {
    if (uploadState.phase === "done") {
      if (uploadState.duplicate) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStage({
          name: "duplicate",
          existingDocument: uploadState.duplicate,
        });
        return;
      }
      const analysis = uploadState.analysis;
      if (!analysis || !uploadState.documentId) return;
      if (analysis.mode === "delta") return; // not reachable from navbar entry
      if (analysis.photo_kind === "not_useful") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStage({ name: "not-useful", documentId: uploadState.documentId });
        return;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStage({
        name: "review-new",
        documentId: uploadState.documentId,
        analysis,
        matches: uploadState.matches ?? [],
      });
    } else if (uploadState.phase === "error") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStage({
        name: "analysis-failed",
        documentId: uploadState.documentId,
        message:
          uploadState.error ?? "Something went wrong analyzing this photo.",
      });
    }
  }, [
    uploadState.phase,
    uploadState.duplicate,
    uploadState.analysis,
    uploadState.documentId,
    uploadState.matches,
    uploadState.error,
  ]);

  // Track the latest document id and stage so the close path can decide
  // whether to clean up before unmount without re-renders.
  const cleanupRef = useRef<{ documentId: string | null; stage: Stage["name"] }>({
    documentId: null,
    stage: "path-picker",
  });
  useEffect(() => {
    cleanupRef.current = {
      documentId: stageDocumentId(stage) ?? uploadState.documentId,
      stage: stage.name,
    };
  }, [stage, uploadState.documentId]);

  const cleanupCurrentDocument = useCallback(async () => {
    const docId = cleanupRef.current.documentId;
    if (!docId) return;
    // Fire-and-forget — the user has already moved on. A failure here
    // leaves orphaned bytes that get cleaned up later by a sweep job.
    void cleanupDocumentAction({ documentId: docId });
  }, []);

  // Close handler factors in stage: if the user closes mid-flow we
  // clean up the in-flight document; if they close from a stage where
  // the row is already attached or never existed, we don't.
  const handleClose = useCallback(() => {
    const currentStage = cleanupRef.current.stage;
    const cleanupStages: Stage["name"][] = [
      "review-new",
      "manual-entry",
      "not-useful",
      "analysis-failed",
      "duplicate",
    ];
    // duplicate is a special case — we did create the dup row check but
    // never inserted a new row, so there's nothing of ours to clean up.
    if (cleanupStages.includes(currentStage) && currentStage !== "duplicate") {
      void cleanupCurrentDocument();
    }
    onOpenChange(false);
  }, [cleanupCurrentDocument, onOpenChange]);

  // Capture-stage preview URL needs cleanup on unmount or replacement.
  useEffect(() => {
    return () => {
      if (stage.name === "capture" && stage.previewUrl) {
        URL.revokeObjectURL(stage.previewUrl);
      }
    };
  }, [stage]);

  // Modal mechanics: scroll-lock, focus trap, ESC.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (
          e.shiftKey &&
          (active === first || !dialogRef.current.contains(active))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
    };
  }, [open, handleClose]);

  if (!open) return null;

  function selectPhotoFile(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setStage({ name: "capture", path: "photo", file, previewUrl });
  }

  function retakeFromCapture() {
    setStage((prev) => {
      if (prev.name === "capture" && prev.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return { name: "capture", path: "photo", file: null, previewUrl: null };
    });
  }

  async function startAnalysisFromCapture(file: File) {
    setStage({ name: "processing" });
    await start(file);
  }

  async function tryAgainFromAnalysisFailed() {
    if (stage.name !== "analysis-failed") return;
    if (stage.documentId) await cleanupDocumentAction({ documentId: stage.documentId });
    resetUpload();
    setStage({ name: "capture", path: "photo", file: null, previewUrl: null });
  }

  async function enterManuallyFromAnalysisFailed() {
    if (stage.name !== "analysis-failed") return;
    if (!stage.documentId) {
      // No document was ever created (very early failure) — just close.
      onOpenChange(false);
      return;
    }
    setStage({ name: "manual-entry", documentId: stage.documentId });
  }

  async function tryDifferentFromNotUseful() {
    if (stage.name !== "not-useful") return;
    await cleanupDocumentAction({ documentId: stage.documentId });
    resetUpload();
    setStage({ name: "capture", path: "photo", file: null, previewUrl: null });
  }

  async function cancelFromNotUseful() {
    if (stage.name !== "not-useful") return;
    await cleanupDocumentAction({ documentId: stage.documentId });
    onOpenChange(false);
  }

  function handleSaved(inventoryId: string) {
    onSaved?.({ inventoryId });
    setStage({ name: "success" });
    // Brief "Saved!" confirmation, then close.
    setTimeout(() => {
      onOpenChange(false);
    }, SUCCESS_DISMISS_MS);
  }

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface-ai relative w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[92dvh] flex flex-col overflow-hidden"
        style={{
          borderRadius: "var(--radius-lg)",
        }}
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">Add to Hearth</div>
            <h2 id={titleId} className="h2 mt-0.5">
              {headerTitleForStage(stage)}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            className="btn btn-ghost btn-icon"
            aria-label="Close Smart Uploader"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 flex-1">
          {stage.name === "path-picker" ? (
            <PathPickerStage
              onPickPhoto={() =>
                setStage({
                  name: "capture",
                  path: "photo",
                  file: null,
                  previewUrl: null,
                })
              }
            />
          ) : null}

          {stage.name === "capture" ? (
            <CaptureStage
              file={stage.file}
              previewUrl={stage.previewUrl}
              onPickFile={selectPhotoFile}
              onRetake={retakeFromCapture}
              onBack={() => setStage({ name: "path-picker" })}
              onAnalyze={() => stage.file && startAnalysisFromCapture(stage.file)}
            />
          ) : null}

          {stage.name === "processing" ? (
            <ProcessingStage phase={uploadState.phase} />
          ) : null}

          {stage.name === "duplicate" ? (
            <DuplicateStage
              existingDocument={stage.existingDocument}
              onClose={() => onOpenChange(false)}
            />
          ) : null}

          {stage.name === "review-new" ? (
            <ReviewNewStage
              documentId={stage.documentId}
              analysis={stage.analysis}
              matches={stage.matches}
              rooms={rooms ?? []}
              onSaved={handleSaved}
              onCancel={handleClose}
            />
          ) : null}

          {stage.name === "manual-entry" ? (
            <ReviewNewStage
              documentId={stage.documentId}
              analysis={null}
              matches={[]}
              rooms={rooms ?? []}
              onSaved={handleSaved}
              onCancel={handleClose}
            />
          ) : null}

          {stage.name === "not-useful" ? (
            <NotUsefulStage
              onTryDifferent={tryDifferentFromNotUseful}
              onCancel={cancelFromNotUseful}
            />
          ) : null}

          {stage.name === "analysis-failed" ? (
            <AnalysisFailedStage
              message={stage.message}
              onTryAgain={tryAgainFromAnalysisFailed}
              onEnterManually={enterManuallyFromAnalysisFailed}
            />
          ) : null}

          {stage.name === "success" ? <SuccessStage /> : null}
        </div>
      </div>
    </div>
  );
}

function headerTitleForStage(stage: Stage): string {
  switch (stage.name) {
    case "path-picker":
      return "What are you adding?";
    case "capture":
      return "Photo of an appliance or system";
    case "processing":
      return "Working on it…";
    case "duplicate":
      return "Already in your library";
    case "review-new":
      return "Review and save";
    case "manual-entry":
      return "Enter details";
    case "not-useful":
      return "Couldn't identify";
    case "analysis-failed":
      return "Something went wrong";
    case "success":
      return "Saved";
  }
}

function stageDocumentId(stage: Stage): string | null {
  switch (stage.name) {
    case "review-new":
    case "manual-entry":
    case "not-useful":
      return stage.documentId;
    case "analysis-failed":
      return stage.documentId;
    default:
      return null;
  }
}

function SuccessStage() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 gap-3">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-success, #4caf50) 22%, transparent)",
          color: "var(--color-success, #4caf50)",
        }}
        aria-hidden
      >
        <CheckIcon />
      </span>
      <p style={{ fontSize: 16, fontWeight: 500 }}>Saved!</p>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
