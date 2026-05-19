import { redirect } from "next/navigation";
import { EmergencyTile, SectionHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { createClient } from "@/lib/supabase/server";
import type { House } from "@/types/house";
import { DashboardLive } from "./dashboard-live";
import { HabitatPreviewPanel } from "./habitat-preview-panel";
import { InventoryPreview } from "./inventory-preview";

// Emergencies remains a placeholder pending its own issue (#TBD: emergency
// capture flow); the hardcoded copy keeps the dashboard layout populated
// for day-one demos. Inventory ships live as of #51 — InventoryPreview
// queries hearth.inventory for the current house and renders each item's
// most-recent attached document as a hero thumbnail (with a type-based
// fallback icon). `router.refresh()` from the Smart Uploader's onSaved
// callback re-runs this server component so newly saved items appear
// automatically.

const EMERGENCIES: { icon: IconName; label: string; hint: string }[] = [
  { icon: "droplet", label: "Water shutoff", hint: "Basement, NE corner" },
  { icon: "flame-burner", label: "Gas shutoff", hint: "Meter, side yard" },
  { icon: "bolt", label: "Electrical panel", hint: "Basement, by stairs" },
];

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch the full house row server-side so DashboardLive can render
  // its final layout on first paint without a client-side re-fetch.
  // The Realtime subscription + polling fallback inside useHouseRealtime
  // pick up any subsequent changes (briefing transitions, photo edits
  // from the home-details modal, etc.) — the initial fetch is the only
  // thing we skip on the client.
  const { data, error } = await supabase
    .from("houses")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  // Onboarding gate in proxy.ts ensures users have at least one house here,
  // but guard defensively in case of a race or session edge.
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
      <DashboardLive houseId={house.id} initialHouse={house} />

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
                  3 saved
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
              houseId={data.id}
              initialRows={initialHabitatRows}
            />
          </div>
        </div>

        <div>
          <SectionHeader
            eyebrow="Things inside and outside your house"
            title="Appliances"
            trailing={
              <a
                href="/appliances"
                className="text-small inline-flex items-center gap-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                See all
                <Icon name="chevron-right" size={14} />
              </a>
            }
          />
          <InventoryPreview houseId={data.id} />
        </div>
      </section>
    </div>
  );
}
