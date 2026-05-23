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

export async function MaintenancePanelItem({
  inventoryId,
  hasActionableInsights,
}: {
  inventoryId: string;
  /**
   * Whether `ai_insights.maintenance` is populated on the inventory row.
   * Drives the discriminated empty state: insights present → "build a
   * plan"; insights missing → "run Research first".
   */
  hasActionableInsights: boolean;
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

  const tasks = (openTasksRaw ?? []) as MaintenancePanelTask[];
  const completedThisYear = completedThisYearRaw ?? 0;

  const itemEmptyState: ItemEmptyState = hasActionableInsights
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
