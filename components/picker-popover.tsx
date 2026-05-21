"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Shared popover shell for the date and month pickers (issue #107).
 *
 * Renders through a portal to `document.body` so the popup can escape
 * any ancestor with `overflow: hidden` (notably the edit modals'
 * `.surface-ai` dialog, which clips its scrollable region). Owns:
 *
 *  - Viewport-aware positioning: anchored under the trigger by
 *    default, flipping above when there's more room above than below.
 *    Horizontally clamped so the popup never escapes the viewport.
 *  - A transparent click-eater overlay that closes the popover on
 *    outside mousedown and `stopPropagation`s so a parent modal that
 *    listens for backdrop clicks (EditHomeDetailsModal) doesn't also
 *    fire.
 *  - Capture-phase ESC and Tab handling so the keys land on the
 *    popover before any ancestor modal handler — ESC closes the
 *    popover (not the modal behind it), and Tab cycles focus inside
 *    the popup rather than escaping back into the modal's form.
 *  - Initial focus moved into the popup on open and returned to the
 *    trigger on close.
 *
 * The popup is wrapped in `.surface-ai` so it inherits the diagonal
 * accent halo + warm dark surface treatment used by the modals it
 * opens out of. Open motion uses the existing `insights-appear`
 * keyframe so the popover handoff feels consistent with the rest of
 * the surface-ai surfaces in the app.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

type Placement = "below" | "above";

type Position = {
  top: number;
  left: number;
  minWidth: number;
  placement: Placement;
};

export function PickerPopover({
  open,
  anchor,
  label,
  onClose,
  children,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  /** Accessible label for the popover dialog. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;

    function update() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      const cardH = cardRef.current?.offsetHeight ?? 320;
      const cardW = cardRef.current?.offsetWidth ?? rect.width;

      const spaceBelow = viewportH - rect.bottom;
      const spaceAbove = rect.top;
      const placement: Placement =
        spaceBelow < cardH + 12 && spaceAbove > spaceBelow ? "above" : "below";

      const top =
        placement === "below" ? rect.bottom + 6 : rect.top - cardH - 6;

      // Horizontal clamp: keep the card 12px from either viewport edge.
      const idealLeft = rect.left;
      const maxLeft = Math.max(12, viewportW - cardW - 12);
      const left = Math.min(Math.max(12, idealLeft), maxLeft);

      setPos({ top, left, minWidth: rect.width, placement });
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (
          e.shiftKey &&
          (active === first || !cardRef.current.contains(active))
        ) {
          e.preventDefault();
          e.stopPropagation();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          e.stopPropagation();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKey, { capture: true });
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const first = cardRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (open) return;
    // Return focus to the trigger on close so keyboard navigation
    // picks up where the user left off.
    anchor?.focus();
  }, [open, anchor]);

  if (!open || !pos) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 60 }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-label={label}
        className="surface-ai picker-popover-card insights-appear"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          minWidth: pos.minWidth,
          padding: 12,
          zIndex: 61,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
