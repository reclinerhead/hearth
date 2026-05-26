import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { InventoryThumbnail } from "@/components/inventory-thumbnail";
import { SectionHeader } from "@/components/ui";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { displayModelNumber } from "@/lib/inventory/model-number";
import { parseVehicleMetadata } from "@/lib/inventory/metadata-schemas";
import { createClient } from "@/lib/supabase/server";
import type { InventorySubtype } from "@/types/document";

/**
 * Home inventory list — every appliance, system, and exterior item the
 * user has captured for their house, grouped by type. Server component.
 *
 * The data-fetch shape mirrors `dashboard/inventory-preview.tsx`: query
 * `hearth.inventory` for the house, then a follow-up query against
 * `hearth.documents` for each item's most-recent attached photo. The
 * thumbnail *path* (not a signed URL) is handed to `<InventoryThumbnail>`,
 * which signs client-side via `useCachedSignedUrl` so the URL string is
 * cached in `sessionStorage` and the browser's HTTP cache hits the
 * immutable `hearth-documents` bytes across navigations.
 * See "Signed URL caching" in the Technical Guide.
 *
 * The three sections (Appliances / Systems / Exterior) always render even
 * when empty, matching how the detail page's StatTiles always renders all
 * three tiles — the structure is itself part of the affordance.
 */

type InventoryType = "appliance" | "system" | "exterior" | "property";

