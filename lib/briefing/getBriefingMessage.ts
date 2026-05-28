/**
 * Build a short, user-facing sentence summarizing what the briefing
 * workflow found for a house. Rendered by the first-run onboarding modal
 * after the briefing step resolves, so each fact reinforces "Hearth
 * already knows things about your house."
 *
 * Examples (in priority order, comma-separated after the dash):
 *   "Found your home data — built in 1934, 2,210 sq ft, 3 bed / 3 bath"
 *   "Found your home data — built in 1934, 3 bed / 3 bath"
 *   "Found your home data — 3 bed"
 *   "Looked up your home's public records"  ← when nothing concrete landed
 *
 * Pure helper — no DB access, no I/O. Computed client-side from the
 * realtime house row, not persisted.
 */
export type BriefingMessageInput = {
  year_built: number | null;
  living_area_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

/**
 * Lead + secondary split of the briefing result, used by the discovery
 * modal's card-row treatment (issue #184). The lead reads as a headline
 * ("Home data found" / "Public records checked") and the secondary line
 * carries the comma-separated facts. When nothing concrete landed the
 * secondary is null and only the honest fallback lead is shown.
 *
 * `getBriefingMessage` composes from this so the two helpers can't drift.
 */
export type BriefingMessageParts = {
  lead: string;
  secondary: string | null;
};

export function getBriefingMessageParts(
  house: BriefingMessageInput,
): BriefingMessageParts {
  const parts: string[] = [];

  if (house.year_built !== null) {
    parts.push(`built in ${house.year_built}`);
  }

  if (house.living_area_sqft !== null) {
    parts.push(`${formatNumber(house.living_area_sqft)} sq ft`);
  }

  const bedBath = formatBedBath(house.bedrooms, house.bathrooms);
  if (bedBath !== null) {
    parts.push(bedBath);
  }

  if (parts.length === 0) {
    return { lead: "Public records checked", secondary: null };
  }

  return { lead: "Home data found", secondary: parts.join(", ") };
}

export function getBriefingMessage(house: BriefingMessageInput): string {
  const { secondary } = getBriefingMessageParts(house);
  if (secondary === null) {
    // Nothing concrete to surface — the workflow ran but returned nulls
    // (e.g. Sonar couldn't find the address on Zillow). The modal still
    // needs a line; this one is honest about what happened without
    // dwelling on the miss.
    return "Looked up your home's public records";
  }
  return `Found your home data — ${secondary}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatBedBath(
  bedrooms: number | null,
  bathrooms: number | null,
): string | null {
  if (bedrooms === null && bathrooms === null) return null;

  const bed = bedrooms !== null ? `${formatRoomCount(bedrooms)} bed` : null;
  const bath = bathrooms !== null ? `${formatRoomCount(bathrooms)} bath` : null;

  if (bed && bath) return `${bed} / ${bath}`;
  return bed ?? bath;
}

function formatRoomCount(n: number): string {
  // Integers render as "3"; halves as "2.5" — matches how listings quote
  // these and how the dashboard's MetricCard renders them.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
