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
  | DeltaExtraction;

export type EquipmentType = "appliance" | "system" | "exterior";

export type NameplateExtraction = {
  mode: "classification";
  photo_kind: "nameplate";
  classification: {
    name: string;
    type: EquipmentType;
    confidence: number;
  };
  extracted: {
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
    notes: string | null;
  };
  room_suggestion: string | null;
};

export type AppliancePhotoExtraction = {
  mode: "classification";
  photo_kind: "appliance_photo";
  classification: {
    name: string;
    type: EquipmentType;
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
