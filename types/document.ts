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
  | ReceiptExtraction;

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
