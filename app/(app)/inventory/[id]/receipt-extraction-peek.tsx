"use client";

// Receipt extraction peek panel (issue #259). The receipt tile in the
// inventory detail Documents section shows the artifact (vendor / date /
// total) and opens the original captured pages on click. This panel is the
// second, additive affordance: it surfaces *what Hearth read off the paper*
// — line items, who did the work, what it cost, when, and any identifiers
// the receipt referenced — grouped as the story of the service event rather
// than a field dump.
//
// All of this data is already persisted in hearth.documents.metadata and
// parsed by parseReceiptMetadata in the server component (page.tsx); this
// component is a pure render of that ReceiptMetadata. It owns the two
// device-appropriate presentations the parent picks between:
//
//   - variant="popover" — desktop hover. A floating card rendered through a
//     body portal, anchored below (or above) the tile and clamped to the
//     viewport. The parent owns the hover intent/grace timers; this
//     component forwards mouse enter/leave so the cursor can cross the gap
//     into the card without dismissing it.
//   - variant="sheet" — touch. A centered dialog reusing the app's modal
//     chrome (scroll-lock, Esc, backdrop dismiss, focus-on-open). Same body
//     content as the popover — the panel is the canonical surface; hover is
//     just one way in.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import type { ReceiptMetadata } from "@/lib/documents/metadata-schemas";

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 12;
const ANCHOR_OFFSET = 8;

// Shared floating-card surface. Warmer and more elevated than the inline
// panels — this reads as something that floated up over the page, matching
// the Tooltip / PickerPopover treatment.
const CARD_SURFACE: CSSProperties = {
  backgroundColor: "var(--color-bg-surface-raised)",
  border: "1px solid var(--color-border-emphasis)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.42)",
};

