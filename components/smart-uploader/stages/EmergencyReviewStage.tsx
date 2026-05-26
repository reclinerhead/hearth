"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { VideoPlayer } from "@/components/video-player";
import {
  formatVideoDuration,
  getEmergencyCategoryMeta,
} from "@/lib/documents/emergency-categories";
import type { EmergencyCategory } from "@/types/document";

const NOTES_SOFT_LIMIT = 2000;

/**
 * Stage 5 of the emergency-procedure-video flow (issue #139). Plays
 * the just-compressed video, lets the user add optional notes, and
 * surfaces Save / Retake. Save kicks off the upload + row insert in
 * the orchestrating hook.
 */
export function EmergencyReviewStage({
  category,
  label,
  videoPreviewUrl,
  posterPreviewUrl,
  durationSeconds,
  compressedSize,
  saving,
  saveError,
  onSave,
  onRetake,
  onCancel,
}: {
  category: EmergencyCategory;
  label: string | null;
  videoPreviewUrl: string;
  posterPreviewUrl: string;
  durationSeconds: number;
  compressedSize: number;
  saving: boolean;
  saveError: string | null;
  onSave: (notes: string | null) => void;
  onRetake: () => void;
  onCancel: () => void;
}) {
  const meta = getEmergencyCategoryMeta(category);
  const [notes, setNotes] = useState("");

  const overLimit = notes.length > NOTES_SOFT_LIMIT;
  const sizeMb = (compressedSize / (1024 * 1024)).toFixed(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="eyebrow">{meta.label} emergency</span>
        {label ? (
          <span className="chip" style={{ height: 22, fontSize: 12 }}>
            {label}
          </span>
        ) : null}
      </div>

      <VideoPlayer src={videoPreviewUrl} poster={posterPreviewUrl} />

      <div
        className="flex items-center justify-between text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        <span>{formatVideoDuration(durationSeconds)} long</span>
        <span>{sizeMb} MB after compression</span>
      </div>

      <label className="flex flex-col gap-1">
        <span
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Notes for this video (optional)
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything that's not obvious from the clip — turn direction, where the key lives, what to do after."
          className="rounded-[var(--radius-md)] px-3 py-2"
          style={{
            backgroundColor: "var(--color-bg-surface)",
            border: "1px solid var(--color-border-subtle)",
            fontSize: 14,
            resize: "vertical",
            minHeight: 90,
          }}
        />
        {overLimit ? (
          <span
            className="text-small"
            style={{ color: "var(--color-warning)" }}
          >
            That&apos;s longer than {NOTES_SOFT_LIMIT.toLocaleString()}{" "}
            characters — consider trimming so the most important part stays
            on screen in the modal.
          </span>
        ) : null}
      </label>

      {saveError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] p-3 text-small"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-primary)",
          }}
        >
          {saveError}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-1">
        <button
          type="button"
          onClick={onRetake}
          disabled={saving}
          className="btn btn-ghost"
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="refresh-cw" size={16} />
            <span>Retake</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(notes.trim() ? notes.trim() : null)}
            disabled={saving}
            className="btn btn-primary"
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Save video"}
          </button>
        </div>
      </div>
    </div>
  );
}
