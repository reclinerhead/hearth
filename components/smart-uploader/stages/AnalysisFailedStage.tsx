"use client";

/**
 * Stage 4d — Analysis-failed. The pipeline threw somewhere — most
 * commonly the Grok call. Two ways forward: try again (clean up and
 * back to capture) or enter the details by hand against the
 * already-stored photo.
 */
export function AnalysisFailedStage({
  message,
  onTryAgain,
  onEnterManually,
}: {
  message: string;
  onTryAgain: () => void;
  onEnterManually: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Something went wrong while reading the photo. You can try again
        or enter details manually.
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
          onClick={onEnterManually}
          className="btn btn-primary"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}
