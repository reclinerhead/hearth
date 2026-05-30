"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";

type UseHouseRealtimeResult = {
  house: House | null;
  loading: boolean;
  error: string | null;
  /**
   * Imperative refetch. Write paths inside the hook's subtree call this
   * after their own UPDATE lands so the local row reflects the change
   * without depending on the Realtime broadcast (which is documented as
   * unreliable in some browsers — see docs/TechnicalGuide.md).
   */
  refetch: () => Promise<void>;
};

/**
 * Same-tab refresh signal for hearth.houses writes that happen outside
 * the DashboardLive subtree (e.g. the home-details edit modal mounted
 * inside TopNav). Components that subscribe via useHouseRealtime listen
 * for this event and call refetch() when the houseId matches.
 *
 * Belt-and-suspenders alongside Supabase Realtime — Realtime is the
 * primary path but is documented as unreliable in some browsers (see
 * docs/TechnicalGuide.md "Realtime and the browser"). Dispatching the
 * event guarantees an immediate refetch even when the websocket is
 * dead, without forcing the caller to plumb refetch through context.
 *
 * Write paths already inside DashboardLive (photo upload/remove,
 * refresh) keep calling refetch() inline — they don't need the event
 * because the hook is already in scope.
 */
export const HOUSE_UPDATED_EVENT = "hearth:house-updated";
export type HouseUpdatedEventDetail = { houseId: string };

export function dispatchHouseUpdated(houseId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HouseUpdatedEventDetail>(HOUSE_UPDATED_EVENT, {
      detail: { houseId },
    }),
  );
}

/**
 * Subscribe to a single hearth.houses row over Supabase Realtime.
 * Fetches the row once on mount, re-renders on every UPDATE event,
 * and exposes an imperative `refetch` for write paths that need to
 * pick up their own change immediately. Write paths outside the
 * hook's subtree can dispatch `HOUSE_UPDATED_EVENT` instead.
 *
 * Realtime broadcasts require the table to be in the `supabase_realtime`
 * publication (see migration 20260514180500). RLS on hearth.houses scopes
 * SELECT to owner_id = auth.uid(), so the channel needs the user's JWT to
 * pass the policy check on broadcast — that auth propagation is handled
 * by the cached singleton client in lib/supabase/client.ts.
 *
 * Issue #210 removed the briefing-status-driven polling fallback that
 * used to live here — the Zillow workflow it was bridging for is gone,
 * and the row only changes now from user-driven writes (the photo
 * upload/remove + the home-details modal), all of which call `refetch`
 * directly or dispatch HOUSE_UPDATED_EVENT.
 */
export function useHouseRealtime(
  houseId: string,
  initialHouse?: House,
): UseHouseRealtimeResult {
  // Seed from the server-passed snapshot when provided so first paint
  // is the final layout — no "Loading your house" flicker between the
  // server-rendered shell and the first client-side fetch. The
  // Realtime subscription and same-tab refresh listener below all run
  // identically either way.
  const [house, setHouse] = useState<House | null>(initialHouse ?? null);
  const [loading, setLoading] = useState(initialHouse === undefined);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("houses")
      .select("*")
      .eq("id", houseId)
      .single();
    // Don't surface transient fetch failures via setError — that would flash
    // an error banner on routine polling hiccups. Persistent failures will
    // manifest as a stale row, which is the lesser evil.
    if (fetchError || !data) return;
    setHouse(data as House);
  }, [houseId]);

  // Initial fetch + realtime subscription. Runs once per houseId.
  // The initial fetch is skipped when the caller already seeded us
  // with a server-rendered snapshot — the Realtime channel + polling
  // fallback below pick up any changes that have happened since.
  const hasInitialHouse = initialHouse !== undefined;
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadInitial() {
      const { data, error: fetchError } = await supabase
        .from("houses")
        .select("*")
        .eq("id", houseId)
        .single();
      if (cancelled) return;
      setLoading(false);
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      if (data) setHouse(data as House);
    }

    if (!hasInitialHouse) loadInitial();

    // Auth propagation to the realtime socket is handled by
    // @supabase/ssr's onAuthStateChange wiring inside the cached
    // singleton client (see lib/supabase/client.ts). Calling
    // realtime.setAuth() manually here used to cause a redundant
    // reconnect that churned the websocket, so we don't.
    const channel = supabase
      .channel(`house:${houseId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "hearth",
          table: "houses",
          filter: `id=eq.${houseId}`,
        },
        (payload: { new: Partial<House> }) => {
          if (cancelled) return;
          // hearth.houses uses REPLICA IDENTITY DEFAULT, so payload.new
          // only includes the primary key plus the columns that actually
          // changed. Merge into existing state rather than replacing.
          const partial = payload.new;
          setHouse((prev) =>
            prev ? { ...prev, ...partial } : (partial as House),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // hasInitialHouse is captured here so a (vanishingly unlikely) change
    // would cleanly re-run the subscribe + maybe-fetch sequence.
  }, [houseId, hasInitialHouse]);

  // Listen for same-tab house-updated events dispatched from write paths
  // outside this subtree (the home-details edit modal in TopNav). See
  // HOUSE_UPDATED_EVENT for the full rationale. We always refetch on
  // match — refetch is idempotent against the Realtime broadcast that
  // may or may not also fire, so worst case we update twice with the
  // same row.
  useEffect(() => {
    function onUpdated(e: Event) {
      const detail = (e as CustomEvent<HouseUpdatedEventDetail>).detail;
      if (detail?.houseId === houseId) {
        void refetch();
      }
    }
    window.addEventListener(HOUSE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(HOUSE_UPDATED_EVENT, onUpdated);
  }, [houseId, refetch]);

  return { house, loading, error, refetch };
}
