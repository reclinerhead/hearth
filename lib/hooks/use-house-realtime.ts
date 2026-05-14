"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";

type UseHouseRealtimeResult = {
  house: House | null;
  loading: boolean;
  error: string | null;
};

// Polling fallback for the period between insert and briefing completion.
// Realtime is the primary path, but if the websocket auth race or any other
// transport issue eats an UPDATE, the dashboard would sit on the initial
// snapshot forever. A short refetch interval bounds that to a few seconds
// of staleness; once briefing_status reaches a terminal state we stop.
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_DURATION_MS = 90_000;

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * Subscribe to a single hearth.houses row over Supabase Realtime. Fetches
 * the row once on mount, re-renders whenever an UPDATE event arrives, and
 * polls every few seconds while briefing_status is non-terminal as a
 * fallback for Realtime auth/transport hiccups.
 *
 * Realtime broadcasts require the table to be in the `supabase_realtime`
 * publication (see migration 20260514180500). RLS on hearth.houses scopes
 * SELECT to owner_id = auth.uid(), so the channel needs the user's JWT to
 * pass the policy check on broadcast — we call `supabase.realtime.setAuth`
 * with the access token before subscribing so the JWT is present.
 *
 * This hook is intentionally generic to a single row, not Zillow-specific
 * — every future "live dashboard data" feature will reuse it.
 */
export function useHouseRealtime(houseId: string): UseHouseRealtimeResult {
  const [house, setHouse] = useState<House | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const pollStart = Date.now();

    function scheduleNextPoll(current: House | null) {
      if (cancelled) return;
      if (!current) return;
      if (TERMINAL_STATUSES.has(current.briefing_status)) return;
      if (Date.now() - pollStart > POLL_MAX_DURATION_MS) return;
      pollTimer = setTimeout(refetch, POLL_INTERVAL_MS);
    }

    async function fetchRow(): Promise<House | null> {
      const { data, error: fetchError } = await supabase
        .from("houses")
        .select("*")
        .eq("id", houseId)
        .single();
      if (fetchError) {
        if (!cancelled) setError(fetchError.message);
        return null;
      }
      return data as House;
    }

    async function loadInitial() {
      const row = await fetchRow();
      if (cancelled) return;
      setLoading(false);
      if (row) {
        setHouse(row);
        scheduleNextPoll(row);
      }
    }

    async function refetch() {
      const row = await fetchRow();
      if (cancelled || !row) return;
      setHouse(row);
      scheduleNextPoll(row);
    }

    async function setupRealtime() {
      // Bind the user's JWT to the Realtime socket BEFORE subscribing —
      // otherwise the broadcast hits RLS as anon and the policy rejects
      // the event silently. createBrowserClient propagates auth to the
      // socket eventually via onAuthStateChange, but the timing races
      // with our subscribe() call so set it explicitly here.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return null;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }

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
          (payload) => {
            if (cancelled) return;
            // hearth.houses uses REPLICA IDENTITY DEFAULT, so payload.new
            // only includes the primary key plus the columns that actually
            // changed. Merge into existing state rather than replacing.
            const partial = payload.new as Partial<House>;
            setHouse((prev) =>
              prev ? { ...prev, ...partial } : (partial as House),
            );
          },
        )
        .subscribe();
      return channel;
    }

    loadInitial();
    const channelPromise = setupRealtime();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      channelPromise.then((ch) => {
        if (ch) supabase.removeChannel(ch);
      });
    };
  }, [houseId]);

  return { house, loading, error };
}
