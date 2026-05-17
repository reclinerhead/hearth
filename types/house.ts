// House row shape used by the dashboard and the realtime hook. Mirrors the
// columns that are read or rendered today — keep in sync with
// supabase/migrations as the schema grows. The DB-generated type from
// `supabase gen types typescript` will eventually replace this hand-typed
// version (see TechnicalGuide.md).

export type BriefingStatus = "pending" | "running" | "completed" | "failed";

export type House = {
  id: string;
  owner_id: string;
  nickname: string | null;

  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  county: string | null;
  latitude: number;
  longitude: number;

  year_built: number | null;
  living_area_sqft: number | null;
  lot_size_sqft: number | null;
  lot_size_acres: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  heating_summary: string | null;
  cooling_summary: string | null;
  parcel_id: string | null;

  purchase_date: string | null;
  purchase_price_cents: number | null;

  description: string | null;
  description_source: string | null;

  briefing_status: BriefingStatus;
  briefing_started_at: string | null;
  briefing_generated_at: string | null;
  briefing_error: string | null;

  // Generated architectural-sketch placeholder. `generated_image_url`
  // holds the STORAGE PATH within the `house-images` bucket (the bucket
  // is private; the dashboard derives signed URLs at render time).
  // Null until the image step in the briefing pipeline lands the first
  // sketch.
  generated_image_url: string | null;
  generated_image_prompt: string | null;
  generated_image_created_at: string | null;

  created_at: string;
  updated_at: string;
};
