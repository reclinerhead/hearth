"use client";

import { Icon } from "@/components/icon";
import type { DocumentUploadPhase } from "../hooks/use-document-upload";

/**
 * Stage 3 — Processing. Single spinner with phase-specific copy. Each
 * sub-phase gets its own status string so the user has a sense of
 * progress even though the whole pipeline is a single async chain
 * from their POV. No progress bar — we have no meaningful percentages.
 */
export function ProcessingStage({ phase }: { phase: DocumentUploadPhase }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 gap-4">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          color: "var(--color-accent)",
        }}
        aria-hidden
      >
        <span className="animate-spin inline-flex">
          <Icon name="refresh-cw" size={22} />
        </span>
      </span>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
        role="status"
        aria-live="polite"
      >
        {phaseCopy(phase)}
      </p>
    </div>
  );
}

function phaseCopy(phase: DocumentUploadPhase): string {
  switch (phase) {
    case "hashing":
      return "Checking your photo…";
    case "uploading":
      return "Uploading…";
    case "creating-row":
    case "matching":
      return "Almost there…";
    case "analyzing":
      return "Analyzing your photo…";
    case "idle":
    case "done":
    case "error":
      return "Working on it…";
  }
}
