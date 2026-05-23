import { redirect } from "next/navigation";
import { EmergencyTile, SectionHeader } from "@/components/ui";
import type { IconName } from "@/components/icon";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { createClient } from "@/lib/supabase/server";
import type { House } from "@/types/house";
import { DashboardLive } from "./dashboard-live";
import { HabitatPreviewPanel } from "./habitat-preview-panel";
import { MaintenancePanelDashboard } from "./maintenance-panel-dashboard";

// Emergencies remains a placeholder pending its own issue (#TBD: emergency
// capture flow); the hardcoded copy keeps the dashboard layout populated
// for day-one demos. The right column hosts the maintenance "On your
// plate" panel (issue #133), which queries hearth.maintenance_tasks for
// the active house and surfaces overdue / next-30 / later tiers with a
// Good Steward footer. The earlier InventoryPreview is parked under
// `_unused/` — kept around in case we want it as a sidebar surface
// elsewhere later.

const EMERGENCIES: { icon: IconName; label: string; hint: string }[] = [
  { icon: "droplet", label: "Water shutoff", hint: "Basement, NE corner" },
];

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch the full house row server-side so DashboardLive can render
  // its final layout on first paint without a client-side re-fetch.
  // The Realtime subscription + polling fallback inside useHouseRealtime
  // pick up any subsequent changes (briefing transitions, photo edits
  // from the home-details modal, etc.) — the initial fetch is the only
  // thing we skip on the client.
  const activeHouseId = await resolveActiveHouseId(supabase);

  // Onboarding gate in proxy.ts ensures users have at least one house here,
  // and resolveActiveHouseId returns null only when the user has zero
  // houses, but guard defensively in case of a race or session edge.
  if (!activeHouseId) {
    redirect("/onboarding");
  }

  const { data, error } = await supabase
    .from("houses")
    .select("*")
    .eq("id", activeHouseId)
    .single();

  if (error || !data?.id) {
    redirect("/onboarding");
  }

  const house = data as House;

  // Server-side seed for the Habitat panel. The panel itself is a client
  // component that subscribes to habitat_findings via Supabase Realtime,
  // so this initial fetch only exists to avoid a first-paint flash before
  // hydration. The SELECT column set must match HabitatFindingRow in the
  // shared hook so the seed is type-compatible with realtime payloads.
  // No status filter — the panel applies its own sticky "severity is
  // populated" filter so tiles don't flicker out during a re-check.
  const { data: habitatRows } = await supabase
    .from("habitat_findings")
    .select(
      "module_key, status, severity, headline, summary, findings, source_url, error, actions, activity_log, checked_at",
    )
    .eq("house_id", data.id);

  const initialHabitatRows = (habitatRows ?? []) as HabitatFindingRow[];

  return (
    <div className="flex flex-col gap-6">
      {/*
        Key the two client components below on the active house id so a
        property switch or property delete forces a full remount rather
        than a prop-only update. Their internal hooks
        (`useHouseRealtime`, `useHabitatFindings`) seed `useState` from
        `initialHouse` / `initialRows` exactly once per mount and don't
        re-seed when the prop changes — so without a key change, after
        the post-delete `redirect("/dashboard")` re-renders this server
        component with a new house, the client tree would keep
        displaying the previous (now-deleted) row until something
        triggered a manual refetch. Keying on house id makes the active
        property switch the unmount/remount boundary that hooks already
        expect.
      */}
      <DashboardLive
        key={house.id}
        houseId={house.id}
        initialHouse={house}
      />

      <section className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div>
            <SectionHeader
              eyebrow="If something goes wrong"
              title="Emergencies"
              trailing={
                <span
                  className="text-small"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  1 saved
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3">
              {EMERGENCIES.map((e) => (
                <EmergencyTile key={e.label} {...e} />
              ))}
              <EmergencyTile
                icon="plus"
                label="Add an emergency"
                hint="Pin a shutoff or hazard"
                variant="add"
              />
            </div>
          </div>

          <div>
            <SectionHeader
              eyebrow="The world around your house"
              title="Habitat"
            />
            <HabitatPreviewPanel
              key={data.id}
              houseId={data.id}
              initialRows={initialHabitatRows}
            />
          </div>
        </div>

        <div>
          {/*
            MaintenancePanelDashboard renders its own SectionHeader so the
            populated and empty-state branches stay consistent — the
            populated header carries the overdue/total count chips, the
            empty state stands alone. The "See all" link to /inventory
            moves with the InventoryPreview component to `_unused/`; the
            top nav already exposes Inventory.
          */}
          <MaintenancePanelDashboard houseId={data.id} />
        </div>
      </section>
    </div>
  );
}
