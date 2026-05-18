"use client";

import { useCallback, useId, useState, type ReactNode } from "react";

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
 * Positioning is CSS-only — defaults to "top" above the trigger; pass
 * `side="bottom"` when the trigger sits near the top of a scroll
 * container and a popup above would clip out of view.
 */
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
  const id = useId();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  return (
    <span className="relative inline-flex">
      <span
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
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute z-50 w-max max-w-[16rem]"
          style={{
            ...(side === "top"
              ? { bottom: "calc(100% + 6px)" }
              : { top: "calc(100% + 6px)" }),
            left: "50%",
            transform: "translateX(-50%)",
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
        </span>
      ) : null}
    </span>
  );
}
