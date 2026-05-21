import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { resolveUserCapabilities } from "@/lib/houses/capabilities";
import { createClient } from "@/lib/supabase/server";
import { AddressForm } from "@/app/(app)/onboarding/address-form-loader";

/**
 * /houses/new — add another property. Parallels /onboarding but lives
 * outside the first-run gate. Reuses the onboarding AddressForm and
 * server action; createHouseFromMapboxFeature sets the new house as
 * active_house_id on insert (see [app/(app)/onboarding/actions.ts]).
 *
 * The proxy gate in [lib/supabase/proxy.ts] also enforces the capability
 * + has-existing-houses checks; the page-level guards below are
 * defense-in-depth so a direct navigation past stale capabilities
 * bounces cleanly.
 */
export default async function AddPropertyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Zero-house users belong on /onboarding — this route is for adding
  // subsequent properties.
  const { count } = await supabase
    .from("houses")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) === 0) {
    redirect("/onboarding");
  }

  // Capability gate. Free users with one house should never see this
  // page; the proxy bounces them to /dashboard, and the switcher's
  // "Add a property" entry is gated on the same capability so the link
  // never renders for them. This second check survives the case where
  // capabilities changed mid-session.
  const capabilities = await resolveUserCapabilities(supabase);
  if (!capabilities.canCreateAdditionalHouse) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6 sm:py-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-accent)" }}>
            <Icon name="home" size={16} />
          </span>
          <span className="eyebrow">Add a property</span>
        </div>
        <h1 className="h1">What&apos;s the address?</h1>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", maxWidth: "44ch" }}
        >
          We&apos;ll set it up alongside your other properties and pull in what
          we can find — county records, hazards, the world around it.
        </p>
      </div>

      <div className="surface p-5 sm:p-6">
        <AddressForm submitLabel="Add this property" />
      </div>

      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        You can switch between properties anytime from the address dropdown.
      </p>
    </div>
  );
}
