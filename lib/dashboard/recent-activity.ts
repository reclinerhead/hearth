// Pure helpers for the dashboard "Lately" recent-activity panel
// (issue #279). Mirrors lib/inventory/lifecycle-outlook.ts: the
// Supabase-touching query + shaping lives in the server component
// (app/(app)/dashboard/lately-panel.tsx); this file holds only the
// pure, unit-tested logic — the per-source shapers and the merge/sort/cap.
//
// "Lately" is a mirror of the user's own effort: the most recent things
// they have *done* to their house — added an item, attached a document,
// completed a maintenance task. It is deliberately defined from USER
// actions only (created_at / completed_at), never system-driven
// `updated_at` bumps (serial decode, synthesis), which would surface
// items the user didn't touch and undercut the framing.
//
// No Supabase imports here on purpose — the three source arrays arrive
// already normalized to ActivityEntry so the merge stays a pure function
// of plain data. The seam to a future materialized activity view stays
// clean: every consumer reads ActivityEntry[], not raw rows.

import type { IconName } from "@/components/icon";
import type {
  DocumentKind,
  EquipmentType,
  InventorySubtype,
} from "@/types/document";

// Top-N entries the panel renders. Six fills the right column as a clean
// 3×2 grid (two per row, three rows) to rough parity with the house-photo
// column.
export const ACTIVITY_LIMIT = 6;

// Below this many merged entries the panel shows the awareness nudge
// instead of a (lonely-or-blank) tile list. With 1–2 entries we render
// what exists; only a genuinely empty house (0) trips the nudge.
export const MIN_ACTIVITY = 1;

// Maintenance task kinds, mirroring the hearth.maintenance_tasks.kind
// CHECK constraint. Local copy rather than an import so this pure module
// stays decoupled from the maintenance layer.
export type TaskKind =
  | "renewal"
  | "service"
  | "inspection"
  | "consumable"
  | "seasonal";

export type ActivityKind =
  | "inventory_added"
  | "document_attached"
  | "task_completed";

export type ActivityEntry = {
  /** The source row's own id (inventory / document / task). Stable React
   *  key + deterministic tie-break — distinct from the href target, which
   *  for documents/tasks is the *parent* item. */
  id: string;
  kind: ActivityKind;
  /** ISO timestamp that ranks the entry (created_at / completed_at). */
  occurredAt: string;
  /** Uppercase event context, already resolved to human names. */
  eyebrow: string;
  title: string;
  /** Navigation target — always an /inventory/[id] page. */
  href: string;
  /** Bucket-relative path; null → fallback icon. */
  thumbnailPath: string | null;
  thumbnailBucket: "hearth-documents";
  fallbackIcon: IconName;
};

// ---- Shaper inputs (plain, Supabase-free) -----------------------------

export type InventoryAddedInput = {
  id: string;
  name: string;
  type: EquipmentType;
  subtype: InventorySubtype | null;
  createdAt: string;
  thumbnailPath: string | null;
};

export type DocumentAttachedInput = {
  /** document id */
  id: string;
  /** parent inventory id (href target) */
  inventoryId: string;
  parentName: string;
  kind: DocumentKind;
  createdAt: string;
  thumbnailPath: string | null;
};

export type TaskCompletedInput = {
  /** maintenance_task id */
  id: string;
  /** parent inventory id (href target) */
  inventoryId: string;
  itemName: string;
  kind: TaskKind;
  title: string;
  completedAt: string;
  thumbnailPath: string | null;
};

// ---- Fallback icons + label vocabularies ------------------------------

const TYPE_FALLBACK_ICON: Record<EquipmentType, IconName> = {
  appliance: "fridge",
  system: "flame-burner",
  exterior: "home",
  property: "package",
};

const SUBTYPE_FALLBACK_ICON: Record<InventorySubtype, IconName> = {
  vehicle: "car",
  pet: "paw",
};

