import Link from "next/link";
import { redirect } from "next/navigation";
import { EmergencyTile, EntityRow, SectionHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { DocumentTrigger, SAMPLE_DOCUMENT } from "@/components/document-modal";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { createClient } from "@/lib/supabase/server";
import { DashboardLive } from "./dashboard-live";
import { HabitatPreviewPanel } from "./habitat-preview-panel";

// Sections below the hero are placeholders pending their own issues:
// - Appliances + the latest document tile (#TBD: inventory CRUD)
// - Emergencies (#TBD: emergency capture flow)
// They keep their hardcoded copy for now so the dashboard isn't half-empty
// during day-one demos; the hero + house facts above is what's live.

const APPLIANCES: {
  icon: IconName;
  name: string;
  type: string;
  meta: string;
  href: string;
}[] = [
  {
    icon: "fridge",
    name: "Maytag refrigerator",
    type: "Kitchen",
    meta: "Filter due in 3 mo",
    href: "/entities/maytag-fridge",
  },
  {
    icon: "droplet",
    name: "Rheem water heater",
    type: "Basement",
    meta: "Installed Sep 2021",
    href: "/entities/rheem-water-heater",
  },
  {
    icon: "flame-burner",
    name: "Carrier furnace",
    type: "Basement",
    meta: "Tune-up due Oct 2026",
    href: "/entities/carrier-furnace",
  },
  {
    icon: "wind",
    name: "Trane central AC",
    type: "Side yard",
    meta: "Last serviced Apr 2025",
    href: "/entities/trane-ac",
  },
  {
    icon: "device-tv-old",
    name: "Maytag dishwasher",
    type: "Kitchen",
    meta: "Pump replaced Dec 2024",
    href: "/entities/maytag-dishwasher",
  },
];

const EMERGENCIES: { icon: IconName; label: string; hint: string }[] = [
  { icon: "droplet", label: "Water shutoff", hint: "Basement, NE corner" },
  { icon: "flame-burner", label: "Gas shutoff", hint: "Meter, side yard" },
  { icon: "bolt", label: "Electrical panel", hint: "Basement, by stairs" },
];

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("houses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  // Onboarding gate in proxy.ts ensures users have at least one house here,
  // but guard defensively in case of a race or session edge.
  if (error || !data?.id) {
    redirect("/onboarding");
  }

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
      "module_key, status, severity, headline, summary, findings, source_url, error",
    )
    .eq("house_id", data.id);

  const initialHabitatRows = (habitatRows ?? []) as HabitatFindingRow[];

  return (
    <div className="flex flex-col gap-6">
      <DashboardLive houseId={data.id} />

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
              trailing={
                <Link
                  href="/habitat"
                  className="text-small inline-flex items-center gap-1"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  See all
                  <Icon name="chevron-right" size={14} />
                </Link>
              }
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
          <div className="flex flex-col gap-2">
            {APPLIANCES.map((a) => (
              <EntityRow key={a.name} {...a} />
            ))}
          </div>

          <div className="mt-4">
            <DocumentTrigger
              document={SAMPLE_DOCUMENT}
              className="btn btn-ghost w-full justify-start"
            >
              <Icon name="file-text" size={16} />
              <span className="truncate">
                View latest document — drain pump receipt
              </span>
              <span
                aria-hidden
                className="ml-auto"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                <Icon name="chevron-right" size={14} />
              </span>
            </DocumentTrigger>
          </div>
        </div>
      </section>
    </div>
  );
}
