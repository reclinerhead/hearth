// Inventory-item-scoped data wrapper for the "On your plate"
// maintenance panel (issue #133). Item-scoped queries — every open task
// for this inventory item plus the calendar-year completion summary.
// Server component; the shared <MaintenancePanel> is the client half.

import { MaintenancePanel } from "@/components/maintenance/maintenance-panel";
import type {
  ItemEmptyState,
  MaintenancePanelTask,
} from "@/components/maintenance/maintenance-panel";
import { createClient } from "@/lib/supabase/server";
import type { InventorySubtype } from "@/types/document";

export async function MaintenancePanelItem({
  inventoryId,
  hasActionableInsights,
  itemType,
  itemSubtype,
}: {
  inventoryId: string;
  /**
   * Whether `ai_insights.maintenance` is populated on the inventory row.
   * Drives the discriminated empty state for non-property items.
   */
  hasActionableInsights: boolean;
  /**
   * Inventory item type. Property items skip the Research / synthesis
   * empty-state branches entirely — their maintenance flows from
   * uploaded documents (registration, insurance, vet records) via the
   * direct-event pipeline, so the empty state points at "Add document"
   * instead of "Run Research" / "Build maintenance plan".
   */
  itemType: "appliance" | "system" | "exterior" | "property";
  itemSubtype: InventorySubtype | null;
}) {
  const supabase = await createClient();

  // Read uses the partial index maintenance_tasks_inventory_open_by_due_idx.
  const { data: openTasksRaw } = await supabase
    .from("maintenance_tasks")
    .select(
      "id, inventory_id, kind, title, subtitle, next_due_at, source",
    )
    .eq("inventory_id", inventoryId)
    .eq("status", "open")
    .order("next_due_at", { ascending: true });

  const yearStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), 0, 1),
  ).toISOString();
  const [{ count: completedThisYearRaw }, { data: mostRecent }] =
    await Promise.all([
      supabase
        .from("maintenance_tasks")
        .select("id", { count: "exact", head: true })
        .eq("inventory_id", inventoryId)
        .eq("status", "completed")
        .gte("completed_at", yearStart),
      supabase
        .from("maintenance_tasks")
        .select("title, completed_at")
        .eq("inventory_id", inventoryId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  // The item-scoped panel never labels rows with the inventory name —
  // the user is already on that item's page and the prefix would be
  // visual noise. Setting inventoryName: null on every row here keeps
  // the row component branch-free.
  const rows = (openTasksRaw ?? []) as Array<
    Omit<MaintenancePanelTask, "inventoryName">
  >;
  const tasks: MaintenancePanelTask[] = rows.map((r) => ({
    ...r,
    inventoryName: null,
  }));
  const completedThisYear = completedThisYearRaw ?? 0;

  const itemEmptyState: ItemEmptyState =
    itemType === "property"
      ? {
          kind: "property_no_documents",
          propertyKind:
            itemSubtype === "vehicle"
              ? "vehicle"
              : itemSubtype === "pet"
                ? "pet"
                : "other_property",
        }
      : hasActionableInsights
        ? { kind: "no_plan_yet", inventoryId }
        : { kind: "needs_research" };

  return (
    <MaintenancePanel
      scope="item"
      tasks={tasks}
      completedThisYear={completedThisYear}
      mostRecentCompletion={
        mostRecent && mostRecent.title && mostRecent.completed_at
          ? {
              title: mostRecent.title,
              completed_at: mostRecent.completed_at,
            }
          : null
      }
      itemEmptyState={itemEmptyState}
    />
  );
}