// Human title shown in the tile's title slot for an attached document.
// `receipt` stays generic ("Document") on purpose: the receipt kind is
// overloaded — it backs vehicle registrations, insurance cards, and
// warranties via the renewal path as well as actual service receipts —
// so a specific label like "Service receipt" mislabels half of them.
const DOCUMENT_KIND_TITLE: Record<DocumentKind, string> = {
  receipt: "Document",
  manual: "Manual",
  warranty: "Warranty",
  permit: "Permit",
  invoice: "Invoice",
  inspection: "Inspection",
  nameplate: "Photo",
  photo: "Photo",
  emergency_procedure_video: "Emergency video",
  water_quality_report: "Water quality report",
  other: "Document",
};

// Single word used in the eyebrow ("WATER HEATER · DOCUMENT ATTACHED").
// `receipt` is generic here too — see DOCUMENT_KIND_TITLE.
const DOCUMENT_KIND_EYEBROW_WORD: Record<DocumentKind, string> = {
  receipt: "document",
  manual: "manual",
  warranty: "warranty",
  permit: "permit",
  invoice: "invoice",
  inspection: "inspection",
  nameplate: "photo",
  photo: "photo",
  emergency_procedure_video: "video",
  water_quality_report: "report",
  other: "document",
};

// Kind-appropriate past-tense verb for a completed task eyebrow
// ("WATER HEATER · SERVICED").
const TASK_KIND_VERB: Record<TaskKind, string> = {
  renewal: "renewed",
  service: "serviced",
  inspection: "inspected",
  consumable: "refilled",
  seasonal: "completed",
};

// Fallback icon for a completed task whose parent item has no photo.
const TASK_KIND_ICON: Record<TaskKind, IconName> = {
  renewal: "calendar",
  service: "tool",
  inspection: "shield",
  consumable: "droplet",
  seasonal: "leaf",
};

// ---- Per-source shapers -----------------------------------------------

export function shapeInventoryAdded(input: InventoryAddedInput): ActivityEntry {
  // Property subtypes surface their subtype in the eyebrow where useful so
  // a vehicle reads "VEHICLE · ADDED", not "PROPERTY · ADDED" — same
  // vehicle-aware labeling the inventory tiles use.
  const isSubtyped = input.type === "property" && input.subtype !== null;
  const noun = isSubtyped ? (input.subtype as InventorySubtype) : input.type;
  const fallbackIcon = isSubtyped
    ? SUBTYPE_FALLBACK_ICON[input.subtype as InventorySubtype]
    : TYPE_FALLBACK_ICON[input.type];
  return {
    id: input.id,
    kind: "inventory_added",
    occurredAt: input.createdAt,
    eyebrow: `${noun} · added`.toUpperCase(),
    title: input.name,
    href: `/inventory/${input.id}`,
    thumbnailPath: input.thumbnailPath,
    thumbnailBucket: "hearth-documents",
    fallbackIcon,
  };
}

export function shapeDocumentAttached(
  input: DocumentAttachedInput,
): ActivityEntry {
  return {
    id: input.id,
    kind: "document_attached",
    occurredAt: input.createdAt,
    eyebrow:
      `${input.parentName} · ${DOCUMENT_KIND_EYEBROW_WORD[input.kind]} attached`.toUpperCase(),
    title: DOCUMENT_KIND_TITLE[input.kind],
    href: `/inventory/${input.inventoryId}`,
    thumbnailPath: input.thumbnailPath,
    thumbnailBucket: "hearth-documents",
    fallbackIcon: "file-text",
  };
}

export function shapeTaskCompleted(input: TaskCompletedInput): ActivityEntry {
  return {
    id: input.id,
    kind: "task_completed",
    occurredAt: input.completedAt,
    eyebrow: `${input.itemName} · ${TASK_KIND_VERB[input.kind]}`.toUpperCase(),
    title: input.title,
    href: `/inventory/${input.inventoryId}`,
    thumbnailPath: input.thumbnailPath,
    thumbnailBucket: "hearth-documents",
    fallbackIcon: TASK_KIND_ICON[input.kind],
  };
}