type InventoryItem = {
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

// Subtype-specific fallback icons (issue #23). When a property row
// carries a known subtype, the icon should hint at the kind of thing
// (vehicle → car badge, pet → paw) before the user's photo loads. The
// generic "package" stays for property/null — electronics, art, tools
// don't share a single recognizable silhouette.
const SUBTYPE_FALLBACK_ICON: Record<InventorySubtype, IconName> = {
  vehicle: "car",
  pet: "paw",
};

const SECTIONS: {
  type: InventoryType;
  eyebrow: string;
  title: string;
  emptyHint: string;
}[] = [
  {
    type: "appliance",
    eyebrow: "What lives in your house",
    title: "Appliances",
    emptyHint:
      "No appliances yet — tap + Add in the top nav to capture your first one.",
  },
  {
    type: "system",
    eyebrow: "What keeps your house running",
    title: "Systems",
    emptyHint:
      "No systems yet — tap + Add to document your furnace, water heater, or AC.",
  },
  {
    type: "exterior",
    eyebrow: "What's outside your house",
    title: "Exterior",
    emptyHint:
      "No exterior items yet — tap + Add in the top nav to capture one.",
  },
  {
    type: "property",
    eyebrow: "What you own",
    title: "Property",
    emptyHint:
      "No property yet — tap + Add to capture a vehicle, pet, electronics, or other valuable.",
  },
];

export default async function InventoryPage() {
  const supabase = await createClient();

  // Resolve the user's active house. The onboarding gate in proxy.ts
  // ensures a row exists for any authed visitor to this page; guard
  // defensively in case of a race.
  const activeHouseId = await resolveActiveHouseId(supabase);

  if (!activeHouseId) {
    redirect("/onboarding");
  }

  const items = await loadInventory(activeHouseId);
  const byType = groupByType(items);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="eyebrow mb-1">Everything you own that matters</div>
        <h1 className="h1">Home inventory</h1>
      </header>

      {SECTIONS.map((section) => {
        const sectionItems = byType[section.type];
        return (
          <section key={section.type}>
            <SectionHeader
              eyebrow={section.eyebrow}
              title={section.title}
              trailing={
                sectionItems.length > 0 ? (
                  <span
                    className="text-small"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    {sectionItems.length}
                  </span>
                ) : null
              }
            />

            {sectionItems.length === 0 ? (
              <EmptySection hint={section.emptyHint} />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {sectionItems.map((item) => (
                  <InventoryTile key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EmptySection({ hint }: { hint: string }) {
  return (
    <div
      className="surface p-4 text-small"
      style={{ color: "var(--color-text-tertiary)" }}
    >
      {hint}
    </div>
  );
}

/**
 * Inventory list tile. Photo fills the 4:3 surface; a bottom scrim
 * carries the room eyebrow, item name, and manufacturer-model sub-line
 * in white-on-darkened-photo. Modeled on the dashboard Emergency panel's
 * PrimaryTile (issue #174) — the user's photos are the most distinctive
 * thing on the page, so they get the full canvas instead of sitting in
 * a thumbnail slot next to a directory-style row of text.
 *
 * Items without an attached photo fall back to the same radial-gradient
 * wash `PlaceholderImage` uses in `components/ui.tsx`, plus a centered
 * type icon at size 56 — keeps the card structurally consistent so the
 * grid never has one tile that suddenly looks like a row.
 *
 * Hover / focus deliberately stays subtle (1px accent ring, 1px lift,
 * 2px focus outline). The photo is the focal point; chrome shouldn't
 * fight it.
 */
function InventoryTile({ item }: { item: InventoryItem }) {
  const fallbackIcon =
    item.subtype && SUBTYPE_FALLBACK_ICON[item.subtype]
      ? SUBTYPE_FALLBACK_ICON[item.subtype]
      : TYPE_FALLBACK_ICON[item.type];
  const detailLine = buildDetailLine(item);
  const hasPhoto = item.thumbnailPath !== null;

  return (
    <Link
      href={`/inventory/${item.id}`}
      aria-label={item.name}
      className="group relative block overflow-hidden transition-transform duration-150 hover:-translate-y-px hover:shadow-[0_0_0_1px_var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
      style={{
        aspectRatio: "4 / 3",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      {hasPhoto ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <InventoryThumbnail
            thumbnailPath={item.thumbnailPath}
            fallbackIcon={fallbackIcon}
          />
        </div>
      ) : (
        <TileFallbackArtwork icon={fallbackIcon} />
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          // Slightly stronger top stop than the emergency tile's `78%`
          // because inventory carries a sub-line in addition to the
          // title — that small text needs the extra contrast to stay
          // readable on bright photos (white appliances, beige siding).
          background:
            "linear-gradient(to top, color-mix(in oklab, #000 82%, transparent), color-mix(in oklab, #000 20%, transparent) 60%, transparent)",
        }}
      />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-6">
        <div
          style={{
            color: "color-mix(in oklab, #fff 78%, transparent)",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            fontSize: 11,
          }}
        >
          {item.roomName}
        </div>
        <div
          className="truncate"
          style={{ color: "#fff", fontSize: 18, fontWeight: 500 }}
        >
          {item.name}
        </div>
        {detailLine ? (
          <div
            className="text-small truncate"
            style={{
              color: "color-mix(in oklab, #fff 65%, transparent)",
              marginTop: 2,
            }}
          >
            {detailLine}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function TileFallbackArtwork({ icon }: { icon: IconName }) {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 55%), radial-gradient(circle at 70% 75%, color-mix(in oklab, var(--color-info) 10%, transparent), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ color: "var(--color-text-tertiary)" }}>
          <Icon name={icon} size={56} />
        </span>
      </div>
    </>
  );
}

function buildDetailLine(item: InventoryItem): string | null {
  // Vehicles get a contextual detail line of `model_year · license_plate`
  // when both are populated in metadata — that pair is far more useful
  // at a glance than the manufacturer/model combo (which is already in
  // the item name for vehicles, e.g. "Toyota Land Cruiser"). Fall through
  // to the generic identifier line when neither is set.
  if (item.type === "property" && item.subtype === "vehicle") {
    const meta = parseVehicleMetadata(item.metadata);
    const vehicleParts: string[] = [];
    if (meta.model_year) vehicleParts.push(String(meta.model_year));
    if (meta.license_plate) vehicleParts.push(meta.license_plate);
    if (vehicleParts.length > 0) return vehicleParts.join(" · ");
  }
  const parts: string[] = [];
  const model = displayModelNumber(item.modelNumber);
  if (item.manufacturer && model) {
    parts.push(`${item.manufacturer} · ${model}`);
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

function groupByType(items: InventoryItem[]): Record<InventoryType, InventoryItem[]> {
  const groups: Record<InventoryType, InventoryItem[]> = {
    appliance: [],
    system: [],
    exterior: [],
    property: [],
  };
  for (const item of items) {
    groups[item.type].push(item);
  }
  // Alphabetical within each section. localeCompare with sensitivity:
  // "base" gives a case-insensitive, accent-insensitive natural sort so
  // "amana" and "Whirlpool" land where the user expects.
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  for (const type of Object.keys(groups) as InventoryType[]) {
    groups[type].sort((a, b) => collator.compare(a.name, b.name));
  }
  return groups;
}

async function loadInventory(houseId: string): Promise<InventoryItem[]> {
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
    .order("created_at", { ascending: false });

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

  // Most-recent attached photo per inventory item. Same query shape as
  // the dashboard preview: PostgREST can't do "latest per parent" as a
  // one-liner, so we pull every attached doc for the batch and pick the
  // most-recent per inventory_id in JS. Filter to actual photos so
  // future receipts / manuals stay out of the thumbnail slot.
  //
  // When an inventory row has a `hero_document_id` (issue #105) we
  // prefer that document's thumbnail over the most-recent one. Falls
  // back cleanly to the most-recent rule when the FK is null or the
  // pinned doc isn't in the batch.
  const { data: docs } = await supabase
    .from("documents")
    .select("id, inventory_id, thumbnail_path, analyzed_at, created_at")
    .in("inventory_id", ids)
    .eq("status", "attached")
    .in("kind", ["nameplate", "photo"])
    .order("analyzed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

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
