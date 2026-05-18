"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";

type UseHouseRealtimeResult = {
  house: House | null;
  loading: boolean;
  error: string | null;
  /**
   * Imperative refetch. Lets callers drive polling for cases the hook's
   * status-based polling can't reach on its own — most notably, polling
   * during a just-clicked manual refresh while briefing_status is still
   * 'completed' from the previous run, so the hook hasn't yet observed
   * the transition that would kick its own polling on.
   */
  refetch: () => Promise<void>;
};

// Polling cadence for the fallback. Realtime is the primary path, but if
// the websocket is blocked (browser extensions, tracking-prevention) or
// flakes for any other reason, polling fills in. The interval is short
// enough that a manual refresh feels responsive even when the websocket
// is dead.
const POLL_INTERVAL_MS = 2500;

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

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
 * regenerate-image, refresh-briefing) keep calling refetch() inline —
 * they don't need the event because the hook is already in scope.
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
 * Subscribe to a single hearth.houses row over Supabase Realtime, with a
 * polling fallback that activates whenever briefing_status is non-terminal.
 * Fetches the row once on mount, re-renders on every UPDATE event, and
 * polls every few seconds while the briefing is in flight.
 *
 * The polling effect is keyed on briefing_status, so it naturally restarts
 * each time the row transitions from a terminal state ('completed' /
 * 'failed') back to a non-terminal state — e.g., after a manual refresh
 * kicks the workflow off again. That means users on flaky realtime
 * transports still see the updated row within a poll interval, not
 * "never until they reload the page."
 *
 * Realtime broadcasts require the table to be in the `supabase_realtime`
 * publication (see migration 20260514180500). RLS on hearth.houses scopes
 * SELECT to owner_id = auth.uid(), so the channel needs the user's JWT to
 * pass the policy check on broadcast — that auth propagation is handled
 * by the cached singleton client in lib/supabase/client.ts.
 *
 * This hook is intentionally generic to a single row, not Zillow-specific
 * — every future "live dashboard data" feature will reuse it.
 */
export function useHouseRealtime(houseId: string): UseHouseRealtimeResult {
  const [house, setHouse] = useState<House | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const briefingStatus = house?.briefing_status;

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

    loadInitial();

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
  }, [houseId]);

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

  // Polling fallback. Active only while briefing_status is non-terminal,
  // and re-triggered each time status transitions back into a non-terminal
  // state. The effect tears down (cleanup clears the timer) when status
  // reaches a terminal value or the component unmounts.
  useEffect(() => {
    if (!briefingStatus) return;
    if (TERMINAL_STATUSES.has(briefingStatus)) return;

    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (cancelled) return;
      const { data } = await supabase
        .from("houses")
        .select("*")
        .eq("id", houseId)
        .single();
      if (cancelled || !data) return;
      const fresh = data as House;
      setHouse(fresh);
      if (!TERMINAL_STATUSES.has(fresh.briefing_status)) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [houseId, briefingStatus]);

  return { house, loading, error, refetch };
}
