"use client";

/**
 * Stage 4d — Analysis-failed. The pipeline threw somewhere — most
 * commonly the Grok call. Two ways forward: try again (clean up and
 * back to capture) or take a fallback path against the already-stored
 * photo. The fallback's meaning depends on entry point:
 *  - no target → "Enter manually" (open the review form with no AI
 *    extraction; user fills name/type/room by hand).
 *  - target mode → "Save photo anyway" (skip AI, attach the photo to
 *    the known inventory item — the user can keep the photo even when
 *    the model couldn't read the label).
 *
 * The parent passes the secondary action's label + handler; this stage
 * is intentionally label-agnostic so the same component covers both.
 */
export function AnalysisFailedStage({
  message,
  secondaryLabel,
  onTryAgain,
  onSecondaryAction,
}: {
  message: string;
  secondaryLabel: string;
  onTryAgain: () => void;
  onSecondaryAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Something went wrong while reading the photo. You can try again
        or {secondaryLabel.toLowerCase()}.
      </p>
      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {message}
      </p>
      <div className="flex items-center justify-end gap-2 mt-2">
        <button type="button" onClick={onTryAgain} className="btn btn-ghost">
          Retake
        </button>
        <button
          type="button"
          onClick={onSecondaryAction}
          className="btn btn-primary"
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
