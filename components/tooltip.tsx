"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Minimal accessible tooltip primitive.
 *
 * Wraps a non-focusable element (typically a status/category pill) and
 * makes it focusable + hoverable, surfacing a short explanatory string
 * on hover, keyboard focus, and tap-into-focus. Escape dismisses.
 * Uses `aria-describedby` so screen readers announce the explanation
 * with the trigger.
 *
 * Project convention: any pill that names a category or classification
 * (NPL listing, Tier, Severity, etc.) should be wrapped so the user can
 * find out what the category means without leaving the surface.
 *
 * Positioning renders the tooltip into a body-level portal so it can
 * escape `overflow: hidden` ancestors (modals, scroll containers) and
 * is then clamped to the viewport so a trigger near the left or right
 * edge doesn't push the tooltip off-screen. `side` is the preferred
 * vertical placement — if the preferred side doesn't fit, the tooltip
 * flips to the other side rather than clip.
 */

const VIEWPORT_MARGIN = 8;
const TRIGGER_OFFSET = 6;

type Position = { top: number; left: number; placement: "top" | "bottom" };

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const compute = () => {
      const t = trigger.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = t.left + t.width / 2 - tip.width / 2;
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - tip.width - VIEWPORT_MARGIN),
      );

      const topAbove = t.top - tip.height - TRIGGER_OFFSET;
      const topBelow = t.bottom + TRIGGER_OFFSET;
      const fitsAbove = topAbove >= VIEWPORT_MARGIN;
      const fitsBelow = topBelow + tip.height <= vh - VIEWPORT_MARGIN;

      let placement: "top" | "bottom" = side;
      if (side === "top" && !fitsAbove && fitsBelow) placement = "bottom";
      if (side === "bottom" && !fitsBelow && fitsAbove) placement = "top";

      const top = placement === "top" ? topAbove : topBelow;
      setPos({ top, left, placement });
    };

    compute();

    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open, side, content]);

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            hide();
            (e.currentTarget as HTMLSpanElement).blur();
          }
        }}
        className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
        style={{ outline: "none" }}
      >
        {children}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-50 w-max max-w-[16rem]"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                // Hide on the very first paint, before useLayoutEffect
                // has measured. Once we have a real position, the
                // tooltip becomes visible in the same layout pass.
                visibility: pos ? "visible" : "hidden",
                backgroundColor: "var(--color-bg-surface-raised)",
                border: "1px solid var(--color-border-emphasis)",
                borderRadius: "var(--radius-md)",
                color: "var(--color-text-primary)",
                padding: "8px 10px",
                fontSize: 12,
                lineHeight: 1.45,
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
              }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
