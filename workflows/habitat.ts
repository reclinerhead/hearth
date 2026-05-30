import { createServiceClient } from "@/lib/supabase/service";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type {
  HabitatCadence,
  HabitatFinding,
  HouseContext,
} from "@/lib/habitat/types";

/**
 * Habitat orchestrator workflow. Runs every applicable habitat module
 * against a house and upserts the result into hearth.habitat_findings,
 * keyed by (house_id, module_key). Started from the tail of the briefing
 * workflow once the houses row is populated; safe to re-run idempotently.
 *
 * One step per module is the load-bearing design: WDK's retry granularity
 * is per-step, so a transient failure in one module never causes already-
 * completed modules to re-run. Modules execute in parallel via Promise.all.
 *
 * Modules don't write to the database — module.check() returns a
 * HabitatFinding and the step around it owns all DB writes, including
 * status transitions. Keeps each module's pure check logic separable
 * from the persistence concerns the workflow step layer owns.
 */
export async function runHabitatChecks(houseId: string): Promise<void> {
  "use workflow";

  const context = await loadHouseContext(houseId);

  // Applicability is a pure, synchronous predicate on HouseContext —
  // safe to evaluate inside the workflow context. We pass module *keys*
  // across the step boundary because devalue serialization can't carry
  // the module's function members (check/isApplicable); the step looks
  // the module back up by key.
  const applicableKeys = HABITAT_MODULES.filter((m) =>
    m.isApplicable(context),
  ).map((m) => m.key);

  await Promise.all(
    applicableKeys.map((moduleKey) => runOneModule(context, moduleKey)),
  );
}

/**
 * Re-run a single habitat module against a house. Issue #196.
 *
 * Per-module granularity for re-checks — paired with the finding-modal
 * "Recheck findings" affordance and the CCR upload flow's post-success
 * trigger. Same step-level retry / status-bookkeeping as the all-modules
 * orchestrator above; the only difference is which modules get a turn.
 *
 * Soft-fails on:
 *   - An unknown module key (not in HABITAT_MODULES). The server action
 *     guards this client-side, but the workflow re-validates because
 *     workflow input can stale across deploys (e.g. a queued task firing
 *     after we removed a module from the registry).
 *   - A module that's no longer applicable to this house (e.g. user
 *     changed water_source between when the trigger fired and when the
 *     workflow ran). Skipping is the right answer — writing a stale
 *     'completed' would be worse.
 *
 * Both soft-fail paths simply return without touching habitat_findings,
 * matching the orchestrator's "don't write garbage into a row" discipline.
 */
export async function runSingleHabitatModule(
  houseId: string,
  moduleKey: string,
): Promise<void> {
  "use workflow";

  const context = await loadHouseContext(houseId);

  const module = HABITAT_MODULES.find((m) => m.key === moduleKey);
  if (!module) return;
  if (!module.isApplicable(context)) return;

  await runOneModule(context, moduleKey);
}

