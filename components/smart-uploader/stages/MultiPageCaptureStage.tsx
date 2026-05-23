"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  RECEIPT_MAX_PAGES,
  type ReceiptPage,
  type ReceiptUploadPhase,
} from "../hooks/use-receipt-upload";

/**
 * Stage — Multi-page capture for receipts (issue #117). User adds 1-5
 * pages in order; the parent hook handles upload + per-page row insert
 * as each page is added so the user gets per-page success/failure
 * feedback rather than discovering an upload error at the end.
 *
 * Page 1 special-cases out of the delete affordance: the parent
 * document row holds page 1's storage path directly, so removing it
 * would leave the document headless. The user instead closes the
 * modal (which routes through cleanup) and starts over.
 */
export function MultiPageCaptureStage({
  pages,
  phase,
  error,
  targetInventoryName,
  onAddPage,
  onRemovePage,
  onFinalize,
  onBack,
}: {
  pages: ReceiptPage[];
  phase: ReceiptUploadPhase;
  error: string | null;
  targetInventoryName?: string | null;
  onAddPage: (file: File) => void;
  onRemovePage: (pageNumber: number) => void;
  onFinalize: () => void;
  onBack: () => void;
}) {
  const isTargetMode = Boolean(targetInventoryName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function openPicker() {
    setLocalError(null);
    fileInputRef.current?.click();
  }

  function handlePicked(picked: File) {
    if (!picked.type.startsWith("image/")) {
      setLocalError("Please choose an image file.");
      return;
    }
    setLocalError(null);
    onAddPage(picked);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) handlePicked(picked);
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setIsDragging(false);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handlePicked(dropped);
  }

  useEffect(() => {
    function onWindowDragEnd() {
      setIsDragging(false);
    }
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, []);

  const pageCount = pages.length;
  const reachedCap = pageCount >= RECEIPT_MAX_PAGES;
  const adding = phase === "adding-page";
  const canFinalize = pageCount >= 1 && phase !== "adding-page";

  const nextPageNumber = pageCount + 1;
  const introCopy = isTargetMode
    ? `Capture each page of the receipt. We'll extract the vendor, date, total, and line items, then attach it to ${targetInventoryName}.`
    : "Capture each page of the receipt. We'll extract the vendor, date, total, and line items, then help you attach it to the right inventory item.";

  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {introCopy}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        aria-label="Receipt page image"
        className="sr-only"
        tabIndex={-1}
      />

      {pageCount > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span
              className="eyebrow"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Captured pages
            </span>
            <span
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {pageCount} of {RECEIPT_MAX_PAGES}
            </span>
          </div>
          <ul
            className="flex flex-wrap gap-2"
            aria-label="Captured receipt pages"
          >
            {pages.map((p) => (
              <li
                key={p.pageNumber}
                className="relative"
                style={{ width: 96 }}
              >
                <div
                  className="overflow-hidden"
                  style={{
                    aspectRatio: "3 / 4",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border-subtle)",
                    backgroundColor: "var(--color-bg-surface-raised)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt={`Receipt page ${p.pageNumber}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span
                  className="absolute"
                  style={{
                    top: 4,
                    left: 4,
                    padding: "1px 6px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                    backgroundColor:
                      "color-mix(in oklab, var(--color-bg-surface) 80%, transparent)",
                    backdropFilter: "blur(6px)",
                    border: "1px solid var(--color-border-subtle)",
                  }}
                  aria-hidden
                >
                  Page {p.pageNumber}
                </span>
                {p.pageNumber > 1 ? (
                  <button
                    type="button"
                    onClick={() => onRemovePage(p.pageNumber)}
                    aria-label={`Remove page ${p.pageNumber}`}
                    className="absolute"
                    style={{
                      top: 4,
                      right: 4,
                      height: 22,
                      width: 22,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: "1px solid var(--color-border-subtle)",
                      backgroundColor:
                        "color-mix(in oklab, var(--color-bg-surface) 80%, transparent)",
                      backdropFilter: "blur(6px)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reachedCap ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          You&apos;ve reached the {RECEIPT_MAX_PAGES}-page limit for a
          receipt. Tap a page to remove it if you need to swap one out,
          or extract what you have.
        </p>
      ) : (
        <div
          onClick={adding ? undefined : openPicker}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center gap-3 p-6 rounded-[var(--radius-md)] text-center transition-colors"
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
            cursor: adding ? "wait" : "pointer",
            opacity: adding ? 0.7 : 1,
          }}
          aria-label={`Add page ${nextPageNumber}`}
        >
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-accent) 16%, transparent)",
              color: "var(--color-accent)",
            }}
            aria-hidden
          >
            {adding ? (
              <span className="animate-spin inline-flex">
                <Icon name="refresh-cw" size={18} />
              </span>
            ) : (
              <Icon name="file-text" size={18} />
            )}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {adding
              ? "Uploading…"
              : pageCount === 0
                ? "Add page 1"
                : `Add page ${nextPageNumber}`}
          </span>
          {!adding ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPicker();
              }}
              className="btn btn-ghost"
              style={{
                borderColor: "var(--color-border-emphasis)",
                color: "var(--color-text-primary)",
              }}
            >
              <span className="hidden md:inline">
                Choose from your computer
              </span>
              <span className="md:hidden">Take photo or choose file</span>
            </button>
          ) : null}
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            JPG, PNG, or HEIC
          </span>
        </div>
      )}

      {(localError || error) && phase !== "processing" ? (
        <div
          role="alert"
          className="text-small"
          style={{ color: "var(--color-danger, #d33)" }}
        >
          {localError ?? error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 mt-1">
        {isTargetMode ? (
          <span aria-hidden />
        ) : (
          <button type="button" onClick={onBack} className="btn btn-ghost">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onFinalize}
          disabled={!canFinalize}
          className="btn btn-primary"
          aria-label="Extract receipt details"
        >
          {pageCount === 0
            ? "Add a page to continue"
            : pageCount === 1
              ? "Done — extract receipt"
              : `Done — extract receipt (${pageCount} pages)`}
        </button>
      </div>
    </div>
  );
}
