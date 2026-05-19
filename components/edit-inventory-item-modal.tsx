"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteInventoryItemAction } from "@/app/actions/inventory/delete-item";
import {
  updateInventoryItemAction,
  type UpdateInventoryItemInput,
} from "@/app/actions/inventory/update-item";
import type { EquipmentType } from "@/types/document";
import { DeleteInventoryItemConfirmModal } from "./delete-inventory-item-confirm-modal";
import { Icon } from "./icon";

/**
 * Modal edit surface for a single hearth.inventory row. Triggered from
 * the EDIT DETAILS button on /inventory/[id] (issue #57). Reuses the
 * conventions established by EditHomeDetailsModal: scroll-lock,
 * focus-trap, ESC, return-focus, ai-surface styling, label/input
 * helpers.
 *
 * Owns three things in addition to the standard edit form:
 *  - A type select (re-classifying mis-detected items) and a room
 *    select (relocating mis-categorized items) — both are common
 *    failure modes of the upload-time AI classification.
 *  - A danger zone footer with the DELETE button that mounts the
 *    nested DeleteInventoryItemConfirmModal.
 *  - A `researchInvalidated` signal back to the parent: when the user
 *    edits manufacturer / model_number / type, the previously stored
 *    "Research this model" insights are stale and the panel should be
 *    re-run. The decision is made by the server action's pure helper;
 *    the parent uses the returned flag to kick off researchInventoryModelAction.
 *
 * Modal mechanics match EditHomeDetailsModal. If a fourth caller needs
 * the same shell we can pull a shared base out.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export type EditableInventoryRow = {
  id: string;
  name: string;
  type: EquipmentType;
  room_id: string;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_on: string | null;
  last_serviced_on: string | null;
  next_service_due_on: string | null;
  notes: string | null;
};

export type EditInventoryItemRoomOption = {
  id: string;
  name: string;
};

function dateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function emptyToNull(s: string): string | null {
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

function dateOrNull(s: string): string | null {
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

export function EditInventoryItemModal({
  open,
  item,
  rooms,
  linkedDocumentCount,
  onClose,
  onSaved,
  onDeleted,
  getReturnFocusElement,
}: {
  open: boolean;
  item: EditableInventoryRow;
  rooms: EditInventoryItemRoomOption[];
  linkedDocumentCount: number;
  onClose: () => void;
  /**
   * Called after a successful save. `researchInvalidated` is true when
   * manufacturer / model_number / type changed and any stale ai_insights
   * were cleared — the caller should re-run researchInventoryModelAction
   * so the "What we know" panel reflects the new values.
   */
  onSaved: (args: { researchInvalidated: boolean }) => void;
  /**
   * Called after a successful delete. The caller typically navigates
   * away from the now-gone inventory detail page.
   */
  onDeleted: () => void;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  const [name, setName] = useState(item.name);
  const [type, setType] = useState<EquipmentType>(item.type);
  const [roomId, setRoomId] = useState(item.room_id);
  const [manufacturer, setManufacturer] = useState(item.manufacturer ?? "");
  const [modelNumber, setModelNumber] = useState(item.model_number ?? "");
  const [serialNumber, setSerialNumber] = useState(item.serial_number ?? "");
  const [installedOn, setInstalledOn] = useState(dateInputValue(item.installed_on));
  const [lastServicedOn, setLastServicedOn] = useState(
    dateInputValue(item.last_serviced_on),
  );
  const [nextServiceDueOn, setNextServiceDueOn] = useState(
    dateInputValue(item.next_service_due_on),
  );
  const [notes, setNotes] = useState(item.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Initial form values come from `item` via useState above. The parent
  // mounts this component only while open (and unmounts on close), so
  // every reopen is a fresh mount with fresh state — no reset-in-effect
  // is needed, which is what would have tripped react-hooks/set-state-in-effect.

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please give this item a name.");
      return;
    }
    if (!roomId) {
      setError("Please pick a room.");
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateInventoryItemInput = {
        inventoryId: item.id,
        fields: {
          name: trimmedName,
          type,
          room_id: roomId,
          manufacturer: emptyToNull(manufacturer),
          model_number: emptyToNull(modelNumber),
          serial_number: emptyToNull(serialNumber),
          installed_on: dateOrNull(installedOn),
          last_serviced_on: dateOrNull(lastServicedOn),
          next_service_due_on: dateOrNull(nextServiceDueOn),
          notes: emptyToNull(notes),
        },
      };
      const result = await updateInventoryItemAction(payload);
      if (result.error || !result.data) {
        setError(result.error ?? "We couldn't save your changes. Try again.");
        return;
      }
      // Re-run server components so the detail view re-fetches.
      router.refresh();
      onSaved({ researchInvalidated: result.data.researchInvalidated });
      onClose();
    } catch (err) {
      console.error("inventory edit save failed", err);
      setError("Something went wrong saving. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm({
    cascadeDocuments,
  }: {
    cascadeDocuments: boolean;
  }) {
    setDeleteError(null);
    setDeletePending(true);
    try {
      const result = await deleteInventoryItemAction({
        inventoryId: item.id,
        cascadeDocuments,
      });
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      // Parent handles navigation away; close the modals first.
      setDeleteOpen(false);
      onClose();
      onDeleted();
    } catch (err) {
      console.error("inventory delete failed", err);
      setDeleteError("Something went wrong deleting. Try again.");
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
          if (e.target === e.currentTarget && !saving && !deleteOpen) {
            onClose();
          }
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
                <div className="eyebrow mb-1">Edit details</div>
                <h2 id={titleId} className="h2 mt-0.5 truncate">
                  {item.name}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn btn-ghost btn-icon"
                aria-label="Close edit inventory item"
              >
                <Icon name="x" size={18} />
              </button>
            </header>

            <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-5 flex-1">
              <SectionHeading
                title="Identity"
                hint="How this item is named and identified."
              />
              <FieldText
                label="Name"
                value={name}
                onChange={setName}
                placeholder="e.g. Carrier furnace"
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <FieldText
                  label="Manufacturer"
                  value={manufacturer}
                  onChange={setManufacturer}
                  placeholder="e.g. Whirlpool"
                />
                <FieldText
                  label="Model number"
                  value={modelNumber}
                  onChange={setModelNumber}
                  placeholder="e.g. WFG361LFQ"
                />
                <FieldText
                  label="Serial number"
                  value={serialNumber}
                  onChange={setSerialNumber}
                  placeholder="e.g. 1234567890"
                />
              </div>

              <SectionHeading
                title="Classification"
                hint="Re-categorize if the upload-time guess was wrong."
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <FieldSelect
                  label="Type"
                  value={type}
                  onChange={(v) => setType(v as EquipmentType)}
                  options={[
                    { value: "appliance", label: "Appliance" },
                    { value: "system", label: "System" },
                    { value: "exterior", label: "Exterior" },
                  ]}
                />
                <FieldSelect
                  label="Room"
                  value={roomId}
                  onChange={setRoomId}
                  options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                />
              </div>

              <SectionHeading
                title="Service tracking"
                hint="When this item was installed and serviced."
              />
              <div className="grid sm:grid-cols-3 gap-4">
                <FieldDate
                  label="Installed"
                  value={installedOn}
                  onChange={setInstalledOn}
                />
                <FieldDate
                  label="Last serviced"
                  value={lastServicedOn}
                  onChange={setLastServicedOn}
                />
                <FieldDate
                  label="Next due"
                  value={nextServiceDueOn}
                  onChange={setNextServiceDueOn}
                />
              </div>

              <SectionHeading
                title="Notes"
                hint="Anything else worth remembering."
              />
              <div>
                <label className="label sr-only">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input"
                  rows={3}
                  placeholder="Where you bought it, who installed it, quirks…"
                  style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }}
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
                  style={{ color: "var(--color-danger)" }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            <footer
              className="flex flex-wrap items-center justify-end gap-2 p-3 sm:p-4 shrink-0"
              style={{
                borderTop: "1px solid var(--color-border-subtle)",
                backgroundColor: "var(--color-bg-surface)",
              }}
            >
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
            </footer>
          </form>
        </div>
      </div>

      {deleteOpen ? (
        <DeleteInventoryItemConfirmModal
          open
          itemLabel={item.name}
          linkedDocumentCount={linkedDocumentCount}
          pending={deletePending}
          error={deleteError}
          onCancel={() => {
            if (deletePending) return;
            setDeleteOpen(false);
            // Return focus to the danger-zone button after cancel so the
            // user can re-trigger easily; mirrors EditHome's return-focus.
            requestAnimationFrame(() => deleteTriggerRef.current?.focus());
          }}
          onConfirm={handleDeleteConfirm}
        />
      ) : null}
    </>
  );
}

function SectionHeading({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div>
      <div
        className="eyebrow"
        style={{ letterSpacing: "1.2px", fontSize: 10 }}
      >
        {title}
      </div>
      {hint ? (
        <div
          className="text-small"
          style={{ color: "var(--color-text-tertiary)", marginTop: 2 }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DangerZone({
  triggerRef,
  disabled,
  onDelete,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onDelete: () => void;
}) {
  // GitHub-style danger zone: a red-tinted bordered region clearly
  // separated from the rest of the form so the user can't fat-finger
  // a destructive action while editing fields.
  return (
    <div
      className="mt-2"
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid color-mix(in oklab, var(--color-danger) 50%, transparent)",
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
      <div
        className="flex flex-wrap items-center justify-between gap-3 mt-2"
      >
        <div className="min-w-0">
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Delete this item
          </div>
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Removes the item from your inventory. You&apos;ll be asked what to
            do with any linked documents.
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
          Delete…
        </button>
      </div>
    </div>
  );
}
