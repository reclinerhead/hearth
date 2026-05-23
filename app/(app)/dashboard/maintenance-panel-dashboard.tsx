// Dashboard-scoped data wrapper for the "On your plate" maintenance
// panel (issue #133). House-scoped queries — every open scheduled task
// across the house plus the calendar-year completion summary for the
// Good Steward footer. Server component; the shared <MaintenancePanel>
// is the client half that decides the look.
//
// The dashboard panel surfaces every overdue row plus the next N
// upcoming rows under a single "Coming up" tier (the panel's
// comingUpLimit mode). This replaced the earlier 30-day window cap —
// post-#135 the synthesis pipeline emits fewer scheduled tasks per
// item, so a date window often left the panel sparse; a count cap
// keeps it consistently informative without growing unbounded. The
// full timeline lives at /maintenance behind the View all link.

import { MaintenancePanel } from "@/components/maintenance/maintenance-panel";
import type { MaintenancePanelTask } from "@/components/maintenance/maintenance-panel";
import { createClient } from "@/lib/supabase/server";

// Number of upcoming (non-overdue) tasks to show in the dashboard's
// "Coming up" tier. The panel surfaces every overdue row regardless,
// so the visible row count is `overdue + min(upcoming, this constant)`.
const DASHBOARD_COMING_UP_LIMIT = 6;

export async function MaintenancePanelDashboard({
  houseId,
}: {
  houseId: string;
}) {
  const supabase = await createClient();

  // Open tasks across the house, ordered ascending by next_due_at — the
  // panel splits these into overdue + the next N upcoming. Read uses the
  // partial index maintenance_tasks_house_open_by_due_idx.
  //
  // The inventory join surfaces the item name so each row can be
  // labelled "DISHWASHER · Check and refill rinse aid" rather than the
  // bare task title — without the context, a glance at the dashboard
  // doesn't tell the user which appliance a task is for.
  //
  // Per-use rows (issue #135 — "clean lint screen after every load",
  // "check rinse aid before every cycle") have no meaningful calendar
  // date, so they're excluded from this date-anchored dashboard panel.
  // They surface in the inventory detail page's panel as a dedicated
  // "Every time you use it" tier.
  const { data: openTasksRaw } = await supabase
    .from("maintenance_tasks")
    .select(
      `
      id, inventory_id, kind, title, subtitle, next_due_at, source,
      inventory ( name )
      `,
    )
    .eq("house_id", houseId)
    .eq("status", "open")
    .neq("cadence_kind", "per_use")
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

  const rows = (openTasksRaw ?? []) as Array<{
    id: string;
    inventory_id: string | null;
    kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
    title: string;
    subtitle: string | null;
    next_due_at: string;
    source: "direct_event" | "synthesis";
    inventory: { name: string } | { name: string }[] | null;
  }>;

  const tasks: MaintenancePanelTask[] = rows.map((r) => {
    const inv = Array.isArray(r.inventory) ? r.inventory[0] : r.inventory;
    return {
      id: r.id,
      inventory_id: r.inventory_id,
      kind: r.kind,
      title: r.title,
      subtitle: r.subtitle,
      next_due_at: r.next_due_at,
      source: r.source,
      inventoryName: inv?.name ?? null,
    };
  });

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
      comingUpLimit={DASHBOARD_COMING_UP_LIMIT}
    />
  );
}
