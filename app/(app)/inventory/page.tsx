import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { InventoryThumbnail } from "@/components/inventory-thumbnail";
import { SectionHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

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

type InventoryType = "appliance" | "system" | "exterior";

type InventoryItem = {
  id: string;
  name: string;
  type: InventoryType;
  roomName: string;
  manufacturer: string | null;
  modelNumber: string | null;
  installedOn: string | null;
  thumbnailPath: string | null;
};

const TYPE_FALLBACK_ICON: Record<InventoryType, IconName> = {
  appliance: "fridge",
  system: "flame-burner",
  exterior: "home",
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
];

export default async function InventoryPage() {
  const supabase = await createClient();

  // Resolve the user's house the same way DashboardPage does. The
  // onboarding gate in proxy.ts ensures a row exists for any authed
  // visitor to this page; guard defensively in case of a race.
  const { data: house, error: houseError } = await supabase
    .from("houses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (houseError || !house?.id) {
    redirect("/onboarding");
  }

  const items = await loadInventory(house.id);
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
              <div className="flex flex-col gap-2">
                {sectionItems.map((item) => (
                  <InventoryListRow key={item.id} item={item} />
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

function InventoryListRow({ item }: { item: InventoryItem }) {
  const fallbackIcon = TYPE_FALLBACK_ICON[item.type];
  const detailLine = buildDetailLine(item);

  // The dashboard's InventoryRow uses a 48×48 thumbnail in a half-width
  // column. The list page has the full content column, so a 96×96 hero
  // earns its space — the photo becomes legible at a glance.
  //
  // Future: once the maintenance-log table lands, "Last serviced" / "Next
  // due" will slot into a second tertiary line below `detailLine`. The
  // fields exist on `hearth.inventory` today (`last_serviced_on`,
  // `next_service_due_on`) but aren't populated by any flow, so they'd
  // currently render as "Unknown" everywhere — wired up when there's
  // real data to display.
  return (
    <Link
      href={`/inventory/${item.id}`}
      className="group flex items-center gap-4 rounded-[var(--radius-md)] p-3 sm:p-4 transition-colors"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-20 w-20 sm:h-24 sm:w-24 shrink-0 items-center justify-center rounded-md overflow-hidden"
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
        <div
          className="truncate"
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            lineHeight: 1.3,
          }}
        >
          {item.name}
        </div>
        <div
          className="text-small truncate"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {item.roomName}
        </div>
        {detailLine ? (
          <div
            className="text-small truncate"
            style={{ color: "var(--color-text-secondary)", marginTop: 2 }}
          >
            {detailLine}
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

function buildDetailLine(item: InventoryItem): string | null {
  const parts: string[] = [];
  if (item.manufacturer && item.modelNumber) {
    parts.push(`${item.manufacturer} · ${item.modelNumber}`);
  } else if (item.manufacturer) {
    parts.push(item.manufacturer);
  } else if (item.modelNumber) {
    parts.push(item.modelNumber);
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
  };
  for (const item of items) {
    groups[item.type].push(item);
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
      manufacturer,
      model_number,
      installed_on,
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
    manufacturer: string | null;
    model_number: string | null;
    installed_on: string | null;
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
  const { data: docs } = await supabase
    .from("documents")
    .select("inventory_id, thumbnail_path, analyzed_at, created_at")
    .in("inventory_id", ids)
    .eq("status", "attached")
    .in("kind", ["nameplate", "photo"])
    .order("analyzed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const heroByInventory = new Map<string, string>();
  for (const d of (docs ?? []) as Array<{
    inventory_id: string | null;
    thumbnail_path: string | null;
  }>) {
    if (!d.inventory_id || !d.thumbnail_path) continue;
    if (!heroByInventory.has(d.inventory_id)) {
      heroByInventory.set(d.inventory_id, d.thumbnail_path);
    }
  }

  return rowList.map((r) => {
    const roomEntry = Array.isArray(r.room) ? r.room[0] : r.room;
    const roomName = roomEntry?.name ?? "Unknown";
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      roomName,
      manufacturer: r.manufacturer,
      modelNumber: r.model_number,
      installedOn: r.installed_on,
      thumbnailPath: heroByInventory.get(r.id) ?? null,
    };
  });
}
