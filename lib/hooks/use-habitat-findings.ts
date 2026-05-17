"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Row shape returned by the hook. Matches the column set the dashboard
 * preview panel and the first-run discovery modal both rely on — kept
 * broad enough that both consumers can read directly from it without a
 * second query. Add a column here if a future consumer needs one; the
 * SELECT below is the single source of truth.
 */
export type HabitatFindingRow = {
  module_key: string;
  status: string;
  severity: string | null;
  headline: string | null;
  summary: string | null;
  findings: Record<string, unknown> | null;
  source_url: string | null;
  error: string | null;
};

const SELECT_COLUMNS =
  "module_key, status, severity, headline, summary, findings, source_url, error";

// Belt-and-suspenders polling cadence for environments where Realtime is
// blocked (browser extensions, tracking-prevention). Matches the cadence
// used by useHouseRealtime so the two feel consistent under degraded
// transport conditions.
const POLL_INTERVAL_MS = 2500;

/**
 * Subscribe to every hearth.habitat_findings row for a given house.
 * Fetches once on mount (skipped if `initialRows` is provided so a
 * server-hydrated parent doesn't double-render), then merges INSERT and
 * UPDATE events into local state keyed by `module_key`. Also polls every
 * few seconds as a fallback for environments where the websocket is
 * blocked.
 *
 * REPLICA IDENTITY on habitat_findings is the Postgres default
 * (primary key only), so `payload.new` may not include every column for
 * UPDATE events. The merge below preserves existing fields and overlays
 * only what arrives — mirrors the pattern in useHouseRealtime.
 *
 * Realtime broadcasts require the table to be in the `supabase_realtime`
 * publication (enabled in migration 20260515165033). RLS scopes SELECT
 * to the house's owner, so the channel needs the user's JWT to receive
 * events — that auth propagation is handled by the cached singleton
 * client in lib/supabase/client.ts.
 */
export function useHabitatFindings(
  houseId: string,
  initialRows: HabitatFindingRow[] = [],
): HabitatFindingRow[] {
  const [rows, setRows] = useState<HabitatFindingRow[]>(initialRows);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadAll() {
      const { data } = await supabase
        .from("habitat_findings")
        .select(SELECT_COLUMNS)
        .eq("house_id", houseId);
      if (cancelled || !data) return;
      setRows(data as HabitatFindingRow[]);
    }

    // If the parent server-rendered the initial rows, skip the initial
    // refetch — it would just produce an identical payload and a wasted
    // render. The realtime subscription below picks up everything that
    // changes from this point forward.
    if (initialRows.length === 0) {
      loadAll();
    }

    const channel = supabase
      .channel(`habitat_findings:${houseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "hearth",
          table: "habitat_findings",
          filter: `house_id=eq.${houseId}`,
        },
        (payload: {
          new: Partial<HabitatFindingRow> & { module_key?: string };
        }) => {
          if (cancelled) return;
          const incoming = payload.new;
          if (!incoming?.module_key) return;
          setRows((prev) => {
            const existing = prev.find(
              (r) => r.module_key === incoming.module_key,
            );
            const merged: HabitatFindingRow = existing
              ? { ...existing, ...incoming }
              : (incoming as HabitatFindingRow);
            const others = prev.filter(
              (r) => r.module_key !== incoming.module_key,
            );
            return [...others, merged];
          });
        },
      )
      .subscribe();

    const pollTimer = setInterval(() => {
      if (cancelled) return;
      loadAll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
    // initialRows is intentionally omitted from the dependency array —
    // it's a one-shot hydration seed, not a reactive prop. Changing it
    // shouldn't tear down and rebuild the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId]);

  return rows;
}
