/**
 * Shared metadata for the four emergency-procedure-video categories
 * (issue #139). Reused by the Smart Uploader's category picker, the
 * dashboard Emergency reference panel, and the modal's category
 * heading. Keeping the icon paths + labels + placeholder copy in
 * one place avoids the surfaces drifting out of sync as we iterate.
 *
 * The icon images live in /public/document_icons/ and are referenced
 * with absolute URLs so Next.js's <Image> can use them without a
 * loader config change.
 */

import type { EmergencyCategory } from "@/types/document";

export type EmergencyCategoryMeta = {
  category: EmergencyCategory;
  /** Title-cased display label ("Water", "Gas", "Electrical", "Other"). */
  label: string;
  /** Public path to the category icon (PNG / JPG in /public). */
  iconSrc: string;
  /** One-line description used on the category picker cards. */
  description: string;
  /** Placeholder copy for the optional label field. */
  labelPlaceholder: string;
};

const WATER: EmergencyCategoryMeta = {
  category: "water",
  label: "Water",
  iconSrc: "/document_icons/emergency_water.jpg",
  description: "Main shutoff, outdoor spigots, individual fixture valves",
  labelPlaceholder: "Main shutoff in basement",
};

const GAS: EmergencyCategoryMeta = {
  category: "gas",
  label: "Gas",
  iconSrc: "/document_icons/emergency_gas_meter.jpg",
  description: "Main utility shutoff, individual appliance valves",
  labelPlaceholder: "Meter shutoff on side of house",
};

const ELECTRICAL: EmergencyCategoryMeta = {
  category: "electrical",
  label: "Electrical",
  iconSrc: "/document_icons/emergency_electric.jpg",
  description: "Main breaker, individual circuit breakers, subpanels",
  labelPlaceholder: "Main panel in garage",
};

const OTHER: EmergencyCategoryMeta = {
  category: "other",
  label: "Other",
  iconSrc: "/document_icons/emergency_other.jpg",
  description:
    "Alarm panels, sump pumps, generators, well pumps — anything else future-you should know how to operate",
  labelPlaceholder: "What is this?",
};

export const EMERGENCY_CATEGORY_ORDER: EmergencyCategory[] = [
  "water",
  "gas",
  "electrical",
  "other",
];

export const EMERGENCY_CATEGORY_META: Record<
  EmergencyCategory,
  EmergencyCategoryMeta
> = {
  water: WATER,
  gas: GAS,
  electrical: ELECTRICAL,
  other: OTHER,
};

export function getEmergencyCategoryMeta(
  category: EmergencyCategory,
): EmergencyCategoryMeta {
  return EMERGENCY_CATEGORY_META[category];
}

/**
 * Human-readable duration like "0:18" or "1:23". Used by tiles and
 * the player's time display.
 */
export function formatVideoDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
