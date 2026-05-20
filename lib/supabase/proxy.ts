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

  // Onboarding gate: authenticated users with no house in hearth.houses go
  // to /onboarding before any of the protected app routes. We skip this
  // check on public routes (which already render fine pre-house) and on
  // /onboarding itself (otherwise we'd loop). This adds one count query
  // per protected request; revisit if it shows up in perf work.
  if (user && !isPublicRoute && pathname !== "/onboarding") {
    const { count } = await supabase
      .from("houses")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
