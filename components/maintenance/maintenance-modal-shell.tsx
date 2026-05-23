"use client";

// Shared dialog shell for the three maintenance task modals (issue
// #137): the task detail modal and the two completion sheets that
// open on top of it. Three callers in the same module is past the
// extract threshold, and inlining the same scroll-lock / focus-trap /
// ESC mechanics three times would be a maintenance tax.
//
// The shell handles: backdrop, scroll lock on the document, focus
// trap inside the dialog, ESC to close, return-focus to whatever
// element opened the modal. It does NOT enforce content layout — the
// children render directly inside the dialog with the header + close
// button stamped above.
//
// Stacking: each shell uses `z-50`, so when the detail modal mounts a
// completion sheet on top, both render in the same portal layer. The
// outer modal's focus trap is suspended by the inner modal's
// document-level keydown listener because the inner's effect mounts
// later; ESC and Tab land on the inner first, which is the behavior
// the user expects from "I opened a sub-sheet, I should be able to
// close that without dismissing the parent."

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icon";

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export type MaintenanceModalShellProps = {
  /** The big visible title (h2). */
  title: ReactNode;
  /** Small uppercase eyebrow above the title. */
  eyebrow?: ReactNode;
  /** Called when the user closes via X, ESC, or backdrop. */
  onClose: () => void;
  /** When false, ESC and backdrop click are no-ops. Used while a sub-action is saving. */
  closable?: boolean;
  /** When set, focus returns to this element when the modal unmounts. */
  getReturnFocusElement?: () => HTMLElement | null;
  /** When true, allow clicking the backdrop to close. Default false (matches edit-inventory-item). */
  closeOnBackdrop?: boolean;
  children: ReactNode;
};

export function MaintenanceModalShell({
  title,
  eyebrow,
  onClose,
  closable = true,
  getReturnFocusElement,
  closeOnBackdrop = false,
  children,
}: MaintenanceModalShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && closable) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables =
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (
          e.shiftKey &&
          (active === first || !dialogRef.current.contains(active))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      // Other shells on the page (a parent detail modal beneath this
      // sheet) still want scroll-lock active. Only remove the lock
      // when no other open dialog exists. The simplest check: don't
      // remove when another `[role="dialog"]` still in the tree.
      const otherDialogs = document.querySelectorAll('[role="dialog"]');
      if (otherDialogs.length <= 1) {
        html.classList.remove("scroll-locked");
        body.classList.remove("scroll-locked");
      }
      getReturnFocusElement?.()?.focus();
    };
  }, [closable, onClose, getReturnFocusElement]);

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (!closeOnBackdrop || !closable) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface-ai relative w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
            <h2 id={titleId} className="h2 mt-0.5">
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => {
              if (closable) onClose();
            }}
            disabled={!closable}
            className="btn btn-ghost btn-icon"
            aria-label="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-5 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
