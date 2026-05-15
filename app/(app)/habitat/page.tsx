import { HabitatFindingTile } from "@/components/habitat-finding-tile";
import { SectionHeader } from "@/components/ui";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type {
  FindingAction,
  HabitatSeverity,
} from "@/lib/habitat/types";
import { createClient } from "@/lib/supabase/server";

// Concerns first, positives last — matches the suggested ordering noted
// in lib/habitat/types.ts and the create_habitat_findings_table migration.
const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  neutral: 4,
  good: 5,
};

type HabitatFindingRow = {
  module_key: string;
  severity: HabitatSeverity | null;
  headline: string | null;
  summary: string | null;
  source_url: string | null;
  actions: FindingAction[] | null;
};

export default async function HabitatPage() {
  const supabase = await createClient();

  // Single-house assumption mirrors the rest of the app. The proxy
  // redirects unauthenticated users away before this renders and sends
  // signed-in users with no house through /onboarding, so a null house
  // here is an unexpected state — degrade gracefully rather than throw.
  const { data: house } = await supabase
    .from("houses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!house) return null;

  const { data: findingsData } = await supabase
    .from("habitat_findings")
    .select("module_key, severity, headline, summary, source_url, actions")
    .eq("house_id", house.id)
    .eq("status", "completed");

  const findings = (findingsData ?? []) as HabitatFindingRow[];

  const sortedFindings = [...findings].sort((a, b) => {
    const wa = a.severity ? SEVERITY_WEIGHT[a.severity] : SEVERITY_WEIGHT.neutral;
    const wb = b.severity ? SEVERITY_WEIGHT[b.severity] : SEVERITY_WEIGHT.neutral;
    return wa - wb;
  });

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        eyebrow="The world around your house"
        title="Habitat"
      />

      {sortedFindings.length > 0 ? (
        // Cap at two tiles per row at md+. With a single finding, drop to
        // one column so the tile stretches to the container width instead
        // of sitting in a half-width cell with a visual hole next to it.
        // Single-column on small screens regardless.
        <div
          className={`grid gap-4 ${
            sortedFindings.length > 1 ? "md:grid-cols-2" : ""
          }`}
        >
          {sortedFindings.map((row) => {
            const habitatModule = HABITAT_MODULES.find(
              (m) => m.key === row.module_key,
            );
            // Defensive: if a module was removed from the registry but
            // findings rows remain, skip rather than crash. The orchestrator
            // owns cleanup; the dashboard read path is read-only.
            if (!habitatModule) return null;
            if (!row.headline || !row.summary || !row.severity) return null;

            return (
              <HabitatFindingTile
                key={row.module_key}
                moduleLabel={habitatModule.name}
                headline={row.headline}
                summary={row.summary}
                severity={row.severity}
                iconImage={habitatModule.iconImage}
                actions={row.actions}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
