/**
 * Human place names for a watched water system (issue #331).
 *
 * The slug registry (`lib/public-pages/slugs.ts`) is the first source of
 * truth — it carries the curated "Kalamazoo" / "Kalamazoo, Michigan"
 * strings. A source outside the registry falls back to the EPA inventory
 * record (`water_systems.city_name` / `pws_name`). PWSIDs are never
 * rendered — every caller goes through this so copy stays honest to the
 * hub's "no machine identifiers in user-visible copy" invariant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWaterSystemEntryByPwsid } from "@/lib/public-pages/slugs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

export type PlaceNames = {
  /** "Kalamazoo" */
  shortPlace: string;
  /** "Kalamazoo, Michigan" */
  placeName: string;
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function resolvePlaceNames(
  supabase: AnySupabaseClient,
  pwsids: readonly string[],
): Promise<Map<string, PlaceNames>> {
  const out = new Map<string, PlaceNames>();
  const missing: string[] = [];
  for (const pwsid of pwsids) {
    const entry = resolveWaterSystemEntryByPwsid(pwsid);
    if (entry) out.set(pwsid, { shortPlace: entry.shortPlace, placeName: entry.placeName });
    else missing.push(pwsid);
  }
  if (missing.length > 0) {
    const { data } = await supabase
      .from("water_systems")
      .select("pwsid, pws_name, city_name, state_code")
      .in("pwsid", missing);
    for (const row of (data ?? []) as {
      pwsid: string;
      pws_name: string;
      city_name: string | null;
      state_code: string | null;
    }[]) {
      const short = row.city_name ? titleCase(row.city_name) : titleCase(row.pws_name);
      const long = row.state_code ? `${short}, ${row.state_code}` : short;
      out.set(row.pwsid, { shortPlace: short, placeName: long });
    }
  }
  for (const pwsid of missing) {
    if (!out.has(pwsid)) out.set(pwsid, { shortPlace: "your city", placeName: "your city" });
  }
  return out;
}
