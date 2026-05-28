"use server";

import { start } from "workflow/api";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import {
  isValidPwsid,
  normalizePwsid,
} from "@/lib/habitat/modules/water-quality-awareness/pwsid-validation";
import { createClient } from "@/lib/supabase/server";
import { runBriefing } from "@/workflows/briefing";
import {
  runHabitatChecks,
  runSingleHabitatModule,
} from "@/workflows/habitat";
import { runHouseImage } from "@/workflows/house-image";

export type RefreshBriefingResult =
  | { ok: true }
  | { ok: false; error: string };

export type TriggerHabitatRecheckResult =
  | { ok: true }
  | { ok: false; error: string };

export type TriggerHabitatModuleRecheckResult =
  | { ok: true }
  | { ok: false; error: string };

export type ConfirmWqaPwsidResult =
  | { ok: true }
  | { ok: false; error: string };

export type CorrectWqaPwsidResult =
  | { ok: true }
  | { ok: false; error: string };

export type RegenerateHouseImageResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Re-run the Day One Briefing workflow for a house the signed-in user owns.
 *
 * The workflow's persist step now merges results non-destructively (see
 * lib/briefing/merge.ts), so re-runs accumulate fields rather than
 * overwriting them. The dashboard's Realtime subscription reacts to
 * briefing_status transitions automatically — this action just verifies
 * the caller and queues the workflow.
 *
 * Also fires the habitat workflow in parallel. The briefing workflow
 * itself used to kick off habitat from its persist step, but that
 * created a timing race during new-property onboarding (habitat ran
 * before the user could answer the property-situation questions —
 * see workflows/briefing.ts for the full reasoning). Habitat firing
 * is now an explicit caller responsibility. For Refresh House Facts
 * the call site is here; for new-property onboarding the discovery
 * modal's property-questions Save/Skip handler fires habitat via
 * `triggerHabitatRecheck` below.
 */
export async function refreshBriefing(
  houseId: string,
): Promise<RefreshBriefingResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // RLS already scopes SELECT to owner_id = auth.uid(), so this also acts
  // as the ownership check. A missing row from the user's POV means either
  // a bad houseId or someone else's row.
  const { data: house, error } = await supabase
    .from("houses")
    .select("id, briefing_status")
    .eq("id", houseId)
    .single();

  if (error || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  // Block double-starts at the server. The button is also disabled
  // client-side while briefing_status is 'running', but a stale client
  // (slow Realtime, lagging poll) could still fire — guard here too.
  if (house.briefing_status === "running") {
    return { ok: false, error: "A refresh is already in progress." };
  }

  try {
    await start(runBriefing, [houseId]);
  } catch (workflowError) {
    console.error("refresh briefing workflow start failed", workflowError);
    return {
      ok: false,
      error: "We couldn't start the refresh. Try again in a moment.",
    };
  }

  // Independent kickoff: a habitat failure here doesn't unwind the
  // briefing start above. Logged-not-thrown so the user still sees
  // the briefing refresh succeed even if habitat had a transient
  // issue queuing.
  try {
    await start(runHabitatChecks, [houseId]);
  } catch (habitatError) {
    console.error(
      "refresh briefing: habitat workflow start failed",
      habitatError,
    );
  }

  return { ok: true };
}

/**
 * Re-run the habitat workflow for a house the signed-in user owns,
 * WITHOUT touching the Zillow / briefing path.
 *
 * Use case (issue #144): when the discovery modal's property-questions
 * Save handler updates `water_source` / `basement_present`, the
 * Superfund module's recommended-actions logic now depends on those
 * values. But the habitat workflow already fired at briefing-persist
 * time with the prior (null/null) defaults — so the persisted finding
 * shows zero actions until something re-runs it. This action is the
 * "something."
 *
 * Soft race: the first habitat run may still be in flight when the
 * second one fires. Last-write-wins on the habitat_findings upsert.
 * The second run typically completes after the first because it
 * started later, so the user-correct values land last. In the rare
 * pathological case where the first run finishes after the second,
 * the user can hit "Refresh House Facts" to fire a third run with
 * the right data. Acceptable for v1; if it bites in practice we'd
 * gate habitat firing behind a property-details-captured flag.
 */
