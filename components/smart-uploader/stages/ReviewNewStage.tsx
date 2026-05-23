"use client";

import { useEffect, useMemo, useState } from "react";
import { attachDocumentToInventoryAction } from "@/app/actions/documents/attach-document-to-inventory";
import { createInventoryFromDocumentAction } from "@/app/actions/documents/create-inventory-from-document";
import type { MatchingInventoryItem } from "@/app/actions/documents/find-matching-inventory";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/client";
import type {
  AppliancePhotoExtraction,
  EquipmentType,
  InventorySubtype,
  NameplateExtraction,
} from "@/types/document";
import { pickDefaultRoomId } from "../match-room";

const SIGNED_URL_TTL_SECONDS = 300;

// The server-side env var is read by analyzeNameplateAction (1.3); the
// modal mirrors the same default so the low-confidence headline copy
// can fire without round-tripping the value. If we tighten the
// threshold server-side we update this constant in lockstep — it's
// documented in the technical guide as a contract.
const NAMEPLATE_CONFIDENCE_THRESHOLD = 0.6;

export type SeededRoomOption = { id: string; name: string };

export function ReviewNewStage({
  documentId,
  analysis,
  matches,
  rooms,
  onSaved,
  onCancel,
}: {
  documentId: string;
  /** Null for the manual-entry branch out of analysis-failed. */
  analysis: NameplateExtraction | AppliancePhotoExtraction | null;
  matches: MatchingInventoryItem[];
  rooms: SeededRoomOption[];
  onSaved: (inventoryId: string) => void;
  onCancel: () => void;
}) {
  const isManual = analysis === null;
  const isNameplate =
    analysis?.mode === "classification" && analysis.photo_kind === "nameplate";

  const defaultName = analysis?.classification?.name ?? "";
  const defaultType: EquipmentType = analysis?.classification?.type ?? "appliance";
  const defaultSubtype: InventorySubtype | null =
    analysis?.classification?.subtype ?? null;
  const roomSuggestion = analysis?.room_suggestion ?? null;
  const confidence = analysis?.classification?.confidence ?? null;

  const lowConfidence =
    confidence !== null && confidence < NAMEPLATE_CONFIDENCE_THRESHOLD;

  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<EquipmentType>(defaultType);
  const [subtype, setSubtype] = useState<InventorySubtype | null>(
    defaultSubtype,
  );
  const [manufacturer, setManufacturer] = useState(
    isNameplate ? (analysis as NameplateExtraction).extracted.manufacturer ?? "" : "",
  );
  const [modelNumber, setModelNumber] = useState(
    isNameplate ? (analysis as NameplateExtraction).extracted.model_number ?? "" : "",
  );
  const [serialNumber, setSerialNumber] = useState(
    isNameplate ? (analysis as NameplateExtraction).extracted.serial_number ?? "" : "",
  );
  const [installedOn, setInstalledOn] = useState(
    isNameplate ? (analysis as NameplateExtraction).extracted.installed_on ?? "" : "",
  );
  const [notes, setNotes] = useState(
    isNameplate ? (analysis as NameplateExtraction).extracted.notes ?? "" : "",
  );

  const defaultRoomId = useMemo(
    () => pickDefaultRoomId({ rooms, suggestion: roomSuggestion, type: defaultType }),
    [rooms, roomSuggestion, defaultType],
  );
  const [roomId, setRoomId] = useState<string | null>(defaultRoomId);
  useEffect(() => {
    // Rooms can load after the stage mounts; reset to the computed
    // default once the list arrives. Legitimate "synchronize with
    // external system (rooms loaded async)" use of useEffect+setState.
    if (roomId === null && defaultRoomId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoomId(defaultRoomId);
    }
  }, [defaultRoomId, roomId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMatchPicker, setShowMatchPicker] = useState(matches.length > 0);

  // Thumbnail for the new document's optimized image.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: doc } = await supabase
        .from("documents")
        .select("thumbnail_path")
        .eq("id", documentId)
        .maybeSingle();
      if (cancelled || !doc) return;
      const { data: signed } = await supabase.storage
        .from(HEARTH_DOCUMENTS_BUCKET)
        .createSignedUrl(doc.thumbnail_path, SIGNED_URL_TTL_SECONDS);
      if (cancelled) return;
      setThumbUrl(signed?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function handleAttachToMatch(match: MatchingInventoryItem) {
    setError(null);
    setSaving(true);
    try {
      const result = await attachDocumentToInventoryAction({
        documentId,
        inventoryId: match.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved(match.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Please give this item a name.");
      return;
    }
    if (!roomId) {
      setError("Please pick a room.");
      return;
    }
    setSaving(true);
    try {
      const result = await createInventoryFromDocumentAction({
        documentId,
        name: name.trim(),
        type,
        // subtype is only meaningful for property; server defends
        // against stale UI state anyway, but we send the honest value
        // here so the create path matches the edit path.
        subtype: type === "property" ? subtype : null,
        roomId,
        fields: {
          manufacturer: emptyToNull(manufacturer),
          model_number: emptyToNull(modelNumber),
          serial_number: emptyToNull(serialNumber),
          installed_on: emptyToNull(installedOn),
          // Smart Uploader doesn't ask for these at capture time — they
          // sit at zero friction in the edit modal where the user can
          // fill them in once they have the receipt or the appraisal.
          purchased_on: null,
          estimated_value_cents: null,
        },
        // Empty metadata bag at create-time. The Edit modal is where
        // vehicle plates, pet microchip numbers, etc. land.
        metadata: {},
        notes: emptyToNull(notes),
      });
      if (result.error || !result.data) {
        setError(result.error ?? "We couldn't save that. Try again.");
        return;
      }
      onSaved(result.data.inventoryId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!isManual && showMatchPicker && matches.length > 0 ? (
        <div
          className="surface-ai p-3 sm:p-4 flex flex-col gap-3"
          style={{ borderRadius: "var(--radius-md)" }}
        >
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            You already have {indefiniteArticle(defaultName)} {defaultName} in
            your inventory
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {matches.slice(0, 3).map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={saving}
                onClick={() => handleAttachToMatch(m)}
                className="btn btn-primary"
              >
                Add this photo to {m.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMatchPicker(false)}
              disabled={saving}
              className="btn btn-ghost"
            >
              Create new
            </button>
          </div>
        </div>
      ) : null}

      {!isManual ? (
        <div>
          <div className="eyebrow mb-1">
            {lowConfidence ? "We think this might be" : "Looks like"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            {capitalize(defaultName) || "an item"}
            {lowConfidence
              ? ", but we're not sure. Confirm or edit the details below."
              : null}
          </div>
        </div>
      ) : (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Enter the details for this item by hand. You can come back and
          edit them anytime.
        </p>
      )}

      <div className="flex gap-3">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={name || "Selected photo"}
            className="h-20 w-20 rounded-md object-cover shrink-0"
            style={{ border: "1px solid var(--color-border-subtle)" }}
          />
        ) : (
          <div
            className="h-20 w-20 rounded-md shrink-0"
            style={{
              backgroundColor: "var(--color-bg-surface-raised)",
              border: "1px solid var(--color-border-subtle)",
            }}
            aria-hidden
          />
        )}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div>
            <label className="label">Type</label>
            <select
              value={type}
              onChange={(e) => {
                const next = e.target.value as EquipmentType;
                setType(next);
                // Leaving property drops the subtype so we never write
                // a "vehicle" tag onto an appliance row.
                if (next !== "property") setSubtype(null);
              }}
              className="input"
            >
              <option value="appliance">Appliance</option>
              <option value="system">System</option>
              <option value="exterior">Exterior</option>
              <option value="property">Property</option>
            </select>
          </div>
          {type === "property" ? (
            <div>
              <label className="label">Property kind</label>
              <select
                value={subtype ?? ""}
                onChange={(e) =>
                  setSubtype(
                    e.target.value === ""
                      ? null
                      : (e.target.value as InventorySubtype),
                  )
                }
                className="input"
              >
                <option value="">Other (electronics, art, etc.)</option>
                <option value="vehicle">Vehicle</option>
                <option value="pet">Pet</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <label className="label">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="e.g. Carrier furnace"
        />
      </div>

      {isNameplate ? (
        <div className="flex flex-col gap-3">
          <div className="eyebrow">We pulled out these details</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              label="Manufacturer"
              value={manufacturer}
              onChange={setManufacturer}
              placeholder="—"
            />
            <Field
              label="Model"
              value={modelNumber}
              onChange={setModelNumber}
              placeholder="—"
            />
            <Field
              label={
                type === "property" && subtype === "vehicle"
                  ? "VIN"
                  : "Serial"
              }
              value={serialNumber}
              onChange={setSerialNumber}
              placeholder="—"
            />
            <DateField
              label="Installed"
              value={installedOn}
              onChange={setInstalledOn}
            />
          </div>
          {isNameplate &&
          (analysis as NameplateExtraction).extracted.pills.length > 0 ? (
            <ExtractedPills
              pills={(analysis as NameplateExtraction).extracted.pills}
            />
          ) : null}
        </div>
      ) : null}

      <div>
        <label className="label">Where is it?</label>
        <select
          value={roomId ?? ""}
          onChange={(e) => setRoomId(e.target.value || null)}
          className="input"
          disabled={rooms.length === 0}
        >
          {rooms.length === 0 ? (
            <option value="">Loading rooms…</option>
          ) : (
            rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input"
          rows={3}
          placeholder="Anything else worth remembering about this item."
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

      <div className="flex items-center justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn btn-ghost"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? "Saving…" : `Save ${name.trim() || "item"}`}
        </button>
      </div>
    </div>
  );
}

function Field({
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

function DateField({
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

function ExtractedPills({
  pills,
}: {
  pills: NameplateExtraction["extracted"]["pills"];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Also captured
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pills.map((pill, i) => (
          <span key={`${pill.label}-${i}`} className="chip">
            <span style={{ color: "var(--color-text-tertiary)" }}>
              {pill.label}
            </span>
            <span>{pill.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function emptyToNull(s: string): string | null {
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function indefiniteArticle(noun: string): string {
  const first = noun.trim().charAt(0).toLowerCase();
  return "aeiou".includes(first) ? "an" : "a";
}
