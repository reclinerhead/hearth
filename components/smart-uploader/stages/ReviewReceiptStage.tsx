"use client";

import { useEffect, useMemo, useState } from "react";
import type { FindInventoryByReceiptResult, ReceiptInventoryCandidate } from "@/app/actions/documents/find-inventory-by-receipt";
import { saveReceiptAction } from "@/app/actions/documents/save-receipt";
import type { RenewalToastInfo } from "@/lib/maintenance/renewal-toast";
import { createClient } from "@/lib/supabase/client";
import type { EquipmentType, ReceiptExtraction } from "@/types/document";
import type { ReceiptPage } from "../hooks/use-receipt-upload";

// Receipts vary more in quality than nameplates (faded thermal paper,
// handwriting, glare). The lean from issue #117 is to mirror the
// nameplate 0.6 constant or pick 0.5; 0.5 is the call here so the
// "couldn't read clearly" affordance fires less aggressively than for
// nameplates. Documented in the technical guide as a contract.
const RECEIPT_CONFIDENCE_THRESHOLD = 0.5;

// How many inventory rows the manual picker renders at once. The list is
// a fallback for when matching didn't surface the item, so the search
// box is the intended path through a large inventory — but a cap that
// hides rows silently reads as "that's everything" when it isn't, so
// anything beyond this count is announced under the list (issue #311).
const PICKER_VISIBLE_LIMIT = 25;

type HouseInventoryRow = {
  id: string;
  name: string;
  type: EquipmentType;
  manufacturer: string | null;
};

/**
 * Stage — Review extracted receipt and pick an inventory item to attach
 * to (issue #117). In target mode the inventory is pre-locked and the
 * picker collapses to a read-only label.
 */
