"use client";

import { useRouter } from "next/navigation";
import { markHabitatReviewedAction } from "@/app/actions/houses/mark-habitat-reviewed";
import { HabitatFindingTileCompact } from "@/components/habitat-finding-tile-compact";
import { HabitatFindingTrigger } from "@/components/habitat-finding-trigger";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type { HabitatSeverity } from "@/lib/habitat/types";
import {
  useHabitatFindings,
  type HabitatFindingRow,
} from "@/lib/hooks/use-habitat-findings";

/**
 * Client wrapper around the dashboard's Habitat preview tiles. Subscribes
 * to hearth.habitat_findings via Supabase Realtime so the panel updates
 * in place when the orchestrator writes a new finding — no manual page
 * reload required after onboarding or a manual briefing refresh.
 *
 * Server-rendered initial rows are passed in via `initialRows` so the
 * panel doesn't flash empty on first paint. The hook seeds its state
 * with those rows and overlays realtime events as they arrive.
 */

// Fixed display order for the dashboard's habitat list — a curated
// sequence that leads with our strongest module (water quality), then
// Superfund, radon, and flood zones. This is deliberately a *module*
// order, not the severity order below: the dashboard list is a showcase
// of what Hearth knows about the home, so its sequence is editorial and
// stable rather than reshuffling as findings change. (Distinct from the
// registry's array order, which paces the onboarding reveal fastest →
// slowest, and from the severity weight, which now only tie-breaks any
// future module not named here.)
const MODULE_ORDER: Record<string, number> = {
  water_quality_awareness: 0,
  epa_superfund_proximity: 1,
  epa_radon_zone: 2,
  fema_flood_zones: 3,
};
const moduleOrder = (key: string): number =>
  MODULE_ORDER[key] ?? Number.MAX_SAFE_INTEGER;

// Concerns first, positives last. Retained as the tie-break for any module
// absent from MODULE_ORDER (e.g. a newly-added one) so its tile still lands
// deterministically rather than at a random spot.
const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 0,
  concern: 1,
  caution: 2,
  neutral: 3,
  favorable: 4,
  beneficial: 5,
};

export function HabitatPreviewPanel({
  houseId,
  initialRows,
}: {
  houseId: string;
  initialRows: HabitatFindingRow[];
}) {
  const router = useRouter();
  const rows = useHabitatFindings(houseId, initialRows);

  // Sticky filter: show any row that has a severity populated, regardless
  // of current status. During a manual refresh the orchestrator briefly
  // sets status='running' (which only writes status/checked_at/error and
  // leaves severity/headline/summary intact under the upsert), so this
  // keeps the previously-completed tile visible until the new completed
  // upsert overwrites it. Avoids a flicker where tiles disappear and
  // reappear on every refresh.
  const visible = rows
    .filter(
      (row): row is HabitatFindingRow & {
        severity: HabitatSeverity;
        headline: string;
        summary: string;
      } =>
        row.severity !== null &&
        row.headline !== null &&
        row.summary !== null &&
        row.severity in SEVERITY_WEIGHT,
    )
    .sort((a, b) => {
      const byModule = moduleOrder(a.module_key) - moduleOrder(b.module_key);
      if (byModule !== 0) return byModule;
      return SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    });

  if (visible.length === 0) {
    // First-run state: orchestrator hasn't produced a usable row yet.
    // The onboarding discovery modal narrates progress on top; this
    // placeholder keeps the layout stable underneath while it runs.
    return (
      <div
        className="surface p-4 text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Looking up public records for your area…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((row) => {
        const habitatModule = HABITAT_MODULES.find(
          (m) => m.key === row.module_key,
        );
        // Defensive: a row whose module was removed from the registry
        // can't be rendered. The orchestrator owns cleanup; this surface
        // is read-only.
        if (!habitatModule) return null;
        return (
          <HabitatFindingTrigger
            key={row.module_key}
            row={row}
            habitatModule={habitatModule}
            houseId={houseId}
            title="Click to see how Hearth determined this finding"
            className="surface-ai block w-full p-3 sm:p-4 cursor-pointer transition-colors hover:border-(--color-border-emphasis) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
            // Opening any finding stamps the "review your habitat findings"
            // onboarding milestone (issue #216). Fire-and-forget — the modal
            // opens immediately and doesn't wait on the write. When the stamp
            // actually lands (the not-reviewed → reviewed transition), refresh
            // the route so the sibling milestone panel recomputes server-side
            // and the card drops / retire beat shows without a manual reload.
            onFirstOpen={() => {
              void markHabitatReviewedAction(houseId).then((result) => {
                if (result.ok && result.changed) router.refresh();
              });
            }}
          >
            <HabitatFindingTileCompact
              moduleLabel={habitatModule.name}
              headline={row.headline}
              summary={row.summary}
              severity={row.severity}
              iconImage={habitatModule.iconImage}
            />
          </HabitatFindingTrigger>
        );
      })}
      <p
        className="text-small mt-1"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Click any tile to see how Hearth determined the finding.
      </p>
    </div>
  );
}