export async function triggerHabitatRecheck(
  houseId: string,
): Promise<TriggerHabitatRecheckResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // RLS scopes SELECT to owner_id = auth.uid(); a missing row means
  // either a bad houseId or someone else's row. Same shape as
  // refreshBriefing's ownership check above.
  const { data: house, error } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .single();

  if (error || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  try {
    await start(runHabitatChecks, [houseId]);
  } catch (workflowError) {
    console.error(
      "trigger habitat recheck workflow start failed",
      workflowError,
    );
    return {
      ok: false,
      error: "We couldn't re-run the habitat checks. Try again in a moment.",
    };
  }

  return { ok: true };
}

/**
 * Re-run a single habitat module for the signed-in user's house.
 * Issue #196.
 *
 * Used by the finding-modal "Recheck findings" affordance and by the
 * CCR upload flow's post-success trigger. Same auth + ownership shape
 * as `triggerHabitatRecheck` above; the only differences are the
 * `moduleKey` parameter and the validation that it names a real
 * module in the registry.
 *
 * The workflow itself rechecks applicability before running, so a
 * stale trigger (e.g. user changed water_source between the click and
 * the workflow firing) soft-fails inside the workflow rather than
 * writing a stale `completed` row.
 */
export async function triggerHabitatModuleRecheck(
  houseId: string,
  moduleKey: string,
): Promise<TriggerHabitatModuleRecheckResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // Validate the module key client-side error returns a clean message
  // rather than letting the workflow no-op silently. The registry is
  // already loaded in this server bundle for the workflow's own use.
  const knownKeys = HABITAT_MODULES.map((m) => m.key);
  if (!knownKeys.includes(moduleKey)) {
    return {
      ok: false,
      error: `Unknown habitat module '${moduleKey}'.`,
    };
  }

  // RLS scopes SELECT to owner_id = auth.uid(); a missing row means
  // either a bad houseId or someone else's row.
  const { data: house, error } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .single();

  if (error || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  try {
    await start(runSingleHabitatModule, [houseId, moduleKey]);
  } catch (workflowError) {
    console.error(
      `trigger habitat module recheck workflow start failed for '${moduleKey}'`,
      workflowError,
    );
    return {
      ok: false,
      error: "We couldn't re-run that check. Try again in a moment.",
    };
  }

  return { ok: true };
}

/**
 * Issue #193 — Persist the user's confirmation of the WQA-inferred
 * PWSID and mark the persisted finding as `user_confirmed` in-place.
 *
 * Confirmation is the no-op-from-the-module's-POV path: the PWSID
 * itself didn't change, so re-running the full WQA workflow would just
 * waste a round trip. Instead we:
 *
 *   1. Write the user's confirmed PWSID + confidence to
 *      `hearth.houses.water_system_user_pwsid` /
 *      `water_system_pwsid_confidence` so future re-runs honor the
 *      confirmation.
 *   2. Read the current habitat_findings row's `findings` JSON and
 *      flip its `system_card.pwsid_confidence` from "inferred" to
 *      "user_confirmed" via a single targeted update. Realtime
 *      propagates the change to the open modal so the strip vanishes
 *      without a spinner.
 *
 * Same ownership-via-RLS pattern as the other actions: the SELECTs are
 * scoped to the signed-in user's houses by RLS, so a houseId that
 * resolves no row is either bad input or someone else's house.
 */
