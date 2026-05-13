"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./icon";
import { AskAboutStrip, PlaceholderImage } from "./ui";

export type DocumentPayload = {
  id: string;
  kind: string;
  title: string;
  description: string;
  entityName: string;
  entityHref: string;
};

export const SAMPLE_DOCUMENT: DocumentPayload = {
  id: "doc-drain-pump-receipt",
  kind: "Receipt",
  title: "Service receipt — drain pump replacement",
  description:
    "Issued by Riverbend Appliance Repair on Dec 14, 2024. Includes part number, labor, and one-year service warranty.",
  entityName: "Maytag dishwasher",
  entityHref: "/entities/maytag-dishwasher",
};

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export function DocumentModal({
  open,
  onClose,
  document: doc,
  getReturnFocusElement,
}: {
  open: boolean;
  onClose: () => void;
  document: DocumentPayload;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [tab, setTab] = useState<"image" | "transcript">("image");

  // Scroll lock + focus trap + ESC handler
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    // Focus the close button initially
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
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
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
      getReturnFocusElement?.()?.focus();
    };
  }, [open, onClose, getReturnFocusElement]);

  if (!open) return null;

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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface relative w-full max-w-3xl max-h-[92dvh] overflow-hidden flex flex-col"
        style={{ backgroundColor: "var(--color-bg-surface)" }}
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{doc.kind}</div>
            <h2 id={titleId} className="h2 mt-0.5">
              {doc.title}
            </h2>
            <p
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {doc.description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon"
            aria-label="Close document"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
          <AskAboutStrip
            scopeLabel="this document"
            placeholder="What does this receipt cover? When does the warranty expire?"
          />

          <div
            role="tablist"
            aria-label="Document view"
            className="inline-flex rounded-md p-0.5"
            style={{ backgroundColor: "var(--color-bg-surface-raised)" }}
          >
            <TabButton
              active={tab === "image"}
              onClick={() => setTab("image")}
              label="Page image"
            />
            <TabButton
              active={tab === "transcript"}
              onClick={() => setTab("transcript")}
              label="Transcript"
            />
          </div>

          {tab === "image" ? (
            <PlaceholderImage
              ratio="3 / 4"
              label="Scanned receipt placeholder"
              icon="file-text"
            />
          ) : (
            <div
              className="surface p-6 text-center text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              No transcript yet — we&apos;ll generate one once the document is
              processed.
            </div>
          )}
        </div>

        <footer
          className="flex items-center justify-between p-3 sm:p-4"
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <a
            href={doc.entityHref}
            className="btn btn-ghost"
            onClick={(e) => {
              // allow normal navigation; the modal will be left behind
              void e;
            }}
          >
            <Icon name="chevron-left" size={16} />
            <span>{doc.entityName}</span>
          </a>
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Press <kbd className="mono">Esc</kbd> to close
          </span>
        </footer>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="rounded px-3 py-1.5 text-sm transition-colors"
      style={{
        backgroundColor: active ? "var(--color-bg-surface)" : "transparent",
        color: active
          ? "var(--color-text-primary)"
          : "var(--color-text-secondary)",
        border: active
          ? "1px solid var(--color-border-subtle)"
          : "1px solid transparent",
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  );
}

/**
 * Convenience wrapper: a button (or any trigger via render prop) that opens
 * a DocumentModal for a given document.
 */
export function DocumentTrigger({
  document: doc,
  children,
  className,
}: {
  document: DocumentPayload;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const getReturnFocus = useCallback(() => triggerRef.current, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <DocumentModal
        open={open}
        onClose={close}
        document={doc}
        getReturnFocusElement={getReturnFocus}
      />
    </>
  );
}