// ---- "When" line -------------------------------------------------------

// Display verb for each kind's "when" line, matching the tile badge
// semantics: a completed task was *done*, a document *uploaded*, an item
// *added*. Kept here (not in the tile) so the verb and the relative-time
// formatting stay pure and unit-tested together.
const ACTIVITY_WHEN_VERB: Record<ActivityKind, string> = {
  task_completed: "Done",
  document_attached: "Uploaded",
  inventory_added: "Added",
};

const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The small "when" line shown beneath a tile's title — a kind-appropriate
 * verb ("Done" / "Uploaded" / "Added") plus a relative or absolute time.
 * Recent events read relatively ("Done 1 week ago"); past ~a month it
 * falls back to an absolute date ("Uploaded Jun 24"), with the year only
 * when it differs from the reference year. Formatted in UTC so the server
 * render (Vercel runs UTC) and the unit tests agree regardless of locale.
 * An unparseable timestamp degrades to the bare verb.
 */
export function formatActivityWhen(
  kind: ActivityKind,
  occurredAt: string,
  referenceDate: Date,
): string {
  const verb = ACTIVITY_WHEN_VERB[kind];
  const occurredMs = Date.parse(occurredAt);
  if (Number.isNaN(occurredMs)) return verb;

  const days = Math.floor((referenceDate.getTime() - occurredMs) / DAY_MS);

  let when: string;
  if (days <= 0) when = "today";
  else if (days === 1) when = "yesterday";
  else if (days < 7) when = `${days} days ago`;
  else if (days < 14) when = "1 week ago";
  else if (days < 30) when = `${Math.floor(days / 7)} weeks ago`;
  else {
    const d = new Date(occurredMs);
    const sameYear = d.getUTCFullYear() === referenceDate.getUTCFullYear();
    const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    when = sameYear ? base : `${base}, ${d.getUTCFullYear()}`;
  }
  return `${verb} ${when}`;
}

// ---- Merge + sort + cap -----------------------------------------------

export type RecentActivitySources = {
  inventoryAdded: ActivityEntry[];
  documentsAttached: ActivityEntry[];
  tasksCompleted: ActivityEntry[];
};

export type RecentActivity = {
  /** Top-ACTIVITY_LIMIT entries, newest first. */
  entries: ActivityEntry[];
  /** Count of merged (eligible) entries before the cap — drives the
   *  empty→nudge boundary. */
  totalCount: number;
};

// Stable order when two events share a timestamp: a completion outranks a
// document, which outranks an inventory-add. Lower rank sorts first.
const KIND_RANK: Record<ActivityKind, number> = {
  task_completed: 0,
  document_attached: 1,
  inventory_added: 2,
};

/**
 * Merge the three normalized source arrays into the dashboard's recent
 * activity: concatenate, drop bad/future timestamps, sort newest-first
 * with a deterministic tie-break, and return the top ACTIVITY_LIMIT plus
 * the pre-cap total.
 */
export function buildRecentActivity(
  sources: RecentActivitySources,
  referenceDate: Date,
): RecentActivity {
  const referenceMs = referenceDate.getTime();

  const merged = [
    ...sources.inventoryAdded,
    ...sources.documentsAttached,
    ...sources.tasksCompleted,
  ].filter((e) => {
    const t = Date.parse(e.occurredAt);
    // "Lately" is what has already happened. Drop unparseable timestamps
    // and anything dated ahead of the reference clock — a future
    // created_at/completed_at is clock skew or bad data, not activity.
    return !Number.isNaN(t) && t <= referenceMs;
  });

  merged.sort((a, b) => {
    const at = Date.parse(a.occurredAt);
    const bt = Date.parse(b.occurredAt);
    if (at !== bt) return bt - at; // newest first
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    // Final tiebreak on id so equal-timestamp renders don't flip/flop.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    entries: merged.slice(0, ACTIVITY_LIMIT),
    totalCount: merged.length,
  };
}
