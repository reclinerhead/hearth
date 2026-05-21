"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";

/**
 * Nested confirmation modal for the danger-zone "Delete this property"
 * action inside the Property Details edit modal (issue #110). Mirrors
 * the structural pattern of `DeleteInventoryItemConfirmModal`, but adds
 * a higher-friction confirmation gate: the user must retype the
 * property's street address before the delete button enables.
 *
 * Address-typing gate rationale: property deletion is irreversible and
 * removes far more than an inventory item (rooms, every appliance, every
 * document, habitat findings, Day One Briefing data). A two-tap "Are
 * you sure?" wouldn't survive contact with a sleepy fat-finger; forcing
 * the user to deliberately type the address makes accidental deletes
 * effectively impossible while keeping the typing burden short.
 *
 * Match logic: case-insensitive, whitespace-trimmed. The street address
 * (`address_line1`) is the match key — city / state / zip are not part
 * of the comparison. Pressing Enter only submits when the match holds;
 * otherwise the form submission is suppressed.
 *
 * Modal mechanics: scroll-lock and focus-trap are owned by the parent
 * edit modal, so we only handle ESC and initial-focus here. Returning
 * focus to the danger-zone delete button after cancel is the parent's
 * job via `getReturnFocusElement` style — done in the parent's cancel
 * callback rather than passed through as a prop, matching how the
 * inventory delete confirm modal works.
 */

export type DeletePropertyConfirmModalProps = {
  open: boolean;
  /**
   * The property's street address. This is what the user must type to
   * confirm. Comparison is case-insensitive and whitespace-trimmed.
   */
  streetAddress: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function DeletePropertyConfirmModal({
  open,
  streetAddress,
  pending,
  error,
  onCancel,
  onConfirm,
}: DeletePropertyConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [typed, setTyped] = useState("");

  // Parent mounts conditionally and unmounts on close, so useState
  // re-initializes to "" on every open — no reset-in-effect needed
  // (matches the pattern in DeleteInventoryItemConfirmModal).
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

  const matches = normalize(typed) === normalize(streetAddress);
  const confirmDisabled = pending || !matches;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter on the input flows through here. The disabled state on
    // the button already prevents the submit path when the match
    // condition isn't met, but the form-level guard mirrors the
    // contract explicitly: pressing Enter does not submit unless the
    // input matches.
    if (confirmDisabled) return;
    onConfirm();
  }

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
        <form onSubmit={handleSubmit}>
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
                Delete this property?
              </h2>
              <p
                id={descriptionId}
                className="text-small mt-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                This permanently removes the property and everything tied
                to it.
              </p>
            </div>
          </header>

          <div className="p-4 sm:p-5 flex flex-col gap-4">
            <div
              className="text-small"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <p style={{ margin: 0 }}>
                This will permanently delete this property and everything
                associated with it:
              </p>
              <ul
                style={{
                  margin: "8px 0 0 0",
                  paddingLeft: 18,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <li>All rooms and inventory items</li>
                <li>All documents and uploaded photos</li>
                <li>All habitat findings and Day One Briefing data</li>
                <li>All onboarding progress</li>
              </ul>
              <p
                style={{
                  margin: "12px 0 0 0",
                  color: "var(--color-text-primary)",
                }}
              >
                <strong style={{ fontWeight: 500 }}>
                  This cannot be undone.
                </strong>{" "}
                Your other properties are not affected.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor={inputId}
                className="text-small"
                style={{ color: "var(--color-text-secondary)" }}
              >
                To confirm, type{" "}
                <span
                  style={{
                    fontFamily:
                      "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "var(--color-bg-surface-raised)",
                    border: "1px solid var(--color-border-subtle)",
                    color: "var(--color-text-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {streetAddress}
                </span>{" "}
                below:
              </label>
              <input
                id={inputId}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={pending}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="input"
                aria-invalid={typed.length > 0 && !matches ? true : undefined}
                placeholder={streetAddress}
              />
            </div>

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
              type="submit"
              disabled={confirmDisabled}
              className="btn"
              style={{
                backgroundColor: confirmDisabled
                  ? "color-mix(in oklab, var(--color-danger) 35%, transparent)"
                  : "var(--color-danger)",
                color: "var(--color-bg-base)",
                borderColor: confirmDisabled
                  ? "transparent"
                  : "var(--color-danger)",
                opacity: confirmDisabled && !pending ? 0.7 : 1,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
              }}
            >
              {pending ? "Deleting…" : "Delete property"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
