import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for background work that has no request
 * context (workflow steps, cron jobs, server-only utilities). Bypasses RLS,
 * so callers are responsible for scoping queries by id/owner themselves.
 *
 * Never import this from a route handler or server action that runs under
 * a user session — those should use the cookie-bound client in
 * `lib/supabase/server.ts` so RLS continues to enforce ownership.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createSupabaseClient(url, serviceKey, {
    db: { schema: "hearth" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
