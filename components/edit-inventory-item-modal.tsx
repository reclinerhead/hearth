"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteInventoryItemAction } from "@/app/actions/inventory/delete-item";
import {
  updateInventoryItemAction,
  type UpdateInventoryItemInput,
} from "@/app/actions/inventory/update-item";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import {
  parsePetMetadata,
  parseVehicleMetadata,
} from "@/lib/inventory/metadata-schemas";
import type { EquipmentType, InventorySubtype } from "@/types/document";
import { DatePicker } from "./date-picker";
import { DeleteInventoryItemConfirmModal } from "./delete-inventory-item-confirm-modal";
import { Icon } from "./icon";
import { MonthPicker } from "./month-picker";

/**
 * Modal edit surface for a single hearth.inventory row. Triggered from
 * the EDIT DETAILS button on /inventory/[id] (issue #57, extended by
 * issue #105). Reuses the conventions established by EditHomeDetailsModal:
 * scroll-lock, focus-trap, ESC, return-focus, ai-surface styling,
 * label/input helpers.
 *
 * Owns four things in addition to the standard edit form:
 *  - A type select (re-classifying mis-detected items) and a room
 *    select (relocating mis-categorized items) — both are common
 *    failure modes of the upload-time AI classification.
 *  - A manufacture-date (month input) parallel to the decoded value
 *    written by the serial-decode pipeline (issue #77). A user-entered
 *    value writes confidence='high' / model='user-entered' so the
 *    detail page's "Manufactured" tile fallback flows through unchanged.
 *  - A hero-photo selector (issue #105) — thumbnails of every attached
 *    `nameplate`/`photo` document; tapping one sets the row's
 *    `hero_document_id`. NULL means fall back to the "most-recently
 *    attached" rule the detail page and dashboard tile already use.
 *  - A danger zone footer with the DELETE button that mounts the
 *    nested DeleteInventoryItemConfirmModal.
 *  - A `researchInvalidated` signal back to the parent: when the user
 *    edits manufacturer / model_number, the previously stored
 *    "Research this model" insights are stale and the panel should be
 *    re-run. The decision is made by the server action's pure helper;
 *    the parent uses the returned flag to kick off researchInventoryModelAction.
 *
 * The modal intentionally does NOT close on backdrop click — accidental
 * outside-clicks while editing fields used to wipe in-progress work
 * (issue #105). ESC, the X button, and Cancel are the only close paths.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export type EditableInventoryRow = {
  id: string;
  name: string;
  type: EquipmentType;
  subtype: InventorySubtype | null;
  room_id: string;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_on: string | null;
  last_serviced_on: string | null;
  next_service_due_on: string | null;
  // Property-friendly columns (issue #23). Always present on the row;
  // only edited when type='property' in the UI.
  purchased_on: string | null;
  estimated_value_cents: number | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  manufacture_date: string | null;
  hero_document_id: string | null;
};

export type EditInventoryItemRoomOption = {
  id: string;
  name: string;
};

/**
 * Every attached `nameplate` / `photo` document for the item, in the
 * detail page's read order (analyzed_at desc, created_at desc). The
 * hero-photo section in the modal renders these as a wrapping strip;
 * `id` is what gets persisted into `inventory.hero_document_id` when
 * the user picks one. The parent fetches the list server-side so the
 * modal stays a pure render of its props.
 */
