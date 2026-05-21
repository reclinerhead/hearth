import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveHouseId = string;

// The Hearth Supabase clients are instantiated with `db: { schema: "hearth" }`
// (see lib/supabase/server.ts and lib/supabase/client.ts), which @supabase/ssr
// flows into the SupabaseClient generic as `<any, "hearth", "hearth", ...>`.
// SupabaseClient's default generics are `<any, "public", "public", ...>`, and
// the SchemaName generic is invariant — so a bare `SupabaseClient` parameter
// would reject the schema-pinned instance the rest of the app uses. Widening
// to `<any, any, any>` accepts whatever the caller has without forcing them
// to launder the type at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Resolve the active house id for the current user.
 *
 * Returns the user's `active_house_id` from public.profiles if it points
 * to a house the user still owns. Falls back to the most recently
 * created house if `active_house_id` is null or stale (deleted house,
 * row the user doesn't own — shouldn't happen under RLS, but defense
 * in depth). Returns null only if the user has zero houses.
 *
 * Callers should pass the cookie-bound server client so RLS scopes the
 * read to the current user.
 */
export async function resolveActiveHouseId(
  supabase: AnySupabaseClient,
): Promise<ActiveHouseId | null> {
  // Read the user's profile to get their stored active house id.
  // public.profiles is not in the hearth schema, so we need an explicit
  // .schema("public") here (the clients default to schema: "hearth").
  const { data: profile } = await supabase
    .schema("public")
    .from("profiles")
    .select("active_house_id")
    .maybeSingle();

  // If they have an active_house_id, verify it points to a house they
  // still own. RLS scopes the SELECT to owner_id = auth.uid(), so a row
  // they don't own returns null even if the id is technically valid.
  if (profile?.active_house_id) {
    const { data: house } = await supabase
      .from("houses")
      .select("id")
      .eq("id", profile.active_house_id)
      .maybeSingle();
    if (house?.id) return house.id as string;
  }

  // Fallback: most recently created house the user owns.
  const { data: fallback } = await supabase
    .from("houses")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (fallback?.id as string | undefined) ?? null;
}
