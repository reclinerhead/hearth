import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Pulls the user's first house so the top nav can render the real address.
  // Returns null during onboarding (no house yet) and the TopNav hides the
  // address chunk in that case. Authenticated routes are protected by the
  // proxy gate, so the auth.getUser() call inside the supabase client picks
  // up the current user from cookies.
  const { data: house } = await supabase
    .from("houses")
    .select("address_line1, city, state")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return <AppShell house={house}>{children}</AppShell>;
}
