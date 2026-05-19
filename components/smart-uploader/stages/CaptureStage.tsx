"use client";

import { useRef } from "react";
import { Icon } from "@/components/icon";

/**
 * Stage 2 — Capture. Hidden file input behind a styled button label.
 * `accept="image/*"` (no `capture` attribute) gives mobile browsers
 * the native picker offering both Camera and Photo Library, and gives
 * desktop a standard file chooser. Matches the dashboard's user-photo
 * upload affordance.
 */
export function CaptureStage({
  file,
  previewUrl,
  onPickFile,
  onRetake,
  onBack,
  onAnalyze,
}: {
  file: File | null;
  previewUrl: string | null;
  onPickFile: (file: File) => void;
  onRetake: () => void;
  onBack: () => void;
  onAnalyze: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // re-pick of the same file should still fire onChange
    if (picked) onPickFile(picked);
  }

  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Take a clear photo of the nameplate or identifying sticker. If
        there&apos;s no visible label, a photo of the unit itself works.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {previewUrl && file ? (
        <div className="flex flex-col gap-3">
          <div
            className="surface overflow-hidden"
            style={{
              aspectRatio: "4 / 3",
              borderRadius: "var(--radius-md)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={file.name || "Selected photo"}
              className="h-full w-full object-cover"
            />
          </div>
          <p
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {file.name}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-8 rounded-[var(--radius-md)] text-center transition-colors"
          style={{
            backgroundColor: "var(--color-bg-surface-raised)",
            border: "1px dashed var(--color-border-emphasis)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-accent) 16%, transparent)",
              color: "var(--color-accent)",
            }}
            aria-hidden
          >
            <Icon name="camera" size={22} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            Take photo or choose file
          </span>
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            JPG, PNG, or HEIC
          </span>
        </button>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <button type="button" onClick={onBack} className="btn btn-ghost">
          Back
        </button>
        {file ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRetake}
              className="btn btn-ghost"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={onAnalyze}
              className="btn btn-primary"
            >
              Analyze this photo
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
