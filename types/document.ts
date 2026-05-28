// Document row shape for hearth.documents. Hand-typed to match
// supabase/migrations/20260519091817_create_documents_table.sql.
// Keep in sync with the migration as the schema grows. Pattern mirrors
// types/house.ts — the DB-generated type from `supabase gen types
// typescript` will eventually replace this hand-typed version.

export type DocumentKind =
  | "nameplate"
  | "photo"
  | "receipt"
  | "manual"
  | "permit"
  | "warranty"
  | "invoice"
  | "inspection"
  | "emergency_procedure_video"
  | "water_quality_report"
  | "other";

export type DocumentStatus =
  | "analyzing"
  | "analyzed"
  | "attached"
  | "failed";

// Emergency-video category (issue #139). Backed by a CHECK on
// hearth.documents.emergency_category. Populated only for rows where
// kind = 'emergency_procedure_video'; null on every other kind.
export type EmergencyCategory = "water" | "gas" | "electrical" | "other";

// Storage bucket the row's binary content lives in. Forward-looking
// so a future bucket migration changes this column rather than every
// row's storage_path. Defaults to 'hearth-documents' for non-video
// rows; emergency-video rows always write 'hearth-emergency-videos'.
export type DocumentStorageBucket =
  | "hearth-documents"
  | "hearth-emergency-videos";

export type DocumentRow = {
  id: string;
  house_id: string;
  inventory_id: string | null;
  uploaded_by: string | null;

  kind: DocumentKind;
  status: DocumentStatus;

  storage_path: string;
  thumbnail_path: string;
  content_hash: string | null;
  mime_type: string;
  file_size_bytes: number;
  original_filename: string;

  ai_extraction: AiExtraction | null;
  ai_model: string | null;
  ai_confidence: number | null;
  analyzed_at: string | null;

  notes: string | null;

  // Emergency-video columns (issue #139). Null on every kind except
  // 'emergency_procedure_video'. See the migration's CHECK constraints
  // for the cross-column rules:
  //   - emergency_category is non-null iff kind = 'emergency_procedure_video'
  //   - emergency_is_primary is false on every non-emergency row
  //   - storage_bucket = 'hearth-emergency-videos' iff kind = 'emergency_procedure_video'
  duration_seconds: number | null;
  emergency_category: EmergencyCategory | null;
  emergency_label: string | null;
  emergency_is_primary: boolean;
  poster_storage_path: string | null;
  storage_bucket: DocumentStorageBucket;

  created_at: string;
  updated_at: string;
};

// Shape stored in hearth.documents.ai_extraction (jsonb). Discriminated
// on `mode` then on `photo_kind`, so consumers can narrow safely.
//
// Mode A ("classification"): produced by analyzeNameplateAction when no
//   existingInventoryData is passed. One of three photo_kinds:
//   "nameplate", "appliance_photo", or "not_useful".
//
// Mode B ("delta"): produced when existingInventoryData is passed.
//   Returns only the fields where the new photo adds or contradicts
//   existing inventory data.
export type AiExtraction =
  | NameplateExtraction
  | AppliancePhotoExtraction
  | NotUsefulExtraction
  | DeltaExtraction
  | ReceiptExtraction
  | CcrExtraction;

// The four inventory types backing the hearth.inventory.type CHECK
// constraint. The name `EquipmentType` is historical — `property` is
// not equipment, but renaming the union would churn every existing
// import for little gain. Treat it as "the inventory.type discriminator".
//
// `property` covers things the homeowner *owns* that aren't part of
// the house — vehicles, electronics, instruments, art, tools, jewelry,
// pets. The conveyance line: appliance/system/exterior items convey at
// sale; property leaves with the owner.
export type EquipmentType = "appliance" | "system" | "exterior" | "property";

// Subtype discriminator on hearth.inventory. Nullable; v1 recognizes
// only the two property subtypes below. Other inventory types
// (appliance, system, exterior) always carry subtype=null today.
//
// Future subtypes (electronics, instrument, etc.) extend this union and
// the application-layer routing without requiring a database migration.
export type InventorySubtype = "vehicle" | "pet";

export type NameplateExtractionPill = {
  label: string;
  value: string;
};

export type NameplateExtraction = {
  mode: "classification";
  photo_kind: "nameplate";
  classification: {
    name: string;
    type: EquipmentType;
    // Only set when type='property'. The model returns 'vehicle' for a
    // VIN plate / car badge, 'pet' when the photo is clearly an
    // identifying document for an animal, and null otherwise.
    subtype: InventorySubtype | null;
    confidence: number;
  };
  extracted: {
    manufacturer: string | null;
    model_number: string | null;
    // VINs land here for type='property' / subtype='vehicle' — the
    // Smart Uploader nameplate flow already lands a photographed VIN
    // in this column with no special-case code. The detail page
    // re-labels the field "VIN" when the row is a vehicle.
    serial_number: string | null;
    installed_on: string | null;
    notes: string | null;
    pills: NameplateExtractionPill[];
  };
  room_suggestion: string | null;
};

