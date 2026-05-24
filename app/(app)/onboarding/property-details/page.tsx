import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { createClient } from "@/lib/supabase/server";
import { PropertyDetailsForm } from "./property-details-form";

/**
 * Second step of the onboarding flow (issue #142). After the address
 * form creates the house and `createHouseFromMapboxFeature` redirects
 * the user here, this page captures the two property-situation inputs
 * Hearth uses to calibrate environmental findings: water source and
 * basement presence.
 *
 * The page is shared by every entry point that wants the same prompts
 * — the initial `/onboarding` flow today, and (because both flows go
 * through `createHouseFromMapboxFeature`) `/houses/new` for users
 * adding a subsequent property. Direct navigation lands on the same
 * surface and edits the active house in place; users who already
 * have populated values see them pre-selected.
 *
 * "Skip for now" is a first-class affordance — the questions are
 * mildly intimate and forcing an answer would push users to guess.
 * Skipped values persist as `null`, which the application treats as
 * "we can't reason about this — suppress findings rather than guess."
 * The existing edit modal supports filling them in later without
 * re-onboarding.
 */
export default async function PropertyDetailsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const activeHouseId = await resolveActiveHouseId(supabase);
  if (!activeHouseId) redirect("/onboarding");

  const { data: house, error } = await supabase
    .from("houses")
    .select("id, address_line1, city, state, water_source, basement_present")
    .eq("id", activeHouseId)
    .maybeSingle();

  // If the active house id resolved but the SELECT can't see it (RLS
  // bumped it, race with delete, etc.), fall back to dashboard — the
  // layout will recompute the active house there.
  if (error || !house) redirect("/dashboard");

  const addressLine = [house.address_line1, house.city, house.state]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(", ");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6 sm:py-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-accent)" }}>
            <Icon name="flame" size={16} />
          </span>
          <span className="eyebrow">A couple of quick questions</span>
        </div>
        <h1 className="h1">Tell us about your home</h1>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", maxWidth: "52ch" }}
        >
          We use these two answers to calibrate environmental findings to
          your specific house — well users see different water-testing
          guidance than municipal users, and basement homes need different
          vapor-intrusion framing for sites with volatile chemicals nearby.
          Both are optional.
        </p>
        {addressLine ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            For <span style={{ color: "var(--color-text-secondary)" }}>{addressLine}</span>.
          </p>
        ) : null}
      </div>

      <div className="surface p-5 sm:p-6">
        <PropertyDetailsForm
          houseId={house.id}
          initialWaterSource={house.water_source ?? null}
          initialBasementPresent={house.basement_present ?? null}
        />
      </div>
    </div>
  );
}
