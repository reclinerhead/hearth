// House row shape used by the dashboard and the realtime hook. Mirrors the
// columns that are read or rendered today — keep in sync with
// supabase/migrations as the schema grows. The DB-generated type from
// `supabase gen types typescript` will eventually replace this hand-typed
// version (see TechnicalGuide.md).

export type BriefingStatus = "pending" | "running" | "completed" | "failed";

/**
 * Issue #142. Enum-shaped text column (CHECK constraint in SQL, not a
 * Postgres ENUM type). Null means "we never asked"; `"unknown"` means
 * "we asked and the user said they don't know" — distinct states the
 * future "complete your profile" prompt cares about.
 */
export type WaterSource = "well" | "municipal" | "shared" | "unknown";

/**
 * Issue #193 — How a user-supplied PWSID landed in `houses.water_system_user_pwsid`.
 * `user_confirmed` = user accepted an inferred EPA match; `user_corrected` =
 * user entered a different PWSID via the WQA correction input. Never set by
 * the module itself — only by the confirmation UI in the WQA findings panel.
 */
export type WaterSystemPwsidConfidence = "user_confirmed" | "user_corrected";

/**
 * Issue #216 — Onboarding-milestone state for *view-event* milestones
 * that have no natural data signal to derive from. Stored in the
 * `onboarding_state jsonb` column on hearth.houses. Write-event
 * milestones (home photo, emergency video, first appliance) are derived
 * from their own tables and never live here.
 *
 * `habitat_reviewed` is set true (fire-and-forget) the first time the
 * user opens a habitat finding modal. `foundation_celebration_seen` is
 * set true (issue #269) the first time the foundation-complete celebration
 * auto-shows, so that one-time reward beat never re-appears in a later
 * session — the dashboard `?` trigger remains the way back into it. The
 * blob shape is deliberately open-ended so future view-event / UI-beat
 * milestones extend it without a new column — read keys defensively (a
 * freshly-migrated row is `{}`).
 */
export type OnboardingState = {
  habitat_reviewed?: boolean;
  foundation_celebration_seen?: boolean;
};

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

  // Issue #142 — property-situation inputs used by habitat modules
  // (Superfund label / recommended actions, future water-system module).
  // Both nullable; see the `WaterSource` JSDoc for the null vs.
  // `"unknown"` distinction. `basement_present` is true / false / null
  // (Yes / No / Not sure or never captured).
  water_source: WaterSource | null;
  basement_present: boolean | null;

  // Issue #193 — User-supplied PWSID override for the Water Quality Awareness
  // module. When set, WQA's check() skips EPA polygon resolution and uses
  // this PWSID directly. The pair is bound by a cross-column constraint in
  // the migration: both null = no override; both set = user has acted on
  // the confirmation prompt.
  water_system_user_pwsid: string | null;
  water_system_pwsid_confidence: WaterSystemPwsidConfidence | null;

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

  // User-uploaded house photo. Takes priority over the generated sketch
  // when present. Path within the private `house-photos` bucket; the
  // dashboard derives signed URLs the same way as the generated image.
  // Null when the user hasn't uploaded a photo (or has removed it).
  user_image_url: string | null;
  user_image_uploaded_at: string | null;

  // Issue #216 — Onboarding-milestone view-event state. NOT NULL DEFAULT
  // '{}' in the DB, so this is always an object, but read individual keys
  // defensively (an un-migrated read or a fresh row is `{}`).
  onboarding_state: OnboardingState;

  created_at: string;
  updated_at: string;
};
