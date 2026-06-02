"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { attachDocumentToInventoryAction } from "@/app/actions/documents/attach-document-to-inventory";
import { createInventoryFromDocumentAction } from "@/app/actions/documents/create-inventory-from-document";
import type { MatchingInventoryItem } from "@/app/actions/documents/find-matching-inventory";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/client";
import { isValidVinFormat, type VinDecodeResult } from "@/lib/vin-decode/decode";
import { isGenericVehicleName, type VinPrefill } from "@/lib/vin-decode/prefill";
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

  // Auto VIN decode (issue #274). When the extraction recognized a
  // vehicle and pulled a valid-looking VIN out of the photo, decode it
  // through NHTSA the moment this stage opens and prefill the empty
  // Manufacturer / Model / Name fields — no separate trip to the detail
  // page to click "Decode VIN". The raw decode is held so the Save path
  // can persist it (plus model_year) into inventory.metadata, matching
  // what the detail-page button would have produced. Failures are
  // silent: the form still works and the detail-page button remains the
  // manual fallback.
  const extractedVin = isNameplate
    ? (analysis as NameplateExtraction).extracted.serial_number
    : null;
  const isVehicleExtraction =
    defaultType === "property" && defaultSubtype === "vehicle";
  const shouldAutoDecode =
    isVehicleExtraction && isValidVinFormat(extractedVin);

  const [vinDecodeStatus, setVinDecodeStatus] = useState<
    "idle" | "decoding" | "done"
  >("idle");
  const [vinDecodeResult, setVinDecodeResult] = useState<VinDecodeResult | null>(
    null,
  );
  const [vinPrefill, setVinPrefill] = useState<VinPrefill | null>(null);
  const decodeStartedRef = useRef(false);

  useEffect(() => {
    // `decodeStartedRef` is the one-shot guard: the deps below never
    // change during this stage's life, so the only thing that re-fires
    // this effect is React StrictMode's dev-only double-invoke. The ref
    // makes the fetch run exactly once and survive that double-invoke.
    //
    // Deliberately NO cleanup-based cancellation here. An earlier version
    // flipped a `cancelled` flag in the effect cleanup; under StrictMode
    // that cleanup ran between the two mounts and permanently cancelled
    // the single fetch the ref-guard allows, so the result was ignored
    // and "Reading your VIN…" never cleared. The ref-guard already
    // prevents duplicate work; a setState after a genuine unmount (modal
    // closed mid-decode) is a harmless no-op in React 18.
    if (!shouldAutoDecode || decodeStartedRef.current) return;
    decodeStartedRef.current = true;
    const vin = (extractedVin ?? "").trim();
    setVinDecodeStatus("decoding");
    (async () => {
      try {
        const res = await fetch("/api/vin/decode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vin }),
        });
        if (!res.ok) throw new Error(`decode failed: ${res.status}`);
        const body = (await res.json()) as {
          result: VinDecodeResult;
          prefill: VinPrefill;
        };
        const { prefill } = body;
        // Prefill only empty fields — anything the user already edited
        // while the decode was in flight wins. The name is rewritten
        // only when it's still a generic placeholder ("Vehicle", "Truck").
        if (prefill.manufacturer) {
          setManufacturer((prev) => (prev.trim() ? prev : prefill.manufacturer ?? ""));
        }
        if (prefill.model) {
          setModelNumber((prev) => (prev.trim() ? prev : prefill.model ?? ""));
        }
        if (prefill.displayName) {
          setName((prev) =>
            isGenericVehicleName(prev) ? prefill.displayName ?? prev : prev,
          );
        }
        setVinDecodeResult(body.result);
        setVinPrefill(prefill);
        setVinDecodeStatus("done");
      } catch {
        // Silent — the manual detail-page Decode VIN button is the
        // fallback. Reset to idle so no banner renders.
        setVinDecodeStatus("idle");
      }
    })();
  }, [shouldAutoDecode, extractedVin]);

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
        // Metadata bag at create-time. Normally empty — the Edit modal
        // is where vehicle plates, pet microchip numbers, etc. land. The
        // exception is an auto-decoded VIN: persist the raw decode and
        // model_year here (only while the item is still a vehicle) so
        // the saved row matches what the detail-page Decode VIN button
        // would have produced — Model year tile and decoded pills with
        // no extra click.
        metadata: buildSaveMetadata({
          type,
          subtype,
          vinDecodeResult,
          modelYear: vinPrefill?.modelYear ?? null,
        }),
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

  // What to brag about in the success banner: the composed
  // "YYYY Make Model" when we have it, else whatever make/model landed.
  // Null when the decode came back without anything nameable, in which
  // case the banner stays hidden (nothing to celebrate).
  const vinDecodeTitle = vinPrefill
    ? vinPrefill.displayName ??
      ([vinPrefill.manufacturer, vinPrefill.model]
        .filter(Boolean)
        .join(" ") ||
        null)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {vinDecodeStatus === "decoding" ? (
        <div
          className="flex items-center gap-2 text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <SparkleIcon spinning />
          <span>Reading your VIN…</span>
        </div>
      ) : null}

      {vinDecodeStatus === "done" && vinDecodeTitle ? (
        <div
          className="flex items-start gap-3 p-3 sm:p-4"
          style={{
            borderRadius: "var(--radius-md)",
            background:
              "color-mix(in oklab, var(--color-accent) 12%, transparent)",
            border:
              "1px solid color-mix(in oklab, var(--color-accent) 38%, transparent)",
          }}
          role="status"
        >
          <span
            style={{ color: "var(--color-accent)", marginTop: 2 }}
            aria-hidden
          >
            <SparkleIcon />
          </span>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="eyebrow" style={{ color: "var(--color-accent)" }}>
              VIN decoded automatically
            </div>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              {vinDecodeTitle}
            </div>
            <div
              className="text-small"
              style={{ color: "var(--color-text-secondary)" }}
            >
              We filled in the details below from your VIN — review them and
              save.
            </div>
          </div>
        </div>
      ) : null}

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

// Assemble the metadata bag written at create-time. Empty for every
// item except an auto-decoded vehicle, where we persist the raw VIN
// decode and model_year so the saved row matches the detail-page decode
// (issue #274). Defends against stale UI state: if the user flipped the
// item away from property/vehicle after the decode ran, no vehicle
// metadata is written.
function buildSaveMetadata(args: {
  type: EquipmentType;
  subtype: InventorySubtype | null;
  vinDecodeResult: VinDecodeResult | null;
  modelYear: number | null;
}): Record<string, unknown> {
  const { type, subtype, vinDecodeResult, modelYear } = args;
  if (type !== "property" || subtype !== "vehicle" || !vinDecodeResult) {
    return {};
  }
  const metadata: Record<string, unknown> = { vin_decode: vinDecodeResult };
  if (modelYear !== null) metadata.model_year = modelYear;
  return metadata;
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

// Four-point sparkle — the AI-enrichment glyph used elsewhere in the
// app (the detail-page Decode VIN button). `spinning` adds a gentle
// pulse for the in-flight "Reading your VIN…" line.
function SparkleIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-pulse" : undefined}
      aria-hidden
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </svg>
  );
}
