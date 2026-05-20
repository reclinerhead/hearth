"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icon";

// Minimal Hearth toast primitive. Bottom-center across viewports (only
// ever one at a time, no stack), slide-up + fade in on mount, auto-
// dismisses after `autoDismissMs` with a hover-pause. The X button is
// the explicit close; clicking outside does not dismiss. Designed to
// surface a one-line acknowledgment after a user-initiated action — the
// inaugural caller is the "We decoded your manufacture date" message
// from the parallel serial-decode pipeline (issue #77).
//
// The component is uncontrolled internally: mount it (via conditional
// JSX) when you want the toast on screen, unmount it when the caller's
// onClose fires. Each fresh mount restarts the auto-dismiss timer.

export function Toast({
  message,
  icon = "sparkles",
  onClose,
  autoDismissMs = 6000,
}: {
  message: ReactNode;
  icon?: IconName;
  onClose: () => void;
  autoDismissMs?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const elapsedRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);

  // Defer to the next paint so the entry transform/opacity has a frame
  // to render from "off" → "on", driving the slide-up animation.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss with hover-pause. We accumulate elapsed time across
  // pauses so a user reading the toast doesn't get cut off mid-sentence
  // — the timer halts on enter, resumes on leave, and fires onClose
  // once the cumulative on-screen time reaches autoDismissMs.
  useEffect(() => {
    if (hovered) {
      if (lastStartRef.current !== null) {
        elapsedRef.current += performance.now() - lastStartRef.current;
        lastStartRef.current = null;
      }
      return;
    }
    lastStartRef.current = performance.now();
    const remaining = Math.max(0, autoDismissMs - elapsedRef.current);
    const timer = setTimeout(onClose, remaining);
    return () => clearTimeout(timer);
  }, [hovered, autoDismissMs, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="hearth-toast"
      data-mounted={mounted ? "true" : "false"}
    >
      <span aria-hidden className="hearth-toast-icon">
        <Icon name={icon} size={14} />
      </span>
      <span className="hearth-toast-message">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="hearth-toast-close"
      >
        <Icon name="x" size={14} />
      </button>
      <style>{`
        .hearth-toast {
          position: fixed;
          left: 50%;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
          transform: translate(-50%, 12px);
          opacity: 0;
          z-index: 60;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          max-width: min(420px, calc(100vw - 32px));
          padding: 10px 12px 10px 14px;
          background-color: var(--color-bg-surface-raised);
          border: 1px solid var(--color-border-subtle);
          border-radius: var(--radius-md);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
          color: var(--color-text-primary);
          font-size: var(--text-small);
          line-height: 1.45;
          transition:
            transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1),
            opacity 280ms ease-out;
        }
        /* Slim accent rule on the leading edge — the same restrained
           accent treatment the surface-ai panel uses, scaled down. */
        .hearth-toast::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 2px;
          border-top-left-radius: inherit;
          border-bottom-left-radius: inherit;
          background: color-mix(in oklab, var(--color-accent) 65%, transparent);
        }
        .hearth-toast[data-mounted="true"] {
          transform: translate(-50%, 0);
          opacity: 1;
        }
        .hearth-toast-icon {
          color: var(--color-accent);
          display: inline-flex;
          align-items: center;
        }
        .hearth-toast-message {
          min-width: 0;
          flex: 1;
          font-weight: 400;
        }
        .hearth-toast-close {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          margin: -4px -2px -4px 0;
          border: none;
          background: transparent;
          color: var(--color-text-tertiary);
          border-radius: 6px;
          transition: color 120ms ease-out, background-color 120ms ease-out;
        }
        .hearth-toast-close:hover {
          color: var(--color-text-primary);
          background-color: color-mix(
            in oklab,
            var(--color-text-primary) 8%,
            transparent
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .hearth-toast {
            transition: opacity 120ms ease-out;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
