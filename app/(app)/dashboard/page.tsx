import { redirect } from "next/navigation";
import { SectionHeader } from "@/components/ui";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { createClient } from "@/lib/supabase/server";
import type { House } from "@/types/house";
import { DashboardOnboarding } from "./dashboard-onboarding";
import { EmergencyReferencePanel } from "./emergency-reference-panel";
import { HabitatPreviewPanel } from "./habitat-preview-panel";
import { LifecycleOutlookPanel } from "./lifecycle-outlook-panel";
import { MaintenancePanelDashboard } from "./maintenance-panel-dashboard";
import { buildMilestones } from "./onboarding-milestones";

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

  // Onboarding milestones (issue #216). "Detect, don't track" — three of the
  // four completion signals are existence reads against tables that already
  // exist, and the fourth (habitat_reviewed) is a key off the house row we
  // already have in hand. Two cheap head:true counts cover inventory and
  // emergency videos; the home-photo and habitat signals read off `house`
  // directly. The panel itself renders nothing once everything is complete,
  // so this work is skipped visually for established users with no cost
  // beyond the two counts.
  const [{ count: inventoryCount }, { count: emergencyVideoCount }] =
    await Promise.all([
      supabase
        .from("inventory")
        .select("id", { count: "exact", head: true })
        .eq("house_id", data.id),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("house_id", data.id)
        .eq("kind", "emergency_procedure_video"),
    ]);

  const milestones = buildMilestones({
    hasHomePhoto: house.user_image_url !== null,
    hasEmergencyVideo: (emergencyVideoCount ?? 0) > 0,
    hasAppliance: (inventoryCount ?? 0) > 0,
    habitatReviewed: house.onboarding_state?.habitat_reviewed === true,
  });

  return (
    <div className="flex flex-col gap-6">
      {/*
        Onboarding milestones sit above the hero (issue #216): they're the
        first thing a new user should see post-setup, they're transient
        (gone once complete), and placing them above the hero means they
        don't permanently displace the hero/facts layout that is the
        dashboard's stable identity.

        The milestones panel and DashboardLive are rendered by a thin client
        coordinator (issue #220) that shares the home-details edit-modal open
        state and the go-deeper "reopen" flag between them — see
        DashboardOnboarding. It returns a fragment, so both stay direct flex
        children of this column.

        Key on the active house id so a property switch or delete forces a full
        remount rather than a prop-only update: the inner hooks
        (`useHouseRealtime`, `useHabitatFindings`) seed `useState` from
        `initialHouse` / `initialRows` once per mount and don't re-seed on prop
        change, so without a key change the post-delete `redirect("/dashboard")`
        would keep showing the previous (now-deleted) row. Keying here makes the
        property switch the unmount/remount boundary the hooks expect, and
        recomputes the milestone signals against the new house.
      */}
      <DashboardOnboarding
        key={house.id}
        houseId={house.id}
        milestones={milestones}
        celebrationSeen={
          house.onboarding_state?.foundation_celebration_seen === true
        }
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

          <div id="dashboard-habitat" className="min-w-0 scroll-mt-20">
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