async function loadHouseContext(houseId: string): Promise<HouseContext> {
  "use step";

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("houses")
    .select(
      "id, address_line1, city, state, county, postal_code, latitude, longitude, parcel_id, water_source, basement_present, water_system_user_pwsid, water_system_pwsid_confidence",
    )
    .eq("id", houseId)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not load house ${houseId}: ${error?.message ?? "not found"}`,
    );
  }

  return {
    houseId: data.id,
    addressLine1: data.address_line1,
    city: data.city,
    state: data.state,
    county: data.county,
    postalCode: data.postal_code,
    latitude: data.latitude,
    longitude: data.longitude,
    parcelId: data.parcel_id,
    waterSource: data.water_source ?? null,
    basementPresent: data.basement_present ?? null,
    waterSystemUserPwsid: data.water_system_user_pwsid ?? null,
    waterSystemPwsidConfidence:
      (data.water_system_pwsid_confidence as
        | "user_confirmed"
        | "user_corrected"
        | null) ?? null,
  };
}

async function runOneModule(
  context: HouseContext,
  moduleKey: string,
): Promise<void> {
  "use step";

  const module = HABITAT_MODULES.find((m) => m.key === moduleKey);
  if (!module) {
    throw new Error(`Habitat module not registered: ${moduleKey}`);
  }

  const supabase = createServiceClient();

  const { error: runningError } = await supabase
    .from("habitat_findings")
    .upsert(
      {
        house_id: context.houseId,
        module_key: module.key,
        category: module.category,
        status: "running",
        checked_at: new Date().toISOString(),
        error: null,
      },
      { onConflict: "house_id,module_key" },
    );

  if (runningError) {
    throw new Error(
      `Could not mark habitat module ${module.key} running for ${context.houseId}: ${runningError.message}`,
    );
  }

  let finding: HabitatFinding;
  try {
    finding = await module.check(context);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown habitat module failure";
    const trimmed = message.slice(0, 500);

    await supabase
      .from("habitat_findings")
      .upsert(
        {
          house_id: context.houseId,
          module_key: module.key,
          category: module.category,
          status: "failed",
          checked_at: new Date().toISOString(),
          error: trimmed,
        },
        { onConflict: "house_id,module_key" },
      );
    return;
  }

  const nextCheck = cadenceToNextCheck(module.cadence);

  const { error: completedError } = await supabase
    .from("habitat_findings")
    .upsert(
      {
        house_id: context.houseId,
        module_key: module.key,
        category: module.category,
        status: "completed",
        severity: finding.severity,
        headline: finding.headline,
        summary: finding.summary,
        findings: finding.findings,
        actions: finding.actions ?? null,
        activity_log: finding.activityLog ?? null,
        source_url: finding.sourceUrl ?? null,
        checked_at: new Date().toISOString(),
        next_check_due_at: nextCheck ? nextCheck.toISOString() : null,
        error: null,
      },
      { onConflict: "house_id,module_key" },
    );

  if (completedError) {
    throw new Error(
      `Could not persist habitat finding for ${module.key} on ${context.houseId}: ${completedError.message}`,
    );
  }

  // Issue #158: dev-only file-based prompt log for any AI calls
  // the module wrapped inside check(). Reads `finding.debug` (a
  // transient field the orchestrator deliberately doesn't persist)
  // and dispatches each populated slot to the matching dynamic-
  // imported writer. The dynamic import has to live in this
  // workflow file's "use step" boundary — the helper imports
  // node:fs/promises, which the workflow bundler blocks anywhere
  // it's reachable statically from workflow code.
  //
  // Soft-fail: the log step's own catch (inside the helper) swallows
  // filesystem errors, and the step doesn't throw on missing slots.
  // A logging miss never affects the finding-write that already
  // happened above.
  if (finding.debug && Object.keys(finding.debug).length > 0) {
    await writeModuleDebugLog(module.key, finding.debug);
  }
}

/**
 * Issue #158 — dispatches each populated `finding.debug.<slot>` to
 * the matching dev-time prompt-log writer via dynamic import.
 *
 * `"use step"` boundary: the helpers each import `node:fs/promises`
 * and `node:path`. Dynamic import inside this step keeps those
 * imports off the workflow bundle's static graph and on the step
 * bundle (which has Node available). The maintenance-synthesis
 * `logSynthesisDebug` step is the reference pattern.
 *
 * Today only the Superfund module emits a `portfolio_summary` slot;
 * future modules can add their own keys to `finding.debug` and a
 * matching `case` here without changes to the module contract or
 * the step machinery.
 */
async function writeModuleDebugLog(
  moduleKey: string,
  debug: Record<string, unknown>,
): Promise<void> {
  "use step";

  if (process.env.NODE_ENV !== "development") return;

  try {
    if (
      moduleKey === "epa_superfund_proximity" &&
      debug.portfolio_summary
    ) {
      const { writeSuperfundSummaryDebugLog } = await import(
        "@/lib/habitat/modules/epa-superfund-proximity/debug-log"
      );
      // Cast from the open Record<string, unknown> back to the
      // helper's input shape. The shape is owned by the module that
      // emits it (PortfolioSummaryDebugCapture in
      // portfolio-summary/generate.ts); the dispatcher trusts that
      // the emitter and the helper agree.
      await writeSuperfundSummaryDebugLog(
        debug.portfolio_summary as Parameters<
          typeof writeSuperfundSummaryDebugLog
        >[0],
      );
    }
  } catch (e) {
    console.warn(
      `[habitat-debug-log] dispatch failed for module ${moduleKey}:`,
      e,
    );
  }
}

function cadenceToNextCheck(cadence: HabitatCadence): Date | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (cadence) {
    case "once":
      return null;
    case "yearly":
      return new Date(now + 365 * day);
    case "monthly":
      return new Date(now + 30 * day);
    case "weekly":
      return new Date(now + 7 * day);
    case "daily":
      return new Date(now + 1 * day);
    case "fast":
      // Fast-cadence modules self-schedule their next run rather than
      // relying on the orchestrator's static cadence-to-date mapping.
      return null;
  }
}
