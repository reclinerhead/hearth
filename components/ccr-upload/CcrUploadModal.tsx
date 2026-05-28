"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { useCcrUpload, type CcrUploadPhase } from "./use-ccr-upload";
import type { CcrDedupReason } from "@/types/document";

/**
 * Modal for uploading a Consumer Confidence Report (CCR) — the annual
 * Water Quality Report published by every Community Water System.
 * Issue #194 (follow-up to #176, WQA-3).
 *
 * Opened from the "Latest CCR" tile inside the WQA finding modal when
 * `system_card.latest_ccr_status === "not_uploaded"`. The user picks a
 * PDF (the format every utility publishes online); we render it
 * client-side via `pdfjs-dist`, push each page through the existing
 * per-page upload primitives, call `analyzeCcrAction` + `finalizeCcr
 * UploadAction`, and surface a quiet contributor acknowledgment.
 *
 * The modal sits at z-60 so it stacks above the WQA finding modal at
 * z-50. Backdrop click closes only when no upload is in progress
 * (same foot-gun discipline as SmartUploader). ESC closes when idle.
 */

export type CcrUploadModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  houseId: string;
  /** Resolved PWSID for the house's utility. Read off the WQA finding. */
  pwsid: string;
  /** Display utility name (`system_card.pws_name`). Optional, used for
   *  the prompt's grounding context and the acknowledgment copy. */
  utilityName: string | null;
  /** Short paragraph summarizing what Hearth already knows about the
   *  utility. Optional grounding context for the extraction prompt. */
  knownSystemContext?: string | null;
  /**
   * Fired after `finalizeCcrUploadAction` returns successfully — the
   * parent uses this to trigger the dashboard refresh / WQA re-check
   * so the dashboard tile flips to `cws_with_ccr`. The modal stays open
   * until the user dismisses it so the acknowledgment is visible.
   */
  onSuccess?: (result: { reportId: string; dedupReason: CcrDedupReason }) => void;
};

export function CcrUploadModal(props: CcrUploadModalProps) {
  const {
    open,
    onOpenChange,
    houseId,
    pwsid,
    utilityName,
    knownSystemContext,
    onSuccess,
  } = props;

  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { state, upload, reset } = useCcrUpload({
    houseId,
    pwsid,
    utilityName,
    knownSystemContext,
  });

  // Stable refs for the success callback. Same rationale as
  // SmartUploader's onSavedRef — parents pass new arrow identities on
  // every render, and an effect that lists `onSuccess` in its deps would
  // re-fire each time. The success effect below depends only on the
  // pipeline phase transitioning to "done".
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  // Reset hook state whenever the modal opens, so a previous run's
  // success or error doesn't leak into the next session.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const isPending =
    state.phase === "hashing" ||
    state.phase === "rendering" ||
    state.phase === "uploading" ||
    state.phase === "analyzing" ||
    state.phase === "finalizing";

  // ESC closes when no upload is in progress. Backdrop click does the
  // same in the wrapper below.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      // Focus the close button on mount so keyboard users land somewhere
      // sensible. The file-pick affordance gets focus visually via its
      // own layout, not via tabIndex.
      closeButtonRef.current?.focus();
    });
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        e.preventDefault();
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, isPending, onOpenChange]);

  // Fire the success callback exactly once per finalize.
  useEffect(() => {
    if (state.phase === "done" && state.reportId && state.dedupReason) {
      onSuccessRef.current?.({
        reportId: state.reportId,
        dedupReason: state.dedupReason,
      });
    }
  }, [state.phase, state.reportId, state.dedupReason]);

  if (!open) return null;

  function handleClose() {
    if (isPending) return;
    onOpenChange(false);
  }

  function handlePickFile() {
    if (isPending) return;
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still triggers
    // onChange (browsers de-dupe identical selections by default).
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      // We don't bother trying to coerce non-PDFs — the prompt and
      // schema are tuned for the multi-page CCR shape.
      return;
    }
    upload(file);
  }

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-6"
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
        aria-describedby={descriptionId}
        className="surface-ai page-sheet relative w-full sm:max-w-lg sm:h-auto sm:max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">Water Quality Awareness</div>
            <h2 id={titleId} className="h2 mt-0.5">
              {headerTitleForPhase(state.phase)}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="btn btn-ghost btn-icon"
            aria-label="Close CCR upload"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 flex-1">
          {state.phase === "idle" || state.phase === "error" ? (
            <PickStage
              utilityName={utilityName}
              onPickFile={handlePickFile}
              error={state.error}
              descriptionId={descriptionId}
            />
          ) : null}

          {isPending ? (
            <ProgressStage state={state} utilityName={utilityName} />
          ) : null}

          {state.phase === "done" && state.dedupReason ? (
            <SuccessStage
              dedupReason={state.dedupReason}
              utilityName={utilityName}
              reportYear={state.extraction?.report_year ?? null}
              onDone={handleClose}
            />
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={handleFileChange}
          aria-hidden
        />
      </div>
    </div>
  );
}

function headerTitleForPhase(phase: CcrUploadPhase): string {
  switch (phase) {
    case "idle":
      return "Upload your Water Quality Report";
    case "hashing":
    case "rendering":
      return "Preparing your report";
    case "uploading":
      return "Uploading pages";
    case "analyzing":
      return "Reading your report";
    case "finalizing":
      return "Sharing with your neighbors";
    case "done":
      return "Thanks for sharing";
    case "error":
      return "Something went wrong";
  }
}

