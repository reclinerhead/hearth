// Dashboard-scoped data wrapper for the "On your plate" maintenance
// panel (issue #133). House-scoped queries — every open task across the
// house, plus the calendar-year completion summary for the Good Steward
// footer. Server component; the shared <MaintenancePanel> is the client
// half that decides the look.

import { MaintenancePanel } from "@/components/maintenance/maintenance-panel";
import type { MaintenancePanelTask } from "@/components/maintenance/maintenance-panel";
import { createClient } from "@/lib/supabase/server";

export async function MaintenancePanelDashboard({
  houseId,
}: {
  houseId: string;
}) {
  const supabase = await createClient();

  // Open tasks across the house, ordered ascending by next_due_at — the
  // tier-grouping helper re-buckets these into overdue / next30 / later
  // and re-sorts within each tier. Read uses the partial index
  // maintenance_tasks_house_open_by_due_idx.
  const { data: openTasksRaw } = await supabase
    .from("maintenance_tasks")
    .select(
      "id, inventory_id, kind, title, subtitle, next_due_at, source",
    )
    .eq("house_id", houseId)
    .eq("status", "open")
    .order("next_due_at", { ascending: true });

  // count + select-most-recent need to be two queries: head:true counts
  // can't be combined with a limit-1 select cleanly, and a single query
  // returning every completed row just to pluck the first would over-
  // fetch as history grows.
  const yearStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), 0, 1),
  ).toISOString();
  const [{ count: completedThisYearRaw }, { data: mostRecent }] =
    await Promise.all([
      supabase
        .from("maintenance_tasks")
        .select("id", { count: "exact", head: true })
        .eq("house_id", houseId)
        .eq("status", "completed")
        .gte("completed_at", yearStart),
      supabase
        .from("maintenance_tasks")
        .select("title, completed_at")
        .eq("house_id", houseId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const tasks = (openTasksRaw ?? []) as MaintenancePanelTask[];
  const completedThisYear = completedThisYearRaw ?? 0;

  return (
    <MaintenancePanel
      scope="house"
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
    />
  );
}