export function ReviewReceiptStage({
  documentId,
  houseId,
  pages,
  extraction,
  matches,
  targetInventoryId,
  targetInventoryName,
  onSaved,
  onCancel,
}: {
  documentId: string;
  houseId: string;
  pages: ReceiptPage[];
  extraction: ReceiptExtraction;
  matches: FindInventoryByReceiptResult;
  targetInventoryId?: string;
  targetInventoryName?: string | null;
  onSaved: (inventoryId: string, renewal: RenewalToastInfo | null) => void;
  onCancel: () => void;
}) {
  const lowConfidence = extraction.ai_confidence < RECEIPT_CONFIDENCE_THRESHOLD;
  const isTargetMode = Boolean(targetInventoryId);

  const [inventoryRows, setInventoryRows] = useState<HouseInventoryRow[] | null>(
    null,
  );
  // Strong match auto-selects when present; in target mode the chosen
  // item is locked. Otherwise the picker is empty until the user picks.
  const initialInventoryId =
    targetInventoryId ?? matches.strong_match?.id ?? null;
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(
    initialInventoryId,
  );
  const [userNotes, setUserNotes] = useState(extraction.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Load full inventory for the manual picker. Skipped in target mode —
  // the chosen item is already known and we don't render the picker.
  useEffect(() => {
    if (isTargetMode) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("inventory")
        .select("id, name, type, manufacturer")
        .eq("house_id", houseId)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInventoryRows((data ?? []) as HouseInventoryRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, isTargetMode]);

  const filteredRows = useMemo(() => {
    const rows = inventoryRows ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.manufacturer ?? "").toLowerCase().includes(needle),
    );
  }, [inventoryRows, filter]);

  async function handleSave() {
    if (!selectedInventoryId) {
      setError("Pick an inventory item to attach this receipt to.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await saveReceiptAction({
      documentId,
      inventoryId: selectedInventoryId,
      userNotes: userNotes.trim() === "" ? null : userNotes,
    });
    setSaving(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    onSaved(selectedInventoryId, result.renewal);
  }

  const strongMatch = matches.strong_match;
  const hasSuggestions = matches.suggested_matches.length > 0;

  const vendor = extraction.vendor_name;
  const formattedDate = formatTransactionDate(extraction.transaction_date);
  const formattedTotal = formatCents(
    extraction.total_cents,
    extraction.currency,
  );
  const formattedSubtotal = formatCents(
    extraction.subtotal_cents,
    extraction.currency,
  );
  const formattedTax = formatCents(extraction.tax_cents, extraction.currency);

  return (
    <div className="flex flex-col gap-4">
      {lowConfidence ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] p-3 text-small"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-warning, #d99500) 12%, transparent)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          We couldn&apos;t read this receipt clearly. Double-check the
          fields below before saving, or retake the pages.
        </div>
      ) : null}

      {/* Read-only thumbnail strip — same shape as the capture strip
          minus the delete affordance. */}
      <div className="flex flex-wrap gap-2">
        {pages.map((p) => (
          <div
            key={p.pageNumber}
            className="relative"
            style={{ width: 72 }}
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
                padding: "1px 5px",
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
              {p.pageNumber}
            </span>
          </div>
        ))}
      </div>

      {/* Extracted facts — read-only chip cluster. */}
      <div className="flex flex-col gap-2">
        <div className="eyebrow" style={{ color: "var(--color-text-tertiary)" }}>
          What we read
        </div>
        <div className="flex flex-wrap gap-2">
          {vendor ? <Chip label="Vendor" value={vendor} /> : null}
          {formattedDate ? (
            <Chip label="Date" value={formattedDate} />
          ) : null}
          {extraction.transaction_type ? (
            <Chip
              label="Type"
              value={capitalize(extraction.transaction_type)}
            />
          ) : null}
          {formattedTotal ? <Chip label="Total" value={formattedTotal} /> : null}
          {formattedSubtotal && formattedSubtotal !== formattedTotal ? (
            <Chip label="Subtotal" value={formattedSubtotal} />
          ) : null}
          {formattedTax ? <Chip label="Tax" value={formattedTax} /> : null}
          {extraction.payment_method ? (
            <Chip label="Paid with" value={extraction.payment_method} />
          ) : null}
        </div>
        {!vendor &&
        !formattedDate &&
        !formattedTotal &&
        !extraction.transaction_type ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Couldn&apos;t pick out the structured fields — you can still
            attach this receipt and revisit later.
          </p>
        ) : null}
      </div>

      {extraction.line_items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="eyebrow"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Line items
          </div>
          <ul className="flex flex-col gap-1.5">
            {extraction.line_items.map((item, idx) => (
              <li
                key={idx}
                className="flex items-baseline justify-between gap-2 text-small"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span className="min-w-0 truncate">{item.description}</span>
                <span
                  className="shrink-0"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {formatCents(item.total_cents, extraction.currency) ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {extraction.referenced_serials.length > 0 ||
      extraction.referenced_model_numbers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="eyebrow"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Identifiers seen on the receipt
          </div>
          <div className="flex flex-wrap gap-2">
            {extraction.referenced_serials.map((s, i) => (
              <Chip key={`s-${i}`} label="Serial" value={s} mono />
            ))}
            {extraction.referenced_model_numbers.map((m, i) => (
              <Chip key={`m-${i}`} label="Model" value={m} mono />
            ))}
          </div>
        </div>
      ) : null}

      {/* Match banner / inventory picker. In target mode this collapses
          to a single read-only banner anchoring the receipt to the
          chosen item. */}
      {isTargetMode ? (
        <div
          className="rounded-[var(--radius-md)] p-3"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 8%, transparent)",
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          <div
            className="eyebrow"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Attaching to
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {targetInventoryName ?? "Selected item"}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            className="eyebrow"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Attach to an inventory item
          </div>

          {strongMatch ? (
            <StrongMatchBanner
              candidate={strongMatch}
              selected={selectedInventoryId === strongMatch.id}
              onSelect={() => setSelectedInventoryId(strongMatch.id)}
            />
          ) : null}

          {hasSuggestions ? (
            <div className="flex flex-col gap-1">
              <span
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {strongMatch
                  ? "Other possible matches"
                  : "Maybe one of these?"}
              </span>
              <ul className="flex flex-col gap-1">
                {matches.suggested_matches.map((m) => (
                  <li key={m.id}>
                    <SuggestionRow
                      candidate={m}
                      selected={selectedInventoryId === m.id}
                      onSelect={() => setSelectedInventoryId(m.id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={
              strongMatch || hasSuggestions
                ? "Or search for a different item…"
                : "Search your inventory…"
            }
            aria-label="Search inventory"
            className="rounded-[var(--radius-md)] px-3 py-2"
            style={{
              backgroundColor: "var(--color-bg-surface-raised)",
              border: "1px solid var(--color-border-subtle)",
              color: "var(--color-text-primary)",
            }}
          />

          {inventoryRows === null ? (
            <span
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Loading your inventory…
            </span>
          ) : filteredRows.length === 0 ? (
            <span
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              No inventory matches that search.
            </span>
          ) : (
            <>
              <ul
                className="flex flex-col gap-1 overflow-auto"
                style={{
                  maxHeight: 240,
                  // The picker sits inside the page-sheet's own scroller.
                  // Without containment, reaching the end of this list
                  // chains the gesture into the sheet behind it and the
                  // two fight over the same swipe (issue #311).
                  overscrollBehavior: "contain",
                }}
              >
                {filteredRows.slice(0, PICKER_VISIBLE_LIMIT).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedInventoryId(row.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors"
                      style={{
                        backgroundColor:
                          selectedInventoryId === row.id
                            ? "color-mix(in oklab, var(--color-accent) 14%, transparent)"
                            : "var(--color-bg-surface)",
                        border: "1px solid var(--color-border-subtle)",
                        color: "var(--color-text-primary)",
                        // A single-line row lands at ~36px, under the 44px
                        // touch-target floor these rows are tapped at.
                        minHeight: 44,
                      }}
                    >
                      <div className="min-w-0">
                        <div
                          style={{ fontSize: 14, fontWeight: 500 }}
                          className="truncate"
                        >
                          {row.name}
                        </div>
                        {row.manufacturer ? (
                          <div
                            className="text-small truncate"
                            style={{ color: "var(--color-text-tertiary)" }}
                          >
                            {row.manufacturer}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className="text-small shrink-0"
                        style={{ color: "var(--color-text-tertiary)" }}
                      >
                        {capitalize(row.type)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {filteredRows.length > PICKER_VISIBLE_LIMIT ? (
                <span
                  className="text-small"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  Showing {PICKER_VISIBLE_LIMIT} of {filteredRows.length} —
                  search to narrow the list.
                </span>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* User notes — editable, defaults to the extracted notes. */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="receipt-notes"
          className="eyebrow"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Notes
        </label>
        <textarea
          id="receipt-notes"
          value={userNotes}
          onChange={(e) => setUserNotes(e.target.value)}
          rows={3}
          placeholder="Anything you want to remember about this receipt."
          className="rounded-[var(--radius-md)] px-3 py-2"
          style={{
            backgroundColor: "var(--color-bg-surface-raised)",
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-primary)",
            resize: "vertical",
          }}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="text-small"
          style={{ color: "var(--color-danger, #d33)" }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !selectedInventoryId}
          className="btn btn-primary"
        >
          {saving ? "Saving…" : "Save receipt"}
        </button>
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span
      className="chip"
      style={{
        // Mono treatment for identifiers (serials / model numbers) so
        // the user can read them character-by-character — same pattern
        // as the inventory detail page's serial pill.
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        fontFamily: mono
          ? "var(--font-mono, ui-monospace, monospace)"
          : undefined,
      }}
    >
      <span
        style={{
          color: "var(--color-text-tertiary)",
          marginRight: 6,
        }}
      >
        {label}
      </span>
      {value}
    </span>
  );
}

function StrongMatchBanner({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ReceiptInventoryCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-start gap-3 rounded-[var(--radius-md)] p-3 text-left transition-colors"
      style={{
        backgroundColor: selected
          ? "color-mix(in oklab, var(--color-accent) 18%, transparent)"
          : "color-mix(in oklab, var(--color-accent) 10%, transparent)",
        border: `1px solid ${
          selected ? "var(--color-accent)" : "var(--color-border-subtle)"
        }`,
        color: "var(--color-text-primary)",
      }}
    >
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          Looks like your {candidate.name}
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {candidate.manufacturer ? `${candidate.manufacturer} · ` : ""}
          serial matched the receipt
        </div>
      </div>
      <span
        className="text-small shrink-0"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {selected ? "Selected" : "Tap to attach"}
      </span>
    </button>
  );
}

function SuggestionRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ReceiptInventoryCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors w-full"
      style={{
        backgroundColor: selected
          ? "color-mix(in oklab, var(--color-accent) 14%, transparent)"
          : "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
        color: "var(--color-text-primary)",
      }}
    >
      <div className="min-w-0">
        <div style={{ fontSize: 14, fontWeight: 500 }} className="truncate">
          {candidate.name}
        </div>
        {candidate.manufacturer ? (
          <div
            className="text-small truncate"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {candidate.manufacturer}
          </div>
        ) : null}
      </div>
      <span
        className="text-small shrink-0"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {capitalize(candidate.type)}
      </span>
    </button>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatCents(
  cents: number | null,
  currency: string | null | undefined,
): string | null {
  if (cents === null || cents === undefined) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    // Currency code wasn't a recognized ISO 4217 — fall back to a
    // plain dollar format rather than crashing.
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatTransactionDate(value: string | null): string | null {
  if (!value) return null;
  // Accept ISO YYYY-MM-DD (the prompt's instructed shape). Fall through
  // to the raw string if the parse fails — better than dropping a date
  // the user can still read.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
