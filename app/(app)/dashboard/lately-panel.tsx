// Dashboard "Lately" recent-activity panel (issue #279). Server
// component that reads the three activity sources — items added,
// documents attached, maintenance tasks completed — shapes them into the
// pure ActivityEntry[] the merge helper consumes, and renders the most
// recent few as photo tiles in the hero's right column. It replaces the
// Lifecycle outlook panel in this slot; the lifecycle helpers and panel
// stay in the repo for the future /maintenance timeline page.
//
// "Lately" is a mirror of the user's own effort — things they DID to their
// house. Activity is defined strictly from user actions (created_at /
// completed_at), never system-driven `updated_at` bumps. Read-only: no
// writes, no migration. Query/shaping lives here; the merge/sort/cap and
// per-source shaping is pure + unit-tested in lib/dashboard/recent-activity.
//
// Presentational markup is inline (single caller, no extraction). Query
// errors surface loudly rather than collapsing into a silent empty state
// (feedback_surface_loader_errors, as EmergencyReferencePanel does).

import { SectionHeader } from "@/components/ui";
import {
  buildRecentActivity,
  MIN_ACTIVITY,
  shapeDocumentAttached,
  shapeInventoryAdded,
  shapeTaskCompleted,
  type ActivityEntry,
  type TaskKind,
} from "@/lib/dashboard/recent-activity";
import { createClient } from "@/lib/supabase/server";
import type {
  DocumentKind,
  EquipmentType,
  InventorySubtype,
} from "@/types/document";
import { LatelyTile } from "./lately-tile";

// Document kinds that represent the user *attaching a document* to an item.
// nameplate/photo are the item's own capture photos (already represented by
// the inventory-added event — including them would double-surface a new
// item), and emergency videos / CCRs aren't inventory-attached. Receipts,
// manuals, warranties, permits, invoices, and inspections are the genuine
// "you filed this" actions.
const ACTIVITY_DOCUMENT_KINDS: DocumentKind[] = [
  "receipt",
  "manual",
  "warranty",
  "permit",
  "invoice",
  "inspection",
];

// Per source we only need its own newest few — the global newest-N is a
// subset of (newest-N per source). Matches the panel's ACTIVITY_LIMIT.
const PER_SOURCE_LIMIT = 3;