export type AppliancePhotoExtraction = {
  mode: "classification";
  photo_kind: "appliance_photo";
  classification: {
    name: string;
    type: EquipmentType;
    subtype: InventorySubtype | null;
    confidence: number;
  };
  extracted: null;
  room_suggestion: string | null;
};

export type NotUsefulExtraction = {
  mode: "classification";
  photo_kind: "not_useful";
  classification: null;
  extracted: null;
  room_suggestion: null;
};

export type DeltaExtraction = {
  mode: "delta";
  deltas: Record<
    string,
    {
      currentValue: string | null;
      proposedValue: string;
    }
  >;
  confidence: number;
};

// Receipt extraction (issue #117). Distinct mode from "classification"
// because a receipt has none of the photo_kind branches; the schema is
// a flat structured shape rather than a discriminated union. The raw
// model output is persisted here for provenance; the application-
// curated copy lives in hearth.documents.metadata (parsed via
// receiptMetadataSchema in lib/documents/metadata-schemas.ts).
export type ReceiptLineItem = {
  description: string;
  quantity: number | null;
  unit_price_cents: number | null;
  total_cents: number | null;
};

export type ReceiptExtraction = {
  mode: "receipt";
  vendor_name: string | null;
  vendor_address: string | null;
  vendor_phone: string | null;
  transaction_date: string | null;
  // ISO date when this time-bounded grant lapses (vehicle registration,
  // insurance policy, warranty, permit, license). Null on service /
  // purchase / inspection receipts where expiration isn't a meaningful
  // concept. Seeded into hearth.documents.metadata.expiration_date and
  // consumed downstream by the direct-event maintenance pipeline.
  expiration_date: string | null;
  transaction_type: "service" | "purchase" | "inspection" | "other" | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  payment_method: string | null;
  line_items: ReceiptLineItem[];
  referenced_serials: string[];
  referenced_model_numbers: string[];
  notes: string | null;
  ai_confidence: number;
};

// CCR extraction (issue #176, WQA-3). The full structured shape from
// the model is canonical on `hearth.water_system_reports.extracted_data`
// — that's the shared cache row that benefits every house on the
// utility. The per-document `ai_extraction` JSONB here is the
// provenance breadcrumb: it carries the same extracted payload so the
// document's own page lookup can re-render the extraction without a
// join, plus the report-row id and the dedup reason so the Smart
// Uploader review stage can show "thanks for contributing the first
// upload" vs "matched an existing extraction" without another query.
//
// `extracted` carries the validated payload; see
// lib/documents/ai/ccr-schema.ts for the strict five-section shape and
// the rationale for the deliberately-narrow scope.
import type { CcrExtractionResult } from "@/lib/documents/ai/ccr-schema";

export type CcrDedupReason =
  // First contribution for this (PWSID, year, edition). The
  // extraction landed in water_system_reports under this document's
  // contribution.
  | "first-upload"
  // Byte-identical re-upload of a contribution already on file. No
  // model call ran; the existing extraction was reused. Contributor
  // row was NOT duplicated (the existing one already covers this
  // content_hash).
  | "identical-bytes"
  // Different bytes than any prior contribution, but the (PWSID,
  // year, edition) matched an existing extraction. The existing
  // extraction was reused; a new contributor row records this
  // upload's distinct content_hash. Model call may or may not have
  // run depending on the slice's optimization (today: yes, follow-up
  // slice may skip when the user's UI flow declared the year up
  // front).
  | "same-ccr-different-bytes";

export type CcrExtraction = {
  mode: "ccr";
  /**
   * The shared-cache report this document contributed to. Null
   * between the analyze step (when the model has run but the dedup
   * orchestration hasn't) and the finalize step (when the report
   * row is persisted and the contributor row recorded). Non-null
   * once the document is attached.
   */
  report_id: string | null;
  /** The PWSID that the orchestrator resolved for this document. */
  pwsid: string;
  /**
   * Coverage year for the report. Read from the extracted header
   * metadata during analyze; the finalize step uses it to look up
   * the (PWSID, year, edition) row.
   */
  report_year: number | null;
  /**
   * How the dedup orchestration handled this upload. Null between
   * analyze and finalize for the same reason as `report_id`. Drives
   * the Smart Uploader review-stage acknowledgment copy once set.
   */
  dedup_reason: CcrDedupReason | null;
  /**
   * Validated extraction payload. Identical to
   * `water_system_reports.extracted_data` for the report row. Stored
   * here as a provenance copy so the per-document re-render path
   * doesn't need a second query.
   */
  extracted: CcrExtractionResult;
};
