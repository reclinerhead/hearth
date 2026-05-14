"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";

type UseHouseRealtimeResult = {
  house: House | null;
  loading: boolean;
  error: string | null;
};

/**
 * Subscribe to a single hearth.houses row over Supabase Realtime. Fetches
 * the row once on mount, then re-renders whenever an UPDATE event arrives.
 *
 * Realtime broadcasts require the table to be in the `supabase_realtime`
 * publication (see migration 20260514180500). RLS on hearth.houses already
 * scopes SELECT to owner_id = auth.uid(), so the channel only receives
 * events for rows the current user is allowed to see.
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

    async function loadInitial() {
      const { data, error: loadError } = await supabase
        .from("houses")
        .select("*")
        .eq("id", houseId)
        .single();

      if (cancelled) return;

      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      setHouse(data as House);
      setLoading(false);
    }

    loadInitial();

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
          // hearth.houses uses REPLICA IDENTITY DEFAULT, so payload.new only
          // includes the primary key plus the columns that actually changed.
          // Merge into existing state rather than replacing, or the address
          // and other unchanged fields would disappear on every update.
          const partial = payload.new as Partial<House>;
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

  return { house, loading, error };
}
