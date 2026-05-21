import { AppShell } from "@/components/app-shell";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { resolveUserCapabilities } from "@/lib/houses/capabilities";
import { createClient } from "@/lib/supabase/server";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Resolve which house the user is currently viewing across devices.
  // `resolveActiveHouseId` honors public.profiles.active_house_id when
  // set and falls back to the most-recently-created owned house.
  // Returns null during onboarding (no house yet), in which case the
  // TopNav hides the address chip + Home details menu item.
  const activeHouseId = await resolveActiveHouseId(supabase);

  // The address subset feeds the top-nav address chip; the rest seeds
  // the home-details edit modal that lives in the top nav (see
  // components/edit-home-details-modal.tsx). One select keeps both
  // surfaces on the same row snapshot without a second round trip when
  // the modal opens. Authenticated routes are protected by the proxy
  // gate, so the auth.getUser() call inside the supabase client picks
  // up the current user from cookies.
  const { data: house } = activeHouseId
    ? await supabase
        .from("houses")
        .select(
          "id, address_line1, address_line2, city, state, postal_code, year_built, living_area_sqft, lot_size_sqft, bedrooms, bathrooms, purchase_date",
        )
        .eq("id", activeHouseId)
        .maybeSingle()
    : { data: null };

  const capabilities = await resolveUserCapabilities(supabase);

  return (
    <AppShell house={house} capabilities={capabilities}>
      {children}
    </AppShell>
  );
}
