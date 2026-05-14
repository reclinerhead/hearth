import { lookupHouseOnZillow, type ZillowLookupResult } from "@/lib/briefing/zillow";
import { createServiceClient } from "@/lib/supabase/service";

type HouseAddress = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

/**
 * Day One Briefing workflow. Looks up the house on Zillow and writes the
 * structured facts back to hearth.houses. The dashboard subscribes to row
 * updates via Supabase Realtime, so each transition becomes visible
 * without a manual refresh.
 *
 * Lifecycle: pending → running → completed | failed. On failure the
 * error message is surfaced to the user in briefing_error.
 */
export async function runBriefing(houseId: string): Promise<void> {
  "use workflow";

  try {
    const address = await startBriefing(houseId);
    const result = await lookupZillow(address);
    await persistBriefingSuccess(houseId, result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown briefing failure";
    await markBriefingFailed(houseId, message);
  }
}

/**
 * Read the house's address and mark the briefing as running. Returning the
 * address from this step lets the lookup step run without re-reading the
 * row, keeping it pure and trivially testable.
 */
async function startBriefing(houseId: string): Promise<HouseAddress> {
  "use step";

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("houses")
    .select("address_line1, city, state, postal_code")
    .eq("id", houseId)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not load house ${houseId}: ${error?.message ?? "not found"}`,
    );
  }

  const { error: updateError } = await supabase
    .from("houses")
    .update({
      briefing_status: "running",
      briefing_started_at: new Date().toISOString(),
      briefing_error: null,
    })
    .eq("id", houseId);

  if (updateError) {
    throw new Error(
      `Could not mark briefing running for ${houseId}: ${updateError.message}`,
    );
  }

  return {
    addressLine1: data.address_line1,
    city: data.city,
    state: data.state,
    postalCode: data.postal_code,
  };
}

async function lookupZillow(address: HouseAddress): Promise<ZillowLookupResult> {
  "use step";

  return lookupHouseOnZillow(address);
}

/**
 * Write the Zillow result back to the house and mark the briefing complete.
 * Populates both `description` (the displayed copy) and `description_source`
 * (provenance for future synthesis) with the same value — the synthesis
 * step will eventually overwrite `description` and leave `description_source`
 * untouched.
 */
async function persistBriefingSuccess(
  houseId: string,
  result: ZillowLookupResult,
): Promise<void> {
  "use step";

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("houses")
    .update({
      year_built: result.yearBuilt,
      living_area_sqft: result.livingAreaSqft,
      lot_size_sqft: result.lotSizeSqft,
      bedrooms: result.bedrooms,
      bathrooms: result.bathrooms,
      description: result.description,
      description_source: result.description,
      briefing_status: "completed",
      briefing_generated_at: new Date().toISOString(),
      briefing_error: null,
    })
    .eq("id", houseId);

  if (error) {
    throw new Error(
      `Could not persist briefing for ${houseId}: ${error.message}`,
    );
  }
}

async function markBriefingFailed(
  houseId: string,
  message: string,
): Promise<void> {
  "use step";

  const supabase = createServiceClient();

  // Surfaced to the user verbatim — keep it short and safe to read.
  const trimmed = message.slice(0, 500);

  await supabase
    .from("houses")
    .update({
      briefing_status: "failed",
      briefing_error: trimmed,
    })
    .eq("id", houseId);
}
