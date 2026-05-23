// "Every time you use it" section on the inventory detail page (issue
// #135). Renders open per-use maintenance tasks for the current item —
// the actions coupled to *using* the appliance ("clean lint screen after
// every load", "check rinse aid before every cycle") rather than to
// calendar dates. The date-anchored maintenance panel excludes these via
// cadence_kind != 'per_use'; this server component is their dedicated
// surface.
//
// Returns null when no per-use rows exist for the item so items without
// per-use practices keep their existing layout cleanly. Per-use rows
// are not interactive in this phase — phase 6's task detail modal will
// support opening them. For now they render as static rows.

import { Icon } from "@/components/icon";
import { SectionHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type PerUseRow = {
  id: string;
  kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
  title: string;
  subtitle: string | null;
};

export async function PerUsePractices({
  inventoryId,
}: {
  inventoryId: string;
}) {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("maintenance_tasks")
    .select("id, kind, title, subtitle")
    .eq("inventory_id", inventoryId)
    .eq("status", "open")
    .eq("cadence_kind", "per_use")
    .order("title", { ascending: true });

  const items = (rows ?? []) as PerUseRow[];

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Routine practice"
        title="Every time you use it"
      />
      <div className="flex flex-col gap-2">
        {items.map((row) => (
          <PerUseRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function PerUseRow({ row }: { row: PerUseRow }) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-[var(--radius-md)]"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          color: "var(--color-text-secondary)",
        }}
      >
        <Icon name="refresh-cw" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {row.title}
        </div>
        {row.subtitle ? (
          <div
            className="text-small"
            style={{ color: "var(--color-text-secondary)", marginTop: 2 }}
          >
            {row.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
