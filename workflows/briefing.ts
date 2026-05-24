import { start } from "workflow/api";
import {
  buildBriefingSuccessUpdate,
  type MergeableHouseFacts,
} from "@/lib/briefing/merge";
import { lookupHouseOnZillow, type ZillowLookupResult } from "@/lib/briefing/zillow";
import { createServiceClient } from "@/lib/supabase/service";
import { runHouseImage } from "@/workflows/house-image";

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
 *
 * Merges the new result into the existing row rather than overwriting it.
 * Sonar's results are stochastic — successive runs surface different
 * subsets of the available fields — so the manual refresh feature relies
 * on this step never clobbering a non-null value with a fresh null. The
 * merge rules (and the description_source provenance lock) live in
 * `lib/briefing/merge.ts` so they are unit-tested without touching the DB.
 */
async function persistBriefingSuccess(
  houseId: string,
  result: ZillowLookupResult,
): Promise<void> {
  "use step";

  const supabase = createServiceClient();

  const { data: current, error: readError } = await supabase
    .from("houses")
    .select(
      "year_built, living_area_sqft, lot_size_sqft, lot_size_acres, bedrooms, bathrooms, heating_summary, cooling_summary, parcel_id, description, description_source, user_image_url",
    )
    .eq("id", houseId)
    .single<MergeableHouseFacts & { user_image_url: string | null }>();

  if (readError || !current) {
    throw new Error(
      `Could not read current row for merge on ${houseId}: ${readError?.message ?? "not found"}`,
    );
  }

  const payload = buildBriefingSuccessUpdate({
    current,
    result,
    now: new Date().toISOString(),
  });

  const { error } = await supabase
    .from("houses")
    .update(payload)
    .eq("id", houseId);

  if (error) {
    throw new Error(
      `Could not persist briefing for ${houseId}: ${error.message}`,
    );
  }

  // Habitat-workflow kickoff moved up to the callers (issue #144 timing
  // fix). The previous design fired habitat here, but for new
  // properties that meant habitat ran with the still-null
  // water_source / basement_present defaults — by the time the
  // discovery modal's property-questions phase opened, habitat was
  // already done and the Superfund recommended-actions logic had
  // computed against the wrong inputs. Now:
  //
  //   - New onboarding (createHouseFromMapboxFeature) does NOT fire
  //     habitat from the briefing. The discovery modal's Save/Skip
  //     handler fires `triggerHabitatRecheck` once the user has
  //     answered (or explicitly skipped) the property-situation
  //     questions, so habitat runs exactly once with the right
  //     inputs.
  //   - Refresh House Facts (`refreshBriefing` in dashboard/actions.ts)
  //     fires both briefing AND habitat in parallel as before —
  //     returning users have their answers persisted, so the timing
  //     hazard doesn't apply.
  //
  // Edge cases (user closes browser mid-modal, etc.) recover via the
  // Refresh House Facts button.

  // Fire-and-forget the generated illustration. The
  // image step reads year_built / description from the freshly-written
  // row, so it has to run AFTER persist; the briefing itself is already
  // user-visible at this point so a missing illustration is the only
  // user-facing consequence of a start() failure.
  //
  // Skip when the user has already uploaded their own photo — the
  // generated sketch lives in a separate column / bucket and isn't
  // displayed while user_image_url is set, so regenerating it on every
  // Refresh would burn image-model credits with no visible benefit.
  // The explicit "Regenerate" button on the dashboard still calls
  // runHouseImage directly, so a user who wants a fresh sketch under
  // their uploaded photo can still get one.
  if (current.user_image_url == null) {
    try {
      await start(runHouseImage, [houseId]);
    } catch (imageError) {
      console.error("house-image workflow start failed", imageError);
    }
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
