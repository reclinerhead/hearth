"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";

// Nested confirmation modal for the destructive DELETE button inside
// the EDIT DETAILS modal. Standalone modal mechanics — scroll lock and
// focus trap are owned by the parent modal, so we only handle ESC and
// initial-focus here. Returning focus to the danger-zone delete button
// after cancel is the parent's job through getReturnFocusElement.
//
// Default-checked "Also delete linked documents" reflects the common
// case (issue #57): a user removing an appliance almost always wants
// receipts, manuals, and photos for it gone too. Power users who want
// to preserve a receipt for tax records can uncheck.

export type DeleteInventoryItemConfirmModalProps = {
  open: boolean;
  itemLabel: string;
  /** Number of documents currently linked to the item. Drives the
   *  doc-cascade checkbox copy ("Also delete 3 linked documents"). */
  linkedDocumentCount: number;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (args: { cascadeDocuments: boolean }) => void;
};

export function DeleteInventoryItemConfirmModal({
  open,
  itemLabel,
  linkedDocumentCount,
  pending,
  error,
  onCancel,
  onConfirm,
}: DeleteInventoryItemConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [cascadeDocuments, setCascadeDocuments] = useState(true);

  // Parent mounts this component only while open and unmounts on close,
  // so the useState above initializes cascadeDocuments to true freshly
  // on each open — no reset-in-effect needed (would have tripped
  // react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => cancelButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel, pending]);

  if (!open) return null;

  const docLabel =
    linkedDocumentCount === 1 ? "1 linked document" : `${linkedDocumentCount} linked documents`;

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="surface relative w-full max-w-md overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-surface)" }}
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{
              color: "var(--color-danger)",
              backgroundColor:
                "color-mix(in oklab, var(--color-danger) 12%, transparent)",
            }}
          >
            <Icon name="alert-triangle" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="h3">
              Delete {itemLabel}?
            </h2>
            <p
              id={descriptionId}
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              This action can&apos;t be undone.
            </p>
          </div>
        </header>

        <div className="p-4 sm:p-5 flex flex-col gap-4">
          {linkedDocumentCount > 0 ? (
            <label
              className="flex items-start gap-3 cursor-pointer"
              style={{ fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={cascadeDocuments}
                onChange={(e) => setCascadeDocuments(e.target.checked)}
                disabled={pending}
                style={{
                  marginTop: 3,
                  width: 16,
                  height: 16,
                  accentColor: "var(--color-danger)",
                }}
              />
              <span className="min-w-0">
                <span>Also delete {docLabel}</span>
                <span
                  className="block text-small mt-0.5"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {cascadeDocuments
                    ? "Receipts, manuals, and photos attached to this item will be removed too."
                    : "Linked documents will be kept and shown as unattached in your house."}
                </span>
              </span>
            </label>
          ) : (
            <p
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              No documents are attached to this item.
            </p>
          )}

          {error ? (
            <p
              className="text-small"
              role="alert"
              style={{ color: "var(--color-danger)" }}
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer
          className="flex items-center justify-end gap-2 p-3 sm:p-4"
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface)",
          }}
        >
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ cascadeDocuments })}
            disabled={pending}
            className="btn"
            style={{
              backgroundColor: "var(--color-danger)",
              color: "var(--color-bg-base)",
              borderColor: "var(--color-danger)",
            }}
          >
            {pending ? "Deleting…" : "Delete forever"}
          </button>
        </footer>
      </div>
    </div>
  );
}
