"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

/**
 * Stage 2 — Capture. Empty state renders a true drag-and-drop dropzone
 * on desktop (matching the Echoes "Add a Photo" pattern) while keeping
 * the existing tap-to-open behavior on touch viewports. Once a photo is
 * picked, the preview branch is unchanged — drag-and-drop is empty-
 * state-only.
 *
 * `accept="image/*"` (no `capture` attribute) gives mobile browsers the
 * native picker offering both Camera and Photo Library, and gives
 * desktop a standard file chooser. The drag-drop path validates the
 * dropped file's MIME prefix client-side before calling onPickFile, so
 * a non-image (PDF, mov, etc.) gets the same "Please choose an image
 * file." inline error as a non-image picked via the button — drag is
 * not a backdoor around the input's `accept` filter.
 */
export function CaptureStage({
  file,
  previewUrl,
  onPickFile,
  onRetake,
  onBack,
  onAnalyze,
  targetInventoryName,
}: {
  file: File | null;
  previewUrl: string | null;
  onPickFile: (file: File) => void;
  onRetake: () => void;
  onBack: () => void;
  onAnalyze: () => void;
  /**
   * When set, the Smart Uploader is in target mode (opened from a
   * specific inventory item's "Add photo" button). The capture stage's
   * copy reflects that the photo is being attached to a known item
   * rather than analyzed, and the primary button reads "Upload photo"
   * instead of "Analyze this photo" since no AI runs in target mode.
   */
  targetInventoryName?: string | null;
}) {
  const isTargetMode = Boolean(targetInventoryName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openPicker() {
    setError(null);
    fileInputRef.current?.click();
  }

  function handlePicked(picked: File) {
    // Same gate the drop handler uses — picking a non-image via the
    // button (which can only happen if the OS picker honours `accept`
    // loosely) still surfaces the inline error rather than failing
    // silently downstream.
    if (!picked.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    onPickFile(picked);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // re-pick of the same file should still fire onChange
    if (picked) handlePicked(picked);
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // preventDefault on dragover is what tells the browser this element
    // is a valid drop target. Without it, the drop event never fires
    // and the browser navigates away to the file:// URL on release.
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // dragleave fires when the cursor crosses any descendant boundary,
    // including the inner button — without the related-target check
    // the highlight would flicker off and on as the cursor moves
    // across child elements. Only clear when the cursor genuinely
    // leaves the dropzone.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    // Consume the first file only. Multi-drop intentionally drops the
    // tail — the Smart Uploader is one-photo-at-a-time by design.
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handlePicked(dropped);
  }

  // The drop event clears the highlight on a successful drop, but if
  // the user starts dragging into the dropzone and then releases over
  // a different element (or hits Escape), no drop or dragleave fires
  // here and the highlight would stick. Listening for the global
  // `dragend` event lets us reset whenever any drag operation ends.
  useEffect(() => {
    function onWindowDragEnd() {
      setIsDragging(false);
    }
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {isTargetMode
          ? `Add another photo of ${targetInventoryName}. We'll attach it to this item — no analysis needed.`
          : "Take a clear photo of the nameplate or identifying sticker. If there's no visible label, a photo of the unit itself works."}
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
        <>
          {/*
            The dropzone is a non-button container (a div) so the
            "Choose from your computer" button below isn't nested inside
            another interactive element. Tapping anywhere inside the
            container still opens the picker — this preserves the
            one-tap-to-open behaviour mobile users had before. Desktop
            keyboard users hit the inner button (sole focus target);
            screen readers announce it normally. The drag handlers live
            on the container, not the button.
          */}
          <div
            onClick={openPicker}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center gap-3 p-8 rounded-[var(--radius-md)] text-center cursor-pointer transition-colors"
            style={{
              backgroundColor: isDragging
                ? "color-mix(in oklab, var(--color-accent) 8%, var(--color-bg-surface-raised))"
                : "var(--color-bg-surface-raised)",
              border: `1px dashed ${
                isDragging
                  ? "var(--color-accent)"
                  : "var(--color-border-emphasis)"
              }`,
              color: "var(--color-text-secondary)",
            }}
            aria-label="Drop a photo or choose a file"
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

            {/*
              Drag copy is desktop-only — there's no equivalent gesture
              on touch. Below the md breakpoint we collapse to a single
              "Take a photo" line so the dropzone reads as a tap target
              rather than a drag target.
            */}
            <span
              className="hidden md:inline"
              style={{ fontSize: 14, fontWeight: 500 }}
            >
              Drag your photo here
            </span>
            <span
              className="md:hidden"
              style={{ fontSize: 14, fontWeight: 500 }}
            >
              Take a photo of the item
            </span>

            <span
              className="hidden md:flex items-center gap-2 w-full"
              aria-hidden
            >
              <span
                className="flex-1"
                style={{
                  borderTop: "1px solid var(--color-border-subtle)",
                }}
              />
              <span
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                or
              </span>
              <span
                className="flex-1"
                style={{
                  borderTop: "1px solid var(--color-border-subtle)",
                }}
              />
            </span>

            <button
              type="button"
              onClick={(e) => {
                // Stop the click from also firing the container's
                // onClick — the container also opens the picker for
                // mobile tap convenience, and we don't want both to
                // fire on a single keyboard or mouse click.
                e.stopPropagation();
                openPicker();
              }}
              className="btn btn-ghost"
              style={{
                borderColor: "var(--color-border-emphasis)",
                color: "var(--color-text-primary)",
              }}
            >
              <span className="hidden md:inline">Choose from your computer</span>
              <span className="md:hidden">Take photo or choose file</span>
            </button>

            <span
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              JPG, PNG, or HEIC
            </span>
          </div>

          {error ? (
            <div
              role="alert"
              className="text-small"
              style={{ color: "var(--color-danger, #d33)" }}
            >
              {error}
            </div>
          ) : null}
        </>
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
              {isTargetMode ? "Upload photo" : "Analyze this photo"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