export async function LatelyPanel({ houseId }: { houseId: string }) {
  const supabase = await createClient();

  const [addedRes, docsRes, tasksRes] = await Promise.all([
    supabase
      .from("inventory")
      .select("id, name, type, subtype, hero_document_id, created_at")
      .eq("house_id", houseId)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from("documents")
      // Disambiguate the embed: there are TWO FKs between documents and
      // inventory (documents.inventory_id → inventory, and
      // inventory.hero_document_id → documents), so a bare `inventory(name)`
      // is an ambiguous embed (PGRST201). The `!inventory_id` hint pins it
      // to the parent-item relationship.
      .select(
        "id, inventory_id, kind, thumbnail_path, created_at, inventory!inventory_id(name)",
      )
      .eq("house_id", houseId)
      .eq("status", "attached")
      .not("inventory_id", "is", null)
      .in("kind", ACTIVITY_DOCUMENT_KINDS)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from("maintenance_tasks")
      .select("id, inventory_id, kind, title, completed_at, inventory(name)")
      .eq("house_id", houseId)
      .eq("status", "completed")
      .not("inventory_id", "is", null)
      .order("completed_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
  ]);

  const loadError = addedRes.error ?? docsRes.error ?? tasksRes.error;
  if (loadError) {
    // Surface the real message rather than collapsing into a silent/empty
    // state — as the app approaches real users, schema drift / RLS misconfig
    // / transient outages should be visible (feedback_surface_loader_errors,
    // matching EmergencyReferencePanel).
    console.error("LatelyPanel load failed", loadError);
    return (
      <PanelShell>
        <div
          role="alert"
          className="surface p-5"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 10%, var(--color-bg-surface))",
          }}
        >
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            We couldn&rsquo;t load your recent activity: {loadError.message}
          </p>
        </div>
      </PanelShell>
    );
  }

  const addedRows = (addedRes.data ?? []) as Array<{
    id: string;
    name: string;
    type: EquipmentType;
    subtype: InventorySubtype | null;
    hero_document_id: string | null;
    created_at: string;
  }>;
  const docRows = (docsRes.data ?? []) as Array<{
    id: string;
    inventory_id: string;
    kind: DocumentKind;
    thumbnail_path: string | null;
    created_at: string;
    inventory: { name: string } | { name: string }[] | null;
  }>;
  const taskRows = (tasksRes.data ?? []) as Array<{
    id: string;
    inventory_id: string;
    kind: TaskKind;
    title: string;
    completed_at: string | null;
    inventory: { name: string } | { name: string }[] | null;
  }>;

  // Hero thumbnails for the items behind inventory-added and task-completed
  // entries (document entries carry their own thumbnail). One resolver over
  // the union of parent ids — same pin-or-most-recent rule as the inventory
  // tiles. A hero-lookup failure degrades to the fallback icon, never an
  // error surface — the panel's primary reads already succeeded.
  const parentIds = unique([
    ...addedRows.map((r) => r.id),
    ...taskRows.map((r) => r.inventory_id),
  ]);
  const heroThumbnails = await resolveHeroThumbnails(supabase, parentIds);

  const inventoryAdded: ActivityEntry[] = addedRows.map((r) =>
    shapeInventoryAdded({
      id: r.id,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
      createdAt: r.created_at,
      thumbnailPath: heroThumbnails.get(r.id) ?? null,
    }),
  );

  const documentsAttached: ActivityEntry[] = docRows.map((r) =>
    shapeDocumentAttached({
      id: r.id,
      inventoryId: r.inventory_id,
      parentName: nameOf(r.inventory) ?? "Item",
      kind: r.kind,
      createdAt: r.created_at,
      thumbnailPath: r.thumbnail_path,
    }),
  );

  const tasksCompleted: ActivityEntry[] = taskRows
    // A completed row always has completed_at (DB CHECK), but guard the type.
    .filter((r) => r.completed_at !== null)
    .map((r) =>
      shapeTaskCompleted({
        id: r.id,
        inventoryId: r.inventory_id,
        itemName: nameOf(r.inventory) ?? "Item",
        kind: r.kind,
        title: r.title,
        completedAt: r.completed_at as string,
        thumbnailPath: heroThumbnails.get(r.inventory_id) ?? null,
      }),
    );

  const { entries, totalCount } = buildRecentActivity(
    { inventoryAdded, documentsAttached, tasksCompleted },
    new Date(),
  );

  if (totalCount < MIN_ACTIVITY) {
    return (
      <PanelShell>
        <NudgeCard />
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <div className="flex flex-1 flex-col gap-2">
        {entries.map((entry) => (
          <LatelyTile key={entry.id} entry={entry} />
        ))}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  // flex-1 so the panel grows to fill the right column to rough parity with
  // the house-photo column on desktop; on mobile the grid collapses to one
  // column and the panel simply takes its content height.
  return (
    <section className="surface flex flex-1 flex-col p-4 sm:p-5">
      <SectionHeader eyebrow="Recent activity" title="Lately" />
      {children}
    </section>
  );
}

function NudgeCard() {
  return (
    <div
      className="surface flex flex-1 flex-col justify-center gap-1 p-5"
      style={{
        borderStyle: "dashed",
        borderColor:
          "color-mix(in oklab, var(--color-border-subtle) 70%, transparent)",
      }}
    >
      <p
        className="text-small"
        style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
      >
        Your house, as you get to know it.
      </p>
      <p className="text-small" style={{ color: "var(--color-text-secondary)" }}>
        As you add appliances, attach documents, and log maintenance, the
        latest will show up here.
      </p>
    </div>
  );
}

function nameOf(
  inventory: { name: string } | { name: string }[] | null,
): string | null {
  const entry = Array.isArray(inventory) ? inventory[0] : inventory;
  return entry?.name ?? null;
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Resolve each inventory id to its hero thumbnail path, mirroring the
 * inventory list/preview rule: prefer the pinned `hero_document_id`'s
 * thumbnail, else the most-recent attached photo. Two small reads
 * (hero-doc ids + their thumbnails); returns an empty map on any error so
 * the caller cleanly falls back to type/kind icons.
 */
async function resolveHeroThumbnails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inventoryIds: string[],
): Promise<Map<string, string>> {
  if (inventoryIds.length === 0) return new Map();

  const { data: owners } = await supabase
    .from("inventory")
    .select("id, hero_document_id")
    .in("id", inventoryIds);

  const pinnedHeroIdByInventory = new Map<string, string>();
  for (const o of (owners ?? []) as Array<{
    id: string;
    hero_document_id: string | null;
  }>) {
    if (o.hero_document_id) pinnedHeroIdByInventory.set(o.id, o.hero_document_id);
  }

  const { data: docs } = await supabase
    .from("documents")
    .select("id, inventory_id, thumbnail_path, analyzed_at, created_at")
    .in("inventory_id", inventoryIds)
    .eq("status", "attached")
    .in("kind", ["nameplate", "photo"])
    .order("analyzed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const heroByInventory = new Map<string, string>();
  const pinnedThumbByInventory = new Map<string, string>();
  for (const d of (docs ?? []) as Array<{
    id: string | null;
    inventory_id: string | null;
    thumbnail_path: string | null;
  }>) {
    if (!d.inventory_id || !d.thumbnail_path) continue;
    if (!heroByInventory.has(d.inventory_id)) {
      heroByInventory.set(d.inventory_id, d.thumbnail_path);
    }
    const pinnedId = pinnedHeroIdByInventory.get(d.inventory_id);
    if (pinnedId && d.id === pinnedId) {
      pinnedThumbByInventory.set(d.inventory_id, d.thumbnail_path);
    }
  }

  const out = new Map<string, string>();
  for (const id of inventoryIds) {
    const thumb = pinnedThumbByInventory.get(id) ?? heroByInventory.get(id);
    if (thumb) out.set(id, thumb);
  }
  return out;
}
