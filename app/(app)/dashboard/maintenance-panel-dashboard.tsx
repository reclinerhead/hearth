// Dashboard-scoped data wrapper for the "On your plate" maintenance
// panel (issue #133). House-scoped queries — every open task across the
// house *due in the next 30 days* (or overdue), plus the calendar-year
// completion summary for the Good Steward footer. Server component; the
// shared <MaintenancePanel> is the client half that decides the look.
//
// The 30-day cap is what keeps the panel a "what's on plate now"
// surface instead of a complete task log — the full timeline lives at
// /maintenance behind the View all link. Overdue rows always come
// through (next_due_at <= today + 30 days includes any past date).

import { MaintenancePanel } from "@/components/maintenance/maintenance-panel";
import type { MaintenancePanelTask } from "@/components/maintenance/maintenance-panel";
import { createClient } from "@/lib/supabase/server";

export async function MaintenancePanelDashboard({
  houseId,
}: {
  houseId: string;
}) {
  const supabase = await createClient();

  // Compute the 30-day horizon cutoff as a YYYY-MM-DD string (matches
  // the `date` column type and keeps the comparison calendar-day).
  const todayPlus30 = formatDateOnly(addDays(new Date(), 30));

  // Open tasks across the house, ordered ascending by next_due_at — the
  // tier-grouping helper re-buckets these into overdue / next30 / later
  // and re-sorts within each tier. Read uses the partial index
  // maintenance_tasks_house_open_by_due_idx.
  //
  // The inventory join surfaces the item name so each row can be
  // labelled "DISHWASHER · Check and refill rinse aid" rather than the
  // bare task title — without the context, a glance at the dashboard
  // doesn't tell the user which appliance a task is for.
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
    .lte("next_due_at", todayPlus30)
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
    />
  );
}

function addDays(d: Date, days: number): Date {
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
