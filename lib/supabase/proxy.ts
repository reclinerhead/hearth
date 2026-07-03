import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "hearth" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Avoid writing any code between createServerClient
  // and supabase.auth.getUser(). A simple mistake could make it
  // very hard to debug issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Route protection: redirect unauthenticated users to /login,
  // except when they're already on a public auth route. `/api/cron/*`
  // is public here because a Vercel Cron request carries no session
  // cookie — without the exemption the auth gate would 307 it to /login
  // and the handler would never run. The handlers themselves gate on the
  // `Authorization: Bearer ${CRON_SECRET}` header Vercel sends, so they're
  // not actually open (see app/api/cron/storage-sweep/route.ts).
  //
  // The app/(public)/ route group (epic #298) adds the place-keyed
  // public pages: /water/* and the /how-it-works methodology page.
  // Segment-exact matching on purpose — a bare startsWith("/water")
  // would also exempt any future /water-adjacent authenticated route.
  // /sitemap.xml and /robots.txt are crawler entry points that must
  // never bounce to /login — they pass through the proxy because the
  // root matcher only excludes _next internals and image files.
  const isPublicRoute =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/how-it-works" ||
    pathname === "/water" ||
    pathname.startsWith("/water/") ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Onboarding gate: authenticated users with no house go to /onboarding
  // before any of the protected app routes. /houses/new is the existing-
  // user add path and has its own gate below — it's exempt here because
  // we only want it to handle add-property navigation for users who
  // already have at least one house (zero-house users still belong on
  // /onboarding). One COUNT query per protected request; revisit if it
  // shows up in perf work.
  if (
    user &&
    !isPublicRoute &&
    pathname !== "/onboarding" &&
    pathname !== "/houses/new"
  ) {
    const { count } = await supabase
      .from("houses")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  // Add-property gate: /houses/new requires the capability AND at least
  // one existing house. The page itself re-checks both as defense in
  // depth. Inlined rather than calling resolveUserCapabilities so the
  // proxy doesn't pull app-layer helpers; one COUNT plus one profile
  // read costs the same as the page would do.
  if (user && pathname === "/houses/new") {
    const [{ count }, { data: profile }] = await Promise.all([
      supabase.from("houses").select("id", { count: "exact", head: true }),
      supabase
        .schema("public")
        .from("profiles")
        .select("plan_tier, is_admin")
        .maybeSingle(),
    ]);

    if ((count ?? 0) === 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }

    const canCreate =
      profile?.is_admin === true || profile?.plan_tier === "premium";
    if (!canCreate) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
