import { createBrowserClient } from "@supabase/ssr";

let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser-side Supabase client. Cached as a module-level singleton so the
 * whole app shares a single realtime websocket instead of spawning a new
 * one per component that calls createClient(). @supabase/ssr's
 * createBrowserClient does NOT memoize internally — every call constructs
 * a fresh client with its own realtime instance, which causes websocket
 * churn under React's effect lifecycle and breaks long-lived
 * subscriptions.
 */
export function createClient() {
  if (cachedClient) return cachedClient;
  cachedClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "hearth" },
    },
  );
  return cachedClient;
}