export function ReceiptExtractionPeek({
  metadata,
  variant,
  anchorRef,
  itemName,
  onClose,
  onViewOriginal,
  onPointerEnter,
  onPointerLeave,
}: {
  metadata: ReceiptMetadata;
  variant: "popover" | "sheet";
  /** Ref to the tile the popover anchors to. Ignored for the sheet variant.
      Passed as a ref (not the element) so the parent never reads `.current`
      during render — the popover dereferences it inside its layout effect. */
  anchorRef?: RefObject<HTMLElement | null>;
  itemName: string;
  onClose: () => void;
  onViewOriginal: () => void;
  /** Hover bridge — popover only. Cancels / restarts the parent's close timer. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  // Esc dismisses both variants. Capture phase + stopPropagation so it lands
  // here before any ancestor (the page-flip modal isn't open yet, but a
  // future host shouldn't double-handle it).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (variant === "sheet") {
    return (
      <PeekSheet itemName={itemName} onClose={onClose}>
        <PeekBody
          metadata={metadata}
          onViewOriginal={onViewOriginal}
          onClose={onClose}
        />
      </PeekSheet>
    );
  }

  return (
    <PeekPopover
      anchorRef={anchorRef}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <PeekBody metadata={metadata} onViewOriginal={onViewOriginal} />
    </PeekPopover>
  );
}

function PeekPopover({
  anchorRef,
  children,
  onPointerEnter,
  onPointerLeave,
}: {
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  // Mirror the Tooltip / PickerPopover measure-then-place dance: align the
  // card's left edge with the tile, prefer placing it below, flip above when
  // there's more room there, and cap its height to the available space (with
  // internal scroll) so a long receipt never runs off-screen. Recomputes on
  // scroll/resize so it stays glued to the tile. The anchor element is read
  // here (inside the effect), never during render.
  useLayoutEffect(() => {
    const anchorEl = anchorRef?.current;
    if (!anchorEl) return;
    const card = cardRef.current;
    if (!card) return;

    const compute = () => {
      const a = anchorEl.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = a.left;
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - POPOVER_WIDTH - VIEWPORT_MARGIN),
      );

      const spaceBelow = vh - a.bottom - ANCHOR_OFFSET - VIEWPORT_MARGIN;
      const spaceAbove = a.top - ANCHOR_OFFSET - VIEWPORT_MARGIN;
      const placeBelow = c.height <= spaceBelow || spaceBelow >= spaceAbove;

      const maxHeight = Math.max(140, placeBelow ? spaceBelow : spaceAbove);
      const top = placeBelow
        ? a.bottom + ANCHOR_OFFSET
        : Math.max(
            VIEWPORT_MARGIN,
            a.top - ANCHOR_OFFSET - Math.min(c.height, maxHeight),
          );

      setPos({ top, left, maxHeight });
    };

    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Extracted receipt details"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      className="receipt-peek-card fixed z-50"
      style={{
        ...CARD_SURFACE,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: POPOVER_WIDTH,
        maxHeight: pos?.maxHeight,
        overflowY: "auto",
        padding: 16,
        // Hidden until measured so it doesn't flash at (0,0) on first paint.
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function PeekSheet({
  itemName,
  onClose,
  children,
}: {
  itemName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Scroll-lock + focus-on-open, matching DocumentModal. The full focus trap
  // there is overkill for a panel with one or two interactive elements; Esc
  // (handled by the parent) and backdrop click cover dismissal. We move focus
  // to the first focusable inside the card (the header close button).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");
    requestAnimationFrame(() => {
      cardRef.current
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    return () => {
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
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
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Extracted details for the ${itemName} receipt`}
        className="receipt-peek-card relative w-full max-w-md"
        style={{
          ...CARD_SURFACE,
          maxHeight: "88dvh",
          overflowY: "auto",
          padding: 18,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function PeekBody({
  metadata,
  onViewOriginal,
  onClose,
}: {
  metadata: ReceiptMetadata;
  onViewOriginal: () => void;
  /** Renders the header close button — passed for the sheet, omitted for the
      hover popover (which dismisses on mouse-leave / Esc). */
  onClose?: () => void;
}) {
  const m = metadata;

  const hasLineItems = m.line_items.length > 0;
  const hasWork = hasLineItems || Boolean(m.notes);
  const hasVendor = Boolean(m.vendor_name || m.vendor_phone || m.vendor_address);
  const hasCost =
    m.total_cents != null ||
    m.subtotal_cents != null ||
    m.tax_cents != null ||
    Boolean(m.payment_method);
  const hasWhen = Boolean(m.transaction_date || m.expiration_date);
  const refs = [...m.referenced_serials, ...m.referenced_model_numbers];
  const hasRefs = refs.length > 0;
  const anyContent = hasWork || hasVendor || hasCost || hasWhen || hasRefs;

  // Cost meta line — subtotal / tax / payment method, only the present ones,
  // beneath the prominent total.
  const costMeta: string[] = [];
  if (m.subtotal_cents != null)
    costMeta.push(`Subtotal ${formatMoney(m.subtotal_cents, m.currency)}`);
  if (m.tax_cents != null)
    costMeta.push(`Tax ${formatMoney(m.tax_cents, m.currency)}`);
  if (m.payment_method) costMeta.push(m.payment_method);

  return (
    <div className="receipt-peek-in flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-1.5">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="sparkles" size={12} />
            </span>
            From this receipt
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              lineHeight: 1.2,
              marginTop: 3,
            }}
          >
            What we found
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon shrink-0"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </div>

      {!anyContent ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          We couldn&apos;t read any details from this receipt.
        </p>
      ) : null}

      {hasWork ? (
        <PeekGroup label="What was done">
          {hasLineItems ? (
            <ul className="flex flex-col gap-2">
              {m.line_items.map((li, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span
                    className="text-small"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {li.description}
                    {li.quantity != null ? (
                      <span style={{ color: "var(--color-text-tertiary)" }}>
                        {" · ×"}
                        {formatQuantity(li.quantity)}
                      </span>
                    ) : null}
                  </span>
                  {li.total_cents != null ? (
                    <span
                      className="text-small shrink-0"
                      style={{
                        color: "var(--color-text-secondary)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatMoney(li.total_cents, m.currency)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="text-small"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {m.notes}
            </p>
          )}
        </PeekGroup>
      ) : null}

      {hasVendor ? (
        <PeekGroup label="Who did it">
          <div className="flex flex-col gap-1">
            {m.vendor_name ? (
              <div
                className="text-small"
                style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
              >
                {m.vendor_name}
              </div>
            ) : null}
            {m.vendor_phone ? (
              <a
                href={`tel:${telHref(m.vendor_phone)}`}
                className="receipt-peek-link text-small inline-flex w-max items-center gap-1.5"
              >
                <Icon name="phone" size={13} />
                {m.vendor_phone}
              </a>
            ) : null}
            {m.vendor_address ? (
              <div
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {m.vendor_address}
              </div>
            ) : null}
          </div>
        </PeekGroup>
      ) : null}

      {hasCost ? (
        <PeekGroup label="What it cost">
          <div className="flex flex-col gap-1">
            {m.total_cents != null ? (
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 22,
                  lineHeight: 1.1,
                  color: "var(--color-text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMoney(m.total_cents, m.currency)}
              </div>
            ) : null}
            {costMeta.length > 0 ? (
              <div
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {costMeta.join(" · ")}
              </div>
            ) : null}
          </div>
        </PeekGroup>
      ) : null}

      {hasWhen ? (
        <PeekGroup label="When">
          <div className="flex flex-col gap-1">
            {m.transaction_date ? (
              <div
                className="text-small inline-flex items-center gap-1.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <Icon name="calendar" size={13} />
                {formatLongDate(m.transaction_date)}
              </div>
            ) : null}
            {m.expiration_date ? (
              <div
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Valid through {formatLongDate(m.expiration_date)}
              </div>
            ) : null}
          </div>
        </PeekGroup>
      ) : null}

      {hasRefs ? (
        <PeekGroup label="Referenced in this document">
          <div className="flex flex-wrap gap-1.5">
            {refs.map((r, i) => (
              <span
                key={`${r}-${i}`}
                className="chip chip-mono"
                style={{ fontSize: 11 }}
              >
                {r}
              </span>
            ))}
          </div>
        </PeekGroup>
      ) : null}

      <div
        style={{
          marginTop: 2,
          paddingTop: 12,
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        <button
          type="button"
          onClick={onViewOriginal}
          className="receipt-peek-link text-small inline-flex items-center gap-1.5"
        >
          <Icon name="file-text" size={14} />
          View original
        </button>
      </div>

      <style>{`
        @keyframes receipt-peek-in-kf {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .receipt-peek-in {
          animation: receipt-peek-in-kf 160ms ease-out both;
        }
        .receipt-peek-link {
          color: var(--color-accent);
          background: transparent;
          font-weight: 500;
          text-decoration: none;
          transition: opacity 120ms ease-out;
        }
        .receipt-peek-link:hover {
          opacity: 0.78;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .receipt-peek-in { animation: none; }
        }
      `}</style>
    </div>
  );
}

function PeekGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        className="eyebrow mb-1.5"
        style={{ letterSpacing: "1.2px", fontSize: 10 }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// Cents → currency string with 2 decimals, respecting the receipt's
// currency code. Distinct from the detail page's whole-dollar formatUsd:
// a receipt total of $499.99 must not round to $500. Falls back to a plain
// USD-shaped string if the currency code is unrecognized by Intl.
function formatMoney(cents: number, currency: string | null): string {
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

// Quantities are usually integers but the schema allows floats ("1.5 hrs").
// String() already renders 2 as "2" and 1.5 as "1.5" with no trailing zeros.
function formatQuantity(qty: number): string {
  return String(qty);
}

// Strip formatting characters for the tel: scheme while preserving a leading
// "+" for international numbers. The visible label keeps the human formatting.
function telHref(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

// Long-form date for a YYYY-MM-DD (or looser) string. Parse the date-only
// shape as UTC so it doesn't shift a day in negative-UTC zones; fall back to
// a general parse, then to the raw string for anything unparseable.
function formatLongDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
    }
  }
  const loose = new Date(value);
  if (!Number.isNaN(loose.getTime())) {
    return loose.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return value;
}
