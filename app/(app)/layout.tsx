import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Pulls the user's first house. The address subset feeds the top-nav
  // address chip; the rest seeds the home-details edit modal that lives
  // in the top nav (see components/edit-home-details-modal.tsx). One
  // select keeps both surfaces on the same row snapshot without a second
  // round trip when the modal opens. Returns null during onboarding (no
  // house yet) and the TopNav hides the address + Home details menu item
  // in that case. Authenticated routes are protected by the proxy gate,
  // so the auth.getUser() call inside the supabase client picks up the
  // current user from cookies.
  const { data: house } = await supabase
    .from("houses")
    .select(
      "id, address_line1, address_line2, city, state, postal_code, year_built, living_area_sqft, lot_size_sqft, bedrooms, bathrooms, purchase_date",
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return <AppShell house={house}>{children}</AppShell>;
}
