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
  // except when they're already on a public auth route.
  const isPublicRoute =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth");

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
