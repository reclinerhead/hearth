"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteHouseAction } from "@/app/actions/houses/delete-house";
import { DatePicker } from "./date-picker";
import { DeletePropertyConfirmModal } from "./delete-property-confirm-modal";
import { Icon } from "./icon";
import {
  basementToChoice,
  choiceToBasement,
  choiceToWaterSource,
  PropertySituationFields,
  waterSourceToChoice,
  type BasementChoice,
  type RowWaterSource,
  type WaterSourceChoice,
} from "./property-situation-fields";
import { dispatchHouseUpdated } from "@/lib/hooks/use-house-realtime";
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
  // Issue #142 — property-situation fields surfaced as segmented
  // controls in the form below. Null means "never captured"; the
  // segmented controls' explicit "Not sure" option persists as
  // `water_source: "unknown"` / `basement_present: null` respectively.
  // Helpers + the control component live in
  // `./property-situation-fields.tsx`, shared with the onboarding
  // step that captures these for new houses.
  water_source: RowWaterSource;
  basement_present: boolean | null;
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
  onDeleteError,
  getReturnFocusElement,
}: {
  open: boolean;
  house: EditableHouseRow;
  onClose: () => void;
  /**
   * Called when the delete server action returns a failure response.
   * The parent surfaces a toast and the edit + confirm modals are
   * already closed by the time this fires. On success the action
   * redirects (NEXT_REDIRECT throws), so this callback never runs in
   * the happy path.
   */
  onDeleteError?: (message: string) => void;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const [waterSource, setWaterSource] = useState<WaterSourceChoice>(() =>
    waterSourceToChoice(house.water_source),
  );
  const [basementPresent, setBasementPresent] = useState<BasementChoice>(() =>
    basementToChoice(house.basement_present),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      // Let the delete-confirm modal handle its own ESC when it's open
      // — its handler runs first because it mounts later in the tree.
      if (deleteOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!saving) onClose();
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
  }, [open, onClose, getReturnFocusElement, saving, deleteOpen]);

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
        water_source: choiceToWaterSource(waterSource),
        basement_present: choiceToBasement(basementPresent),
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
      // dispatchHouseUpdated triggers an imperative refetch in
      // useHouseRealtime (which DashboardLive owns), updating the
      // dashboard hero's client-side state immediately. Required
      // because router.refresh() below only re-runs server components
      // and Realtime is documented as unreliable in some browsers (see
      // docs/TechnicalGuide.md "Realtime and the browser").
      dispatchHouseUpdated(house.id);
      // router.refresh() re-runs server components (the (app) layout
      // in particular), so the top-nav address reflects the new
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

  async function handleDeleteConfirm() {
    setDeleteError(null);
    setDeletePending(true);
    try {
      // Happy path: the action calls redirect() which throws
      // NEXT_REDIRECT; we never reach the line after the await. The
      // edit + confirm modals stay mounted until the navigation lands,
      // at which point this component unmounts. Any returned value
      // therefore signals a failure that the parent should surface as
      // a toast.
      const result = await deleteHouseAction(house.id);
      if (result && !result.ok) {
        // Close both modals and bubble the error up — the user lands
        // back on the property page with a top-center toast explaining
        // what went wrong.
        setDeleteOpen(false);
        onClose();
        onDeleteError?.(result.error);
      }
    } catch (err) {
      // NEXT_REDIRECT is the redirect-in-progress signal — let it
      // propagate so the framework completes the navigation. Anything
      // else is a real failure surfaced via the same toast path.
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string" &&
        (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      console.error("property delete failed", err);
      setDeleteOpen(false);
      onClose();
      onDeleteError?.("Something went wrong deleting. Try again.");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <>
    <div
      aria-hidden={false}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        // Don't close on backdrop click while the nested delete-confirm
        // modal is open — the user's click could be a mis-aimed attempt
        // to cancel the confirm modal and we'd otherwise dismiss both.
        if (e.target === e.currentTarget && !saving && !deleteOpen) onClose();
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
              <DatePicker
                label="Ownership start"
                value={purchaseDate}
                onChange={setPurchaseDate}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div
                className="eyebrow"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Property situation
              </div>
              <PropertySituationFields
                waterSource={waterSource}
                onWaterSourceChange={setWaterSource}
                basementPresent={basementPresent}
                onBasementChange={setBasementPresent}
              />
            </div>

            <DangerZone
              triggerRef={deleteTriggerRef}
              disabled={saving}
              onDelete={() => setDeleteOpen(true)}
            />

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
              These details power your dashboard and habitat checks.
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

    {deleteOpen ? (
      <DeletePropertyConfirmModal
        open
        streetAddress={house.address_line1}
        pending={deletePending}
        error={deleteError}
        onCancel={() => {
          if (deletePending) return;
          setDeleteOpen(false);
          // Return focus to the danger-zone delete button on cancel so
          // the user can re-trigger easily, matching the inventory
          // edit modal's return-focus pattern.
          requestAnimationFrame(() => deleteTriggerRef.current?.focus());
        }}
        onConfirm={handleDeleteConfirm}
      />
    ) : null}
    </>
  );
}

/**
 * GitHub-style danger zone — a red-tinted bordered region clearly
 * separated from the rest of the form so a destructive action can't
 * be fat-fingered while editing fields. Mirrors the same component in
 * `edit-inventory-item-modal.tsx`; the two have drifted to slightly
 * different copy and would consolidate cleanly once a third caller
 * lands, but two is below the threshold for shared extraction.
 */
function DangerZone({
  triggerRef,
  disabled,
  onDelete,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className="mt-2"
      style={{
        borderRadius: "var(--radius-md)",
        border:
          "1px solid color-mix(in oklab, var(--color-danger) 50%, transparent)",
        padding: 16,
        backgroundColor:
          "color-mix(in oklab, var(--color-danger) 6%, transparent)",
      }}
    >
      <div
        className="eyebrow"
        style={{
          letterSpacing: "1.2px",
          fontSize: 10,
          color: "var(--color-danger)",
        }}
      >
        Danger zone
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
        <div className="min-w-0">
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Delete this property
          </div>
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Removes this property and everything tied to it &mdash; rooms,
            inventory, documents, and habitat findings. Your other
            properties are not affected.
          </div>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="btn"
          style={{
            color: "var(--color-danger)",
            borderColor:
              "color-mix(in oklab, var(--color-danger) 55%, transparent)",
            backgroundColor: "transparent",
          }}
        >
          Delete this property&hellip;
        </button>
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


