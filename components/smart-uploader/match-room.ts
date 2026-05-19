import type { EquipmentType } from "@/types/document";

export type SeededRoom = { id: string; name: string };

const FALLBACK_BY_TYPE: Record<EquipmentType, string> = {
  system: "Basement",
  appliance: "Kitchen",
  exterior: "Exterior",
};

/**
 * Picks the default room for a Smart Uploader review form, given the
 * AI's room suggestion (free-form, may not exist), the equipment type
 * (drives the type-based fallback when no suggestion matches), and the
 * caller's actual list of rooms.
 *
 * Returns the id of the chosen room, or null when the rooms list is
 * empty. Matching is case- and whitespace-insensitive against the
 * seeded room names. If the type-based fallback name isn't present
 * either, returns the first room's id so the dropdown always has a
 * non-empty initial selection.
 */
export function pickDefaultRoomId(args: {
  rooms: SeededRoom[];
  suggestion: string | null;
  type: EquipmentType;
}): string | null {
  if (args.rooms.length === 0) return null;
  const byNormalizedName = new Map<string, string>();
  for (const r of args.rooms) {
    byNormalizedName.set(normalize(r.name), r.id);
  }

  if (args.suggestion) {
    const hit = byNormalizedName.get(normalize(args.suggestion));
    if (hit) return hit;
  }

  const fallbackName = FALLBACK_BY_TYPE[args.type];
  const fallbackHit = byNormalizedName.get(normalize(fallbackName));
  if (fallbackHit) return fallbackHit;

  return args.rooms[0].id;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
