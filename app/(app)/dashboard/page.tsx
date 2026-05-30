import { redirect } from "next/navigation";
import { SectionHeader } from "@/components/ui";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { createClient } from "@/lib/supabase/server";
import type { House } from "@/types/house";
import { DashboardLive } from "./dashboard-live";
import { EmergencyReferencePanel } from "./emergency-reference-panel";
import { HabitatPreviewPanel } from "./habitat-preview-panel";
import { LifecycleOutlookPanel } from "./lifecycle-outlook-panel";
import { MaintenancePanelDashboard } from "./maintenance-panel-dashboard";

// Issue #139 replaced the hardcoded EMERGENCIES placeholder with the
// EmergencyReferencePanel, which fetches real hearth.documents rows of
// kind='emergency_procedure_video' and renders icon-dominant tiles in
// the four-category order (Water / Gas / Electrical / Other). The
// right column hosts the maintenance "On your plate" panel (issue
// #133). The earlier InventoryPreview is parked under `_unused/`.

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
        lifecycleOutlookSlot={<LifecycleOutlookPanel houseId={house.id} />}
      />

      {/*
        `min-w-0` on every grid item is load-bearing: grid items default to
        `min-width: auto` (= min-content), so any deep child with a wide
        intrinsic size (an absolutely-positioned image with natural
        dimensions ~1000px, a non-truncating long token, a fixed-width
        button) will push the column past the viewport on mobile and force
        iOS Safari into pinch-zoom-out mode. The button-level `w-full`
        fix on the emergency tile (#178) was not enough on its own — the
        column itself was over-sizing.
      */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4 min-w-0">
          <EmergencyReferencePanel houseId={data.id} />

          <div className="min-w-0">
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

        <div className="min-w-0">
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
