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
 * status transitions. Matches the lookupZillow + persistBriefingSuccess
 * separation in workflows/briefing.ts.
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

async function loadHouseContext(houseId: string): Promise<HouseContext> {
  "use step";

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("houses")
    .select(
      "id, address_line1, city, state, county, postal_code, latitude, longitude, parcel_id",
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
        status: "completed",
        severity: finding.severity,
        headline: finding.headline,
        summary: finding.summary,
        findings: finding.findings,
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