export async function confirmWqaPwsid(
  houseId: string,
  pwsid: string,
): Promise<ConfirmWqaPwsidResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  const normalized = normalizePwsid(pwsid);
  if (!isValidPwsid(normalized)) {
    return {
      ok: false,
      error:
        "That doesn't look like a valid PWSID. Expected format: 2-letter state code + 7-digit number (e.g. MI0003520).",
    };
  }

  const { data: house, error: houseError } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .single();

  if (houseError || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  const { error: updateHouseError } = await supabase
    .from("houses")
    .update({
      water_system_user_pwsid: normalized,
      water_system_pwsid_confidence: "user_confirmed",
    })
    .eq("id", houseId);

  if (updateHouseError) {
    return {
      ok: false,
      error: "We couldn't save your confirmation. Try again in a moment.",
    };
  }

  // Flip the persisted finding's `system_card.pwsid_confidence` so the
  // panel updates immediately. The full WQA workflow doesn't need to
  // re-run — the PWSID is the same, only the confidence label changed.
  // Read-modify-write because Supabase doesn't expose a jsonb_set
  // operator through the REST client; the column is tiny (a few
  // hundred bytes) so the round-trip cost is negligible.
  const { data: findingRow, error: findingReadError } = await supabase
    .from("habitat_findings")
    .select("findings")
    .eq("house_id", houseId)
    .eq("module_key", "water_quality_awareness")
    .single();

  if (findingReadError || !findingRow) {
    // Houses row updated successfully but no WQA finding to patch — the
    // next workflow run will land with user_confirmed naturally. Return
    // ok so the UI doesn't show an error on a state that's about to
    // converge on its own.
    return { ok: true };
  }

  const findings = (findingRow.findings as Record<string, unknown>) ?? {};
  const systemCard = (findings.system_card as Record<string, unknown>) ?? null;
  if (systemCard !== null) {
    systemCard.pwsid_confidence = "user_confirmed";
    findings.system_card = systemCard;
    const { error: updateFindingError } = await supabase
      .from("habitat_findings")
      .update({ findings })
      .eq("house_id", houseId)
      .eq("module_key", "water_quality_awareness");
    if (updateFindingError) {
      return {
        ok: false,
        error:
          "Your confirmation was saved but we couldn't refresh the panel. Reload and it should reflect the change.",
      };
    }
  }

  return { ok: true };
}

/**
 * Issue #193 — Persist a user-corrected PWSID and trigger a WQA re-run.
 *
 * Corrections change the PWSID itself, so the WATER_SYSTEM, SDWIS, and
 * CCR-cache fetches all need to run against the new value before the
 * panel can show accurate data. The houses-row write happens first so
 * the workflow's `loadHouseContext` step picks up the override on the
 * very first read; the recheck trigger fires after.
 *
 * Returns immediately after queuing — the realtime subscription on the
 * habitat_findings row carries the workflow's completion back to the
 * open modal.
 */
export async function correctWqaPwsid(
  houseId: string,
  pwsid: string,
): Promise<CorrectWqaPwsidResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  const normalized = normalizePwsid(pwsid);
  if (!isValidPwsid(normalized)) {
    return {
      ok: false,
      error:
        "That doesn't look like a valid PWSID. Expected format: 2-letter state code + 7-digit number (e.g. MI0003520).",
    };
  }

  const { data: house, error: houseError } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .single();

  if (houseError || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  const { error: updateError } = await supabase
    .from("houses")
    .update({
      water_system_user_pwsid: normalized,
      water_system_pwsid_confidence: "user_corrected",
    })
    .eq("id", houseId);

  if (updateError) {
    return {
      ok: false,
      error: "We couldn't save your correction. Try again in a moment.",
    };
  }

  try {
    await start(runSingleHabitatModule, [houseId, "water_quality_awareness"]);
  } catch (workflowError) {
    console.error(
      "correctWqaPwsid workflow start failed",
      workflowError,
    );
    return {
      ok: false,
      error:
        "Your correction was saved but we couldn't re-run the water check. Try again in a moment.",
    };
  }

  return { ok: true };
}

/**
 * Re-run the generated architectural-sketch workflow for a house the
 * signed-in user owns. Overwrites the existing image in place at the
 * stable storage path, so the dashboard's signed URL stays valid through
 * the regenerate (only the bytes behind it change). The workflow itself
 * is fire-and-forget; the dashboard observes the row's
 * `generated_image_created_at` advancing and refreshes the signed URL on
 * the new path stamp.
 */
export async function regenerateHouseImage(
  houseId: string,
): Promise<RegenerateHouseImageResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // RLS scopes SELECT to owner_id = auth.uid(), so a missing row here is
  // either a bad id or someone else's house — same shape as the briefing
  // refresh.
  const { data: house, error } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .single();

  if (error || !house) {
    return { ok: false, error: "We couldn't find that house." };
  }

  try {
    await start(runHouseImage, [houseId]);
  } catch (workflowError) {
    console.error("regenerate house-image workflow start failed", workflowError);
    return {
      ok: false,
      error: "We couldn't start the regeneration. Try again in a moment.",
    };
  }

  return { ok: true };
}
