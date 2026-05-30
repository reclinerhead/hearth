import { AppShell } from "@/components/app-shell";
import type { HouseSummary } from "@/components/property-switcher";
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

  // Three reads in parallel:
  //   * the active house with the full edit-modal column set (drives the
  //     top-nav address chip + the home-details edit modal),
  //   * a thin list of every house the user owns (drives the property
  //     switcher dropdown), and
  //   * the capability object (gates the "Add a property" affordance and
  //     drives the chip-vs-dropdown render in the switcher).
  // Each is small and runs against the same Supabase connection.
  const [activeHouseResult, housesListResult, capabilities] = await Promise.all([
    activeHouseId
      ? supabase
          .from("houses")
          .select(
            "id, address_line1, address_line2, city, state, postal_code, year_built, living_area_sqft, lot_size_sqft, bedrooms, bathrooms, purchase_date, water_source, basement_present, description",
          )
          .eq("id", activeHouseId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("houses")
      .select("id, address_line1, city, state")
      .order("created_at", { ascending: false }),
    resolveUserCapabilities(supabase),
  ]);

  const house = activeHouseResult.data;
  const houses = (housesListResult.data ?? []) as HouseSummary[];

  return (
    <AppShell house={house} houses={houses} capabilities={capabilities}>
      {children}
    </AppShell>
  );
}
