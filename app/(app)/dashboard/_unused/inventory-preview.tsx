// Preserved from the dashboard's earlier appliance-tile design. The
// dashboard's right column now hosts the maintenance panel
// (`maintenance-panel-dashboard.tsx`, issue #133); this file is parked
// here in case we want this preview surface elsewhere later — e.g. a
// compact tile widget on the inventory list page. No imports reference
// it from the active build; it's free to modify or delete if it becomes
// clear we'll never reuse it. The `_unused/` segment leverages Next.js'
// private-folder convention so this file is not part of the route tree.
import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { InventoryThumbnail } from "@/components/inventory-thumbnail";
import { displayModelNumber } from "@/lib/inventory/model-number";
import { parseVehicleMetadata } from "@/lib/inventory/metadata-schemas";
import { createClient } from "@/lib/supabase/server";
import type { InventorySubtype } from "@/types/document";

/**
 * Dashboard inventory preview — server component. Renders the
 * authenticated user's most recently created inventory items as
 * tile rows. Hero thumbnails resolve on the client: this component
 * loads each item's most-recent attached document's thumbnail path
 * and hands it to `<InventoryThumbnail>`, which signs the URL via
 * `createCachedSignedUrl`. Caching the resulting URL string in
 * `sessionStorage` is what lets the browser's HTTP cache hit the
 * immutable `hearth-documents` bytes on reload and across navigations
 * — see "Signed URL caching" in the Technical Guide.
 *
 * Replaces the dashboard's earlier hardcoded mock APPLIANCES array.
 * The layout (vertical rows in a half-width column) is unchanged; only
 * the data source moved.
 *
 * The dashboard refresh-on-save uses `router.refresh()` (matching the
 * home-details modal's pattern), which re-runs this server component
 * and surfaces freshly-saved items automatically.
 */

const PREVIEW_LIMIT = 6;

type InventoryType = "appliance" | "system" | "exterior" | "property";

type InventoryPreviewItem = {
  id: string;
  name: string;
  type: InventoryType;
  subtype: InventorySubtype | null;
  roomName: string;
  manufacturer: string | null;
  modelNumber: string | null;
  installedOn: string | null;
  metadata: Record<string, unknown> | null;
  thumbnailPath: string | null;
};

const TYPE_FALLBACK_ICON: Record<InventoryType, IconName> = {
  appliance: "fridge",
  system: "flame-burner",
  exterior: "home",
  property: "package",
};

const SUBTYPE_FALLBACK_ICON: Record<InventorySubtype, IconName> = {
  vehicle: "car",
  pet: "paw",
};

