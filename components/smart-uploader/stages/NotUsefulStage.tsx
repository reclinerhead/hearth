"use client";

/**
 * Stage 4c — Not-useful. The AI flagged the photo as not depicting an
 * appliance. Both buttons clean up the document; only the action
 * label differs.
 */
export function NotUsefulStage({
  onTryDifferent,
  onCancel,
}: {
  onTryDifferent: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        We couldn&apos;t identify a home appliance or system in this photo.
        Want to try another?
      </p>
      <div className="flex items-center justify-end gap-2 mt-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button
          type="button"
          onClick={onTryDifferent}
          className="btn btn-primary"
        >
          Try a different photo
        </button>
      </div>
    </div>
  );
}
