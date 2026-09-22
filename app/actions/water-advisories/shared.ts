import type { SupabaseClient, User } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

export const ADMIN_WATER_ADVISORIES_PATH = "/admin/water-advisories";

export type AdminCheck =
  | { ok: true; user: User; label: string }
  | { ok: false; error: string };

/**
 * Resolve the signed-in admin for the water advisory actions (issue #331).
 * The database policies (hearth.is_admin()) are the real gate; this check
 * exists so a non-admin gets a readable message instead of an RLS error,
 * and so every action has the admin's display label for the
 * "{who} added you" line without a second read.
 */
export async function requireAdmin(supabase: AnySupabaseClient): Promise<AdminCheck> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in to do that." };

  const { data: profile } = await supabase
    .schema("public")
    .from("profiles")
    .select("is_admin")
    .maybeSingle();
  if (profile?.is_admin !== true) {
    return { ok: false, error: "Only admins can manage advisory subscribers." };
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const label =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    user.email ||
    "a Hearth admin";

  return { ok: true, user, label };
}