export async function InventoryPreview({ houseId }: { houseId: string }) {
  const items = await loadPreviewItems(houseId);

  if (items.length === 0) {
    return (
      <div
        className="surface p-4 text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Nothing here yet. Tap{" "}
        <span style={{ color: "var(--color-text-secondary)" }}>+ Add</span> in
        the top nav to document your first appliance with a photo.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <InventoryRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function InventoryRow({ item }: { item: InventoryPreviewItem }) {
  const fallbackIcon =
    item.subtype && SUBTYPE_FALLBACK_ICON[item.subtype]
      ? SUBTYPE_FALLBACK_ICON[item.subtype]
      : TYPE_FALLBACK_ICON[item.type];
  const meta = buildMeta(item);
  return (
    <Link
      href={`/inventory/${item.id}`}
      className="group flex items-center gap-3 rounded-[var(--radius-md)] p-3 transition-colors"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          color: "var(--color-text-secondary)",
        }}
      >
        <InventoryThumbnail
          thumbnailPath={item.thumbnailPath}
          fallbackIcon={fallbackIcon}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {item.name}
          </span>
          <span
            className="text-small truncate"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {item.roomName}
          </span>
        </div>
        {meta ? (
          <div
            className="text-small truncate"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      <span
        aria-hidden
        style={{ color: "var(--color-text-tertiary)" }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Icon name="chevron-right" size={16} />
      </span>
    </Link>
  );
}

function buildMeta(item: InventoryPreviewItem): string | null {
  // Vehicles prefer `model_year · license_plate` as the at-a-glance
  // identifier — the manufacturer/model is already implied by the
  // item name (e.g. "Toyota Land Cruiser") so repeating it here adds
  // nothing.
  if (item.type === "property" && item.subtype === "vehicle") {
    const vmeta = parseVehicleMetadata(item.metadata);
    const vehicleParts: string[] = [];
    if (vmeta.model_year) vehicleParts.push(String(vmeta.model_year));
    if (vmeta.license_plate) vehicleParts.push(vmeta.license_plate);
    if (vehicleParts.length > 0) return vehicleParts.join(" · ");
  }
  const parts: string[] = [];
  const model = displayModelNumber(item.modelNumber);
  if (item.manufacturer && model) {
    parts.push(`${item.manufacturer} ${model}`);
  } else if (item.manufacturer) {
    parts.push(item.manufacturer);
  } else if (model) {
    parts.push(model);
  }
  if (item.installedOn) {
    parts.push(`Installed ${formatYearMonth(item.installedOn)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatYearMonth(isoDate: string): string {
  // hearth.inventory.installed_on is a DATE; safe to slice.
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

async function loadPreviewItems(
  houseId: string,
): Promise<InventoryPreviewItem[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("inventory")
    .select(
      `
      id,
      name,
      type,
      subtype,
      manufacturer,
      model_number,
      installed_on,
      metadata,
      hero_document_id,
      created_at,
      room:rooms!inner(name)
    `,
    )
    .eq("house_id", houseId)
    .order("created_at", { ascending: false })
    .limit(PREVIEW_LIMIT);

  if (error || !rows) return [];

  const rowList = rows as unknown as Array<{
    id: string;
    name: string;
    type: InventoryType;
    subtype: InventorySubtype | null;
    manufacturer: string | null;
    model_number: string | null;
    installed_on: string | null;
    metadata: Record<string, unknown> | null;
    hero_document_id: string | null;
    created_at: string;
    room: { name: string } | { name: string }[] | null;
  }>;

  if (rowList.length === 0) return [];

  const ids = rowList.map((r) => r.id);

  // Most-recent attached document per inventory item. Two-step query
  // because PostgREST's nested-select filtering for "latest per parent"
  // isn't a one-liner. We pull every attached document for this batch
  // and pick the most-recent per inventory_id client-side. The set is
  // small (≤ PREVIEW_LIMIT items × however many photos each has) and
  // each row is a few columns, so the cost is negligible.
  //
  // When the inventory row has a `hero_document_id` (issue #105) we
  // prefer that document's thumbnail over the most-recent one. If the
  // FK has since been SET NULL'd or the doc isn't in the batch for any
  // reason, we cleanly fall through to the existing rule.
  const { data: docs } = await supabase
    .from("documents")
    .select("id, inventory_id, thumbnail_path, analyzed_at, created_at")
    .in("inventory_id", ids)
    .eq("status", "attached")
    .order("analyzed_at", { ascending: false, nullsFirst: false });

  const pinnedHeroIdByInventory = new Map<string, string>();
  for (const r of rowList) {
    if (r.hero_document_id) {
      pinnedHeroIdByInventory.set(r.id, r.hero_document_id);
    }
  }

  const heroByInventory = new Map<string, string>();
  const pinnedThumbByInventory = new Map<string, string>();
  for (const d of (docs ?? []) as Array<{
    id: string | null;
    inventory_id: string | null;
    thumbnail_path: string;
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

  // Signing happens client-side in <InventoryThumbnail> so the URL
  // string can be cached in sessionStorage across navigations. The
  // server's only job here is to surface the storage path for each
  // inventory row; the client component takes it from there.
  return rowList.map((r) => {
    const roomEntry = Array.isArray(r.room) ? r.room[0] : r.room;
    const roomName = roomEntry?.name ?? "Unknown";
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
      roomName,
      manufacturer: r.manufacturer,
      modelNumber: r.model_number,
      installedOn: r.installed_on,
      metadata: r.metadata,
      thumbnailPath:
        pinnedThumbByInventory.get(r.id) ?? heroByInventory.get(r.id) ?? null,
    };
  });
}
