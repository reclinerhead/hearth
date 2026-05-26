"use client";

import { Icon } from "@/components/icon";

/**
 * Stage 4 of the emergency-procedure-video flow (issue #139). The hook
 * is running processVideo; we render a spinner with a "this can take a
 * minute" reassurance. On error the parent shows the error message
 * and lets the user retake.
 */
export function EmergencyCompressStage({
  error,
  onRetake,
  onCancel,
}: {
  error: string | null;
  onRetake: () => void;
  onCancel: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-warning) 18%, transparent)",
            color: "var(--color-warning)",
          }}
          aria-hidden
        >
          <Icon name="alert-triangle" size={22} />
        </span>
        <p style={{ fontSize: 16, fontWeight: 500 }}>
          We couldn&apos;t process that video
        </p>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", maxWidth: 320 }}
        >
          {error}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onRetake} className="btn btn-primary">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-3 py-8">
      <span
        className="relative flex h-14 w-14 items-center justify-center"
        aria-hidden
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            border: "3px solid var(--color-border-subtle)",
            borderTopColor: "var(--color-accent)",
            animation: "spin 0.9s linear infinite",
          }}
        />
      </span>
      <p style={{ fontSize: 16, fontWeight: 500 }}>Optimizing your video…</p>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", maxWidth: 320 }}
      >
        We&apos;re compressing the clip and grabbing a thumbnail so it
        plays back fast later. This usually takes a few seconds.
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
