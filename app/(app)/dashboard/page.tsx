import Link from "next/link";
import { redirect } from "next/navigation";
import { EmergencyTile, EntityRow, SectionHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { DocumentTrigger, SAMPLE_DOCUMENT } from "@/components/document-modal";
import { HabitatFindingTileCompact } from "@/components/habitat-finding-tile-compact";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type { HabitatSeverity } from "@/lib/habitat/types";
import { createClient } from "@/lib/supabase/server";
import { DashboardLive } from "./dashboard-live";

// Sections below the hero are placeholders pending their own issues:
// - Appliances + the latest document tile (#TBD: inventory CRUD)
// - Emergencies (#TBD: emergency capture flow)
// They keep their hardcoded copy for now so the dashboard isn't half-empty
// during day-one demos; the hero + house facts above is what's live.

// Concerns first, positives last. Mirrors the ordering on /habitat — same
// rule, two surfaces. Extracting a shared helper for six lines is premature
// at two call sites.
const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  neutral: 4,
  good: 5,
};

type HabitatFindingPreviewRow = {
  module_key: string;
  severity: HabitatSeverity | null;
  headline: string | null;
  summary: string | null;
};

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

  const { data: habitatRows } = await supabase
    .from("habitat_findings")
    .select("module_key, severity, headline, summary")
    .eq("house_id", data.id)
    .eq("status", "completed");

  const habitatFindings = [
    ...((habitatRows ?? []) as HabitatFindingPreviewRow[]),
  ].sort((a, b) => {
    const wa = a.severity
      ? SEVERITY_WEIGHT[a.severity]
      : SEVERITY_WEIGHT.neutral;
    const wb = b.severity
      ? SEVERITY_WEIGHT[b.severity]
      : SEVERITY_WEIGHT.neutral;
    return wa - wb;
  });

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
            {habitatFindings.length > 0 ? (
              <div className="flex flex-col gap-2">
                {habitatFindings.map((row) => {
                  const habitatModule = HABITAT_MODULES.find(
                    (m) => m.key === row.module_key,
                  );
                  if (!habitatModule) return null;
                  if (!row.headline || !row.summary || !row.severity)
                    return null;

                  return (
                    <HabitatFindingTileCompact
                      key={row.module_key}
                      moduleLabel={habitatModule.name}
                      headline={row.headline}
                      summary={row.summary}
                      severity={row.severity}
                      iconImage={habitatModule.iconImage}
                    />
                  );
                })}
              </div>
            ) : (
              // First-run state: briefing/habitat workflows are still
              // discovering. The onboarding discovery modal narrates the
              // process; this placeholder keeps the dashboard layout
              // stable underneath while it runs.
              <div
                className="surface p-4 text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Looking up public records for your area…
              </div>
            )}
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
