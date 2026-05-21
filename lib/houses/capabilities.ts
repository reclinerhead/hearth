import type { SupabaseClient } from "@supabase/supabase-js";

export type UserCapabilities = {
  canCreateAdditionalHouse: boolean;
  canSwitchHouses: boolean; // True iff user has 2+ houses
  isAdmin: boolean;
  planTier: "free" | "premium";
};

// See lib/houses/active-house.ts for why this is widened past the default
// SupabaseClient generics — the Hearth clients are pinned to schema "hearth"
// and the SchemaName generic is invariant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Resolve the current user's capabilities. Called from the (app) layout
 * once per request and threaded through props to the surfaces that need
 * it (top nav for the switcher, /houses/new gate, etc).
 *
 * `canCreateAdditionalHouse` is the gate the dropdown's "+ Add property"
 * action and the /houses/new server action both check. Today it's
 * "premium OR admin". When trial / referral / contractor-gets-N-free
 * lands, this is the only function that changes.
 */
export async function resolveUserCapabilities(
  supabase: AnySupabaseClient,
): Promise<UserCapabilities> {
  const { data: profile } = await supabase
    .schema("public")
    .from("profiles")
    .select("plan_tier, is_admin")
    .maybeSingle();

  const { count } = await supabase
    .from("houses")
    .select("id", { count: "exact", head: true });

  const planTier = (profile?.plan_tier ?? "free") as "free" | "premium";
  const isAdmin = Boolean(profile?.is_admin);
  const houseCount = count ?? 0;

  return {
    canCreateAdditionalHouse: isAdmin || planTier === "premium",
    canSwitchHouses: houseCount >= 2,
    isAdmin,
    planTier,
  };
}