export type EditInventoryItemPhoto = {
  id: string;
  thumbnailPath: string;
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

// Currency input helpers. We persist cents (bigint at the DB layer)
// but show dollars in the input — so the user types "65,000" or
// "$65000.50" and we coerce on save. Strip every character that
// isn't a digit or decimal, keep at most two decimal places, and
// multiply up. Empty / unparseable inputs become null.
function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function centsFromDollarString(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  // Strip $, commas, whitespace. Allow a single decimal point.
  const cleaned = trimmed.replace(/[^0-9.]/g, "");
  if (cleaned === "") return null;
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

// Pet date inputs land in metadata as bare YYYY-MM-DD strings; reuse
// the DatePicker's wire format so the same lenient prefill works.
function isoDateOrUndefined(s: string): string | undefined {
  const trimmed = s.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function EditInventoryItemModal({
  open,
  item,
  rooms,
  photos,
  linkedDocumentCount,
  isHouse = false,
  onClose,
  onSaved,
  onDeleted,
  getReturnFocusElement,
}: {
  open: boolean;
  item: EditableInventoryRow;
  rooms: EditInventoryItemRoomOption[];
  /**
   * True for the built-in "House" item (issue #306). Hides the
   * classification (type/room) and service-date fields — none apply to
   * the property itself — and hides the danger zone so the house item
   * can't be re-typed or deleted. Only Name, Notes, and Hero photo remain.
   */
  isHouse?: boolean;
  /**
   * Every attached photo for this item, ordered by analyzed_at desc /
   * created_at desc. Empty when the item has no photos yet — the Hero
   * photo section then hides itself entirely.
   */
  photos: EditInventoryItemPhoto[];
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
  const [subtype, setSubtype] = useState<InventorySubtype | null>(item.subtype);
  const [roomId, setRoomId] = useState(item.room_id);
  const [manufacturer, setManufacturer] = useState(item.manufacturer ?? "");
  const [modelNumber, setModelNumber] = useState(item.model_number ?? "");
  const [serialNumber, setSerialNumber] = useState(item.serial_number ?? "");
  // Property fields.
  const [purchasedOn, setPurchasedOn] = useState(
    dateInputValue(item.purchased_on),
  );
  // We keep the user's "$" input as a string so a half-typed value
  // ("3,") doesn't round to gibberish mid-edit. centsFromDollarString
  // converts on save and tolerates the symbols a person actually types.
  const [estimatedValueInput, setEstimatedValueInput] = useState(
    item.estimated_value_cents !== null
      ? dollarsFromCents(item.estimated_value_cents)
      : "",
  );

  // Subtype-specific metadata fields. We use the parsed values as the
  // initial state and write back through a single metadata object on
  // save. Keeping each field as its own piece of state (rather than a
  // big metadata bag) avoids cascading re-renders and lets each input
  // own its keystroke cadence.
  const initialVehicleMetadata = useMemo(
    () => parseVehicleMetadata(item.metadata),
    [item.metadata],
  );
  const initialPetMetadata = useMemo(
    () => parsePetMetadata(item.metadata),
    [item.metadata],
  );
  const [licensePlate, setLicensePlate] = useState(
    initialVehicleMetadata.license_plate ?? "",
  );
  const [licensePlateState, setLicensePlateState] = useState(
    initialVehicleMetadata.license_plate_state ?? "",
  );
  const [modelYear, setModelYear] = useState(
    initialVehicleMetadata.model_year
      ? String(initialVehicleMetadata.model_year)
      : "",
  );
  const [purchasedFrom, setPurchasedFrom] = useState(
    initialVehicleMetadata.purchased_from ?? "",
  );
  const [petSpecies, setPetSpecies] = useState(
    initialPetMetadata.species ?? "",
  );
  const [petBreed, setPetBreed] = useState(initialPetMetadata.breed ?? "");
  const [petMicrochip, setPetMicrochip] = useState(
    initialPetMetadata.microchip_number ?? "",
  );
  const [petVet, setPetVet] = useState(initialPetMetadata.vet_name ?? "");
  const [petAdoptedOn, setPetAdoptedOn] = useState(
    initialPetMetadata.adopted_on ?? "",
  );
  // MonthPicker is lenient about its initial value: `YYYY-MM` prefills
  // exact, `YYYY` (legacy decoded values) renders as January of that
  // year, and anything else (ISO week, malformed) falls through to no
  // selection. Passing the raw column value preserves whatever decoded
  // form the row currently holds until the user picks an explicit
  // month and overwrites it.
  const [manufactureDate, setManufactureDate] = useState(
    item.manufacture_date ?? "",
  );
  const [installedOn, setInstalledOn] = useState(dateInputValue(item.installed_on));
  const [lastServicedOn, setLastServicedOn] = useState(
    dateInputValue(item.last_serviced_on),
  );
  const [nextServiceDueOn, setNextServiceDueOn] = useState(
    dateInputValue(item.next_service_due_on),
  );
  const [notes, setNotes] = useState(item.notes ?? "");
  // Defensive: if the stored hero_document_id points at a document the
  // current `photos` list doesn't contain (e.g. the chosen photo was
  // deleted and the FK SET NULL hasn't propagated to the read yet, or
  // the photo dropped out of the kind filter), treat the form state as
  // "none selected" so we don't show a phantom highlight on a thumbnail
  // that isn't visible.
  const [heroDocumentId, setHeroDocumentId] = useState<string | null>(() => {
    if (!item.hero_document_id) return null;
    return photos.some((p) => p.id === item.hero_document_id)
      ? item.hero_document_id
      : null;
  });

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
      // Build the metadata bag based on the (possibly changed) type +
      // subtype. Toggling property → appliance throws away the bag
      // entirely; toggling between subtypes within property hands the
      // unused side's metadata to oblivion as well. Both are intended:
      // the data is meaningful only in the subtype it was captured for.
      let metadata: Record<string, unknown> | undefined;
      if (type === "property" && subtype === "vehicle") {
        const vehicle: Record<string, unknown> = {};
        const plate = emptyToNull(licensePlate);
        if (plate) vehicle.license_plate = plate.toUpperCase();
        const stateAbbr = emptyToNull(licensePlateState);
        if (stateAbbr) vehicle.license_plate_state = stateAbbr.toUpperCase();
        const yearParsed = modelYear.trim()
          ? parseInt(modelYear.trim(), 10)
          : null;
        if (yearParsed && yearParsed >= 1900 && yearParsed <= 2100) {
          vehicle.model_year = yearParsed;
        }
        const from = emptyToNull(purchasedFrom);
        if (from) vehicle.purchased_from = from;
        // Preserve any vin_decode payload the row already carries —
        // it's read-only from the modal's perspective, owned by the
        // /decode-vin route, and we shouldn't drop it on a regular save.
        const existing = parseVehicleMetadata(item.metadata);
        if (existing.vin_decode) vehicle.vin_decode = existing.vin_decode;
        if (existing.purchase_price_cents)
          vehicle.purchase_price_cents = existing.purchase_price_cents;
        metadata = vehicle;
      } else if (type === "property" && subtype === "pet") {
        const pet: Record<string, unknown> = {};
        const species = emptyToNull(petSpecies);
        if (species) pet.species = species;
        const breed = emptyToNull(petBreed);
        if (breed) pet.breed = breed;
        const microchip = emptyToNull(petMicrochip);
        if (microchip) pet.microchip_number = microchip;
        const vet = emptyToNull(petVet);
        if (vet) pet.vet_name = vet;
        const adopted = isoDateOrUndefined(petAdoptedOn);
        if (adopted) pet.adopted_on = adopted;
        metadata = pet;
      } else if (type === "property") {
        // subtype=null property: preserve any existing metadata as-is
        // so a Phase-2 surface can light up without losing data.
        metadata = item.metadata ?? {};
      } else {
        // Non-property: drop metadata entirely (DB column defaults to
        // '{}'::jsonb on inserts and this clears any stale bag from a
        // prior property classification).
        metadata = {};
      }

      const payload: UpdateInventoryItemInput = {
        inventoryId: item.id,
        fields: {
          name: trimmedName,
          type,
          subtype: type === "property" ? subtype : null,
          room_id: roomId,
          manufacturer: emptyToNull(manufacturer),
          model_number: emptyToNull(modelNumber),
          serial_number: emptyToNull(serialNumber),
          manufacture_date: emptyToNull(manufactureDate),
          installed_on: dateOrNull(installedOn),
          last_serviced_on: dateOrNull(lastServicedOn),
          next_service_due_on: dateOrNull(nextServiceDueOn),
          purchased_on: dateOrNull(purchasedOn),
          estimated_value_cents: centsFromDollarString(estimatedValueInput),
          metadata,
          notes: emptyToNull(notes),
          hero_document_id: heroDocumentId,
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
        // Intentionally no onClick on the backdrop — accidental outside
        // clicks while editing fields used to wipe in-progress work.
        // ESC, the X, and Cancel are the only close paths.
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="surface-ai relative w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden"
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
              <FieldText
                label="Name"
                value={name}
                onChange={setName}
                placeholder="e.g. Carrier furnace"
              />
              {/* Nameplate identity + classification don't apply to the
                  house item (issue #306) — it's the property itself, not a
                  make/model/room-scoped thing. Hidden so its edit surface
                  is just Name, Notes, and Hero photo. */}
              {isHouse ? null : (
                <>
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
                      onChange={(v) => {
                        const next = v as EquipmentType;
                        setType(next);
                        // Drop the subtype when leaving property so the
                        // form state stays semantically honest. Toggling
                        // back to property leaves the user re-picking a
                        // subtype, which matches the "no implicit default"
                        // rule for discriminators.
                        if (next !== "property") setSubtype(null);
                      }}
                      options={[
                        { value: "appliance", label: "Appliance" },
                        { value: "system", label: "System" },
                        { value: "exterior", label: "Exterior" },
                        { value: "property", label: "Property" },
                      ]}
                    />
                    <FieldSelect
                      label="Room"
                      value={roomId}
                      onChange={setRoomId}
                      options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </div>
                </>
              )}

              {type === "property" ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  <FieldSelect
                    label="Property kind"
                    value={subtype ?? ""}
                    onChange={(v) =>
                      setSubtype(v === "" ? null : (v as InventorySubtype))
                    }
                    options={[
                      { value: "", label: "Other (electronics, art, etc.)" },
                      { value: "vehicle", label: "Vehicle" },
                      { value: "pet", label: "Pet" },
                    ]}
                  />
                </div>
              ) : null}

              {type === "property" ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <DatePicker
                    label="Purchased"
                    value={purchasedOn}
                    onChange={setPurchasedOn}
                  />
                  <div>
                    <label className="label">Estimated value</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={estimatedValueInput}
                      onChange={(e) => setEstimatedValueInput(e.target.value)}
                      className="input"
                      placeholder="$0"
                    />
                  </div>
                  <MonthPicker
                    label="Manufactured"
                    value={manufactureDate}
                    onChange={setManufactureDate}
                    placeholder="Pick a month"
                  />
                </div>
              ) : isHouse ? null : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MonthPicker
                    label="Manufactured"
                    value={manufactureDate}
                    onChange={setManufactureDate}
                    placeholder="Pick a month"
                  />
                  <DatePicker
                    label="Installed"
                    value={installedOn}
                    onChange={setInstalledOn}
                  />
                  <DatePicker
                    label="Last serviced"
                    value={lastServicedOn}
                    onChange={setLastServicedOn}
                  />
                  <DatePicker
                    label="Next due"
                    value={nextServiceDueOn}
                    onChange={setNextServiceDueOn}
                  />
                </div>
              )}

              {type === "property" && subtype === "vehicle" ? (
                <div className="flex flex-col gap-3">
                  <SectionHeading title="Vehicle details" />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <FieldText
                      label="Model year"
                      value={modelYear}
                      onChange={setModelYear}
                      placeholder="e.g. 2018"
                    />
                    <FieldText
                      label="License plate"
                      value={licensePlate}
                      onChange={setLicensePlate}
                      placeholder="e.g. ABC-1234"
                    />
                    <FieldText
                      label="Plate state"
                      value={licensePlateState}
                      onChange={(v) => setLicensePlateState(v.slice(0, 2))}
                      placeholder="e.g. MI"
                    />
                    <FieldText
                      label="Purchased from"
                      value={purchasedFrom}
                      onChange={setPurchasedFrom}
                      placeholder="Dealer, seller, or marketplace"
                    />
                  </div>
                </div>
              ) : null}

              {type === "property" && subtype === "pet" ? (
                <div className="flex flex-col gap-3">
                  <SectionHeading title="Pet details" />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FieldText
                      label="Species"
                      value={petSpecies}
                      onChange={setPetSpecies}
                      placeholder="Dog, cat, fish…"
                    />
                    <FieldText
                      label="Breed"
                      value={petBreed}
                      onChange={setPetBreed}
                      placeholder="Optional"
                    />
                    <DatePicker
                      label="Adopted"
                      value={petAdoptedOn}
                      onChange={setPetAdoptedOn}
                    />
                    <FieldText
                      label="Microchip number"
                      value={petMicrochip}
                      onChange={setPetMicrochip}
                      placeholder="Optional"
                    />
                    <FieldText
                      label="Vet name"
                      value={petVet}
                      onChange={setPetVet}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              ) : null}

              <SectionHeading title="Notes" />
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

              {photos.length > 0 ? (
                <HeroPhotoSection
                  photos={photos}
                  selectedId={heroDocumentId}
                  onSelect={setHeroDocumentId}
                />
              ) : null}

              {/* The house item is built-in and permanent — no delete
                  path (issue #306). */}
              {isHouse ? null : (
                <DangerZone
                  triggerRef={deleteTriggerRef}
                  disabled={saving}
                  onDelete={() => setDeleteOpen(true)}
                />
              )}

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

function HeroPhotoSection({
  photos,
  selectedId,
  onSelect,
}: {
  photos: EditInventoryItemPhoto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  // A thin wrapping flex row — desktop with `max-w-3xl` fits ~8 thumbnails
  // per row before wrapping. The strip is intentionally not horizontally
  // scrollable: wrapping keeps every photo discoverable without a hidden
  // overflow that some users won't think to drag.
  return (
    <div className="flex flex-col gap-2">
      <SectionHeading
        title="Hero photo"
        hint="Pick which photo represents this item."
      />
      <div className="flex flex-wrap gap-2">
        {photos.map((photo) => (
          <HeroPhotoThumb
            key={photo.id}
            photo={photo}
            selected={photo.id === selectedId}
            onSelect={() =>
              onSelect(selectedId === photo.id ? null : photo.id)
            }
          />
        ))}
      </div>
      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Or leave unselected to use your most recent photo.
      </p>
    </div>
  );
}

function HeroPhotoThumb({
  photo,
  selected,
  onSelect,
}: {
  photo: EditInventoryItemPhoto;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = useCachedSignedUrl("hearth-documents", photo.thumbnailPath, null);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={selected ? "Hero photo (selected)" : "Choose as hero photo"}
      className="relative overflow-hidden"
      style={{
        width: 80,
        height: 80,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
        padding: 0,
        boxShadow: selected ? "0 0 0 2px var(--color-accent)" : undefined,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="block w-full h-full object-cover"
        />
      ) : null}
      {selected ? (
        <span
          aria-hidden
          className="absolute flex items-center justify-center"
          style={{
            top: 4,
            right: 4,
            width: 18,
            height: 18,
            borderRadius: 999,
            color: "var(--color-bg-base)",
            backgroundColor: "var(--color-accent)",
          }}
        >
          <svg
            width={11}
            height={11}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 5 5 9-10" />
          </svg>
        </span>
      ) : null}
    </button>
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
