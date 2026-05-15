"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";

type UseHouseRealtimeResult = {
  house: House | null;
  loading: boolean;
  error: string | null;
};

// Polling cadence for the fallback. Realtime is the primary path, but if
// the websocket is blocked (browser extensions, tracking-prevention) or
// flakes for any other reason, polling fills in. The interval is short
// enough that a manual refresh feels responsive even when the websocket
// is dead.
const POLL_INTERVAL_MS = 2500;

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

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

  return { house, loading, error };
}
