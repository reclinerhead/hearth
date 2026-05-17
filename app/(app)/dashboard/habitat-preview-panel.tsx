"use client";

import { HabitatFindingTileCompact } from "@/components/habitat-finding-tile-compact";
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

// Concerns first, positives last. Mirrors the ordering on /habitat and
// /dashboard's previous server-side sort — same rule, now applied in
// the client because the rows change over the page's lifetime.
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
    .sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity]);

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
  );
}