/* ---------- stages ---------------------------------------------------- */

function PickStage(props: {
  utilityName: string | null;
  onPickFile: () => void;
  error: string | null;
  descriptionId: string;
}) {
  const { utilityName, onPickFile, error, descriptionId } = props;
  const utility = utilityName ?? "your utility";
  return (
    <>
      <p
        id={descriptionId}
        className="text-small"
        style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
      >
        Every Community Water System is required to publish a Consumer
        Confidence Report (CCR) once a year — usually a PDF on the
        utility&rsquo;s website around April or May. Upload {utility}&rsquo;s
        latest report and Hearth will extract the detected contaminants,
        the lead-and-copper distribution, and any free-testing offer. Once
        it&rsquo;s on file, every neighbor on the same utility benefits
        from your contribution.
      </p>

      <button
        type="button"
        onClick={onPickFile}
        className="btn btn-primary w-full justify-center"
        style={{ paddingTop: 12, paddingBottom: 12 }}
      >
        <Icon name="upload" size={16} aria-hidden />
        <span style={{ marginLeft: 8 }}>Pick a PDF</span>
      </button>

      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)", lineHeight: 1.55 }}
      >
        PDFs up to 20 pages, published by your utility within the last
        12 months. Your bytes never leave your browser unprocessed —
        Hearth renders the PDF pages locally, uploads JPEGs, and only the
        extracted structured data (contaminant levels, MCLs, lead/copper
        distribution) gets shared across users on the same utility.
      </p>

      {error ? (
        <div
          role="alert"
          className="text-small rounded-md p-3"
          style={{
            border: "1px solid color-mix(in oklab, var(--color-danger) 35%, transparent)",
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 14%, transparent)",
            color: "var(--color-text-primary)",
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: 4 }}>
            Upload didn&rsquo;t finish
          </div>
          <div style={{ color: "var(--color-text-secondary)" }}>{error}</div>
        </div>
      ) : null}
    </>
  );
}

function ProgressStage(props: {
  state: ReturnType<typeof useCcrUpload>["state"];
  utilityName: string | null;
}) {
  const { state, utilityName } = props;
  const utility = utilityName ?? "your utility";
  const phaseLabel = (() => {
    switch (state.phase) {
      case "hashing":
        return "Hashing the PDF (so we can dedup against existing contributions)…";
      case "rendering":
        return "Rendering each PDF page to an image…";
      case "uploading":
        return state.pageCount
          ? `Uploading page ${state.pagesUploaded} of ${state.pageCount}…`
          : "Uploading pages…";
      case "analyzing":
        return `Reading ${utility}'s report — pulling out the measured contaminants and lead/copper data…`;
      case "finalizing":
        return "Recording your contribution in the shared cache…";
      default:
        return "Working…";
    }
  })();

  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
      >
        {phaseLabel}
      </p>

      {state.phase === "uploading" && state.pageCount ? (
        <div className="flex flex-col gap-1.5">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{
              backgroundColor: "var(--color-bg-base)",
              border: "1px solid var(--color-border-subtle)",
            }}
            aria-hidden
          >
            <div
              className="h-full"
              style={{
                width: `${Math.round((state.pagesUploaded / state.pageCount) * 100)}%`,
                backgroundColor: "var(--color-accent)",
                transition: "width 220ms ease-out",
              }}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <Spinner /> <span>This usually takes 10–20 seconds.</span>
        </div>
      )}
    </div>
  );
}

function SuccessStage(props: {
  dedupReason: CcrDedupReason;
  utilityName: string | null;
  reportYear: number | null;
  onDone: () => void;
}) {
  const { dedupReason, utilityName, reportYear, onDone } = props;
  const utility = utilityName ?? "your utility";
  const yearClause = reportYear ? `${reportYear} ` : "";

  const message = (() => {
    switch (dedupReason) {
      case "first-upload":
        return `You're the first homeowner to contribute ${utility}'s ${yearClause}Water Quality Report. Hearth will use this extraction for every neighbor on the same utility from now on.`;
      case "same-ccr-different-bytes":
        return `Thanks — we already had a ${yearClause}extraction on file from another contributor, and your upload adds to the shared cache. Your finding will refresh with the report's data on your next check.`;
      case "identical-bytes":
        return `Already on file — your bytes matched an existing contribution exactly. Your finding will refresh with the report's data on your next check.`;
    }
  })();

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-md flex items-start gap-3 p-3 sm:p-4"
        style={{
          border: "1px solid color-mix(in oklab, var(--color-success) 35%, transparent)",
          backgroundColor:
            "color-mix(in oklab, var(--color-success) 14%, transparent)",
        }}
      >
        <span
          aria-hidden
          className="shrink-0 mt-0.5"
          style={{ color: "var(--color-success)" }}
        >
          <Icon name="circle-check" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Report shared
          </div>
          <p
            className="text-small mt-1"
            style={{ color: "var(--color-text-secondary)", lineHeight: 1.55, margin: 0 }}
          >
            {message}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="btn btn-primary w-full justify-center"
        style={{ paddingTop: 12, paddingBottom: 12 }}
      >
        Done
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border-2"
      style={{
        borderColor: "color-mix(in oklab, var(--color-accent) 30%, transparent)",
        borderTopColor: "var(--color-accent)",
        animation: "spin 0.8s linear infinite",
      }}
      aria-hidden
    />
  );
}

function CloseIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
