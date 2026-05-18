"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";
import { createClient } from "@/lib/supabase/client";

/**
 * Modal edit surface for the user's house. Triggered from the top-nav
 * account menu — this replaces the standalone /home-details page and is
 * the only entry point for editing house facts today.
 *
 * Wired directly to hearth.houses via the RLS-bound browser client (same
 * pattern as the user-photo upload in dashboard-live.tsx). The server
 * trusts RLS for ownership; nothing here checks who the user is.
 *
 * Modal mechanics (scroll-lock, focus trap, ESC, backdrop close, return
 * focus) match HabitatFindingModal. When a third modal needs the same
 * mechanics we can pull a shared base out of the three; two callers is
 * the threshold and we'd hit three after this lands.
 */

export type EditableHouseRow = {
  id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  year_built: number | null;
  living_area_sqft: number | null;
  lot_size_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  purchase_date: string | null;
};

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function toIntegerOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function numberInputValue(n: number | null): string {
  return n == null ? "" : String(n);
}

function dateInputValue(iso: string | null): string {
  // hearth.houses.purchase_date is stored as a DATE (YYYY-MM-DD). If a full
  // timestamp ever lands here, the first 10 chars are still the date.
  return iso ? iso.slice(0, 10) : "";
}

export function EditHomeDetailsModal({
  open,
  house,
  onClose,
  getReturnFocusElement,
}: {
  open: boolean;
  house: EditableHouseRow;
  onClose: () => void;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  const [yearBuilt, setYearBuilt] = useState(
    numberInputValue(house.year_built),
  );
  const [livingArea, setLivingArea] = useState(
    numberInputValue(house.living_area_sqft),
  );
  const [lotSize, setLotSize] = useState(
    numberInputValue(house.lot_size_sqft),
  );
  const [bedrooms, setBedrooms] = useState(numberInputValue(house.bedrooms));
  const [bathrooms, setBathrooms] = useState(
    numberInputValue(house.bathrooms),
  );
  const [purchaseDate, setPurchaseDate] = useState(
    dateInputValue(house.purchase_date),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

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
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
      getReturnFocusElement?.()?.focus();
    };
  }, [open, onClose, getReturnFocusElement]);

  if (!open) return null;

  const addressLine = [
    house.address_line1,
    house.address_line2,
    `${house.city}, ${house.state} ${house.postal_code}`.trim(),
  ]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(", ");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const update = {
        year_built: toIntegerOrNull(yearBuilt),
        living_area_sqft: toIntegerOrNull(livingArea),
        lot_size_sqft: toIntegerOrNull(lotSize),
        bedrooms: toIntegerOrNull(bedrooms),
        bathrooms: toNumberOrNull(bathrooms),
        purchase_date: purchaseDate.trim() === "" ? null : purchaseDate,
      };
      const { error: updateError } = await supabase
        .from("houses")
        .update(update)
        .eq("id", house.id);
      if (updateError) {
        setError(
          updateError.message || "We couldn't save your changes. Try again.",
        );
        return;
      }
      // router.refresh() re-runs server components (the (app) layout and
      // dashboard page in particular), so the top-nav address and any
      // dashboard tiles that read from the house row reflect the new
      // values without a full page reload.
      router.refresh();
      onClose();
    } catch (err) {
      console.error("home details save failed", err);
      setError("Something went wrong saving. Try again.");
    } finally {
      setSaving(false);
    }
  }

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
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="surface-ai relative w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <form
          onSubmit={handleSubmit}
          className="flex flex-col min-h-0 flex-1"
        >
          <header
            className="flex items-start gap-3 p-4 sm:p-5 shrink-0"
            style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-1">Edit</div>
              <h2 id={titleId} className="h2 mt-0.5">
                Home details
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn btn-ghost btn-icon"
              aria-label="Close edit home details"
            >
              <Icon name="x" size={18} />
            </button>
          </header>

          <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-5 flex-1">
            <div>
              <div className="label flex items-center">
                Address
                <span
                  className="ml-2 chip"
                  style={{ height: 18, fontSize: 10, padding: "0 6px" }}
                >
                  From records
                </span>
              </div>
              <div
                className="input"
                style={{
                  backgroundColor: "var(--color-bg-surface-raised)",
                  color: "var(--color-text-secondary)",
                  height: "auto",
                  minHeight: 40,
                  display: "flex",
                  alignItems: "center",
                  whiteSpace: "normal",
                  lineHeight: 1.4,
                  paddingTop: 8,
                  paddingBottom: 8,
                }}
              >
                {addressLine}
              </div>
              <p
                className="text-small mt-1"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                From public records — contact us if this needs to change.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <FieldNumber
                label="Build year"
                value={yearBuilt}
                onChange={setYearBuilt}
                step="1"
                inputMode="numeric"
                placeholder="e.g. 1934"
              />
              <FieldNumber
                label="Square feet"
                value={livingArea}
                onChange={setLivingArea}
                step="1"
                inputMode="numeric"
                placeholder="e.g. 1840"
              />
              <FieldNumber
                label="Lot size (sf)"
                value={lotSize}
                onChange={setLotSize}
                step="1"
                inputMode="numeric"
                placeholder="e.g. 7840"
              />
              <FieldNumber
                label="Bedrooms"
                value={bedrooms}
                onChange={setBedrooms}
                step="1"
                inputMode="numeric"
                placeholder="e.g. 3"
              />
              <FieldNumber
                label="Bathrooms"
                value={bathrooms}
                onChange={setBathrooms}
                step="0.5"
                inputMode="decimal"
                placeholder="e.g. 1.5"
              />
              <FieldDate
                label="Ownership start"
                value={purchaseDate}
                onChange={setPurchaseDate}
              />
            </div>

            {error ? (
              <p
                className="text-small"
                role="alert"
                style={{ color: "var(--color-danger, #c44)" }}
              >
                {error}
              </p>
            ) : null}
          </div>

          <footer
            className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4 shrink-0"
            style={{
              borderTop: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-surface)",
            }}
          >
            <p
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Some of this came from public records — edit anything we got
              wrong.
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
  step,
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  inputMode: "numeric" | "decimal";
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        inputMode={inputMode}
        placeholder={placeholder}
        className="input"
      />
    </div>
  );
}

function FieldDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </div>
  );
}
