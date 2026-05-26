/**
 * Water Quality Awareness (WQA) habitat module — Phase 1.
 *
 * Resolves a house's coordinates to a PWSID via the EPA Community Water
 * System Service Areas layer, fetches the WATER_SYSTEM inventory record
 * from EPA Envirofacts (with a 90-day shared-cache window per PWSID),
 * decides which of five branches the house falls into, and surfaces a
 * habitat finding for the "Your water system" card in the dashboard.
 *
 * No CCR work, no SDWIS violations, no UCMR data — those are WQA-2 / -3
 * / -8. Phase 1 is the architectural skeleton plus the system-identity
 * surface (Tier 1 data only).
 *
 * Branch logic lives in branch.ts. Payload assembly lives in payload.ts.
 * Activity-log narration lives in narration.ts. This file is the
 * orchestrator-facing entry point.
 *
 * Feature flag: the module is exported as the default export but only
 * registered in lib/habitat/registry.ts when `WQA_ENABLED === "true"`.
 * That keeps the registry import path stable and lets the env var
 * toggle visibility without a code change.
 *
 * Activity-log narration arc:
 *
 *   1. fetch    — "I looked up your address against EPA's CWS Service Areas…"
 *   2. fetch    — "I pulled the utility's record from Envirofacts…" (or "cached hit")
 *                  (Omitted when the PWSID didn't resolve — no record to fetch.)
 *   3. decide   — "Branch decision based on what we found."
 *   4. finding  — "I put a short finding together for your dashboard."
 *
 * 4 steps on the happy path; 3 on the private-well path.
 */

import { createActivityLogger } from "@/lib/habitat/activity-log";
import type {
  HabitatFinding,
  HabitatModule,
  HouseContext,
} from "@/lib/habitat/types";
import { decideBranch } from "./branch";
import {
  CACHE_TTL_DAYS,
  createSupabaseWaterSystemCacheStore,
  resolveWaterSystem,
} from "./cache";
import {
  buildPrivateWellPayload,
  buildStalePayload,
  buildSystemPayload,
} from "./payload";
import {
  branchDecideNarration,
  EPA_CWS_SERVICE_AREAS_SOURCE,
  EPA_ENVIROFACTS_SOURCE,
  envirofactsFetchNarration,
  findingStepNarration,
  HEARTH_BRANCH_SOURCE,
  pwsidFetchNarration,
} from "./narration";
import { resolvePwsidAtPoint } from "./sources/cws-service-areas";

const MODULE_KEY = "water_quality_awareness";

const WaterQualityAwarenessModule: HabitatModule = {
  key: MODULE_KEY,
  name: "Water Quality Awareness",
  description:
    "Identifies which public water system serves your home and prepares the surface for compliance history, contaminant findings, and your utility's annual Water Quality Report.",
  category: "environmental",
  // 'once' for Phase 1 — we resolve a PWSID and persist the system
  // record, and that doesn't need to re-run on a schedule until later
  // phases add compliance and CCR data. WQA-2 will likely bump this
  // to 'yearly'.
  cadence: "once",
  // iconImage is intentionally omitted until the WQA hero asset
  // ships under public/habitat_module_images/. The compact tile and
  // the modal header both handle a missing icon gracefully — the
  // tile drops the 72px hero column, the modal renders without the
  // thumbnail. Tracked as a follow-up to the WQA-1 PR.

  isApplicable(house: HouseContext): boolean {
    // Need lat/lng for the point-in-polygon query against CWS Service
    // Areas. Anything else is downstream — even the private-well
    // branch starts from a successful CWS lookup that returned zero
    // features.
    return (
      house.latitude !== null &&
      house.longitude !== null &&
      Number.isFinite(house.latitude) &&
      Number.isFinite(house.longitude)
    );
  },

  async check(house: HouseContext): Promise<HabitatFinding> {
    const log = createActivityLogger();

    if (
      house.latitude == null ||
      house.longitude == null ||
      !Number.isFinite(house.latitude) ||
      !Number.isFinite(house.longitude)
    ) {
      log.step({
        kind: "error",
        narration:
          "I couldn't check your water system because your address is missing coordinates.",
        detail: `lat: ${house.latitude}, lng: ${house.longitude}`,
      });
      throw new Error(
        "Water Quality Awareness check requires lat/lng coordinates",
      );
    }

    const lat = house.latitude;
    const lng = house.longitude;

    // Step 1 — resolve the PWSID via CWS Service Areas.
    const pwsid = await resolvePwsidAtPoint(lat, lng);
    const fetch1 = pwsidFetchNarration({
      lat,
      lng,
      resolved: pwsid.match !== null,
      totalFeatures: pwsid.totalFeatures,
    });
    log.step({
      kind: "fetch",
      narration: fetch1.narration,
      detail: fetch1.detail,
      result_summary: fetch1.result_summary,
      source: EPA_CWS_SERVICE_AREAS_SOURCE,
    });

    // Step 2 — if the PWSID resolved, fetch the WATER_SYSTEM record
    // through the shared cache.
    let record = null as Awaited<ReturnType<typeof resolveWaterSystem>>["record"];
    if (pwsid.match) {
      const store = createSupabaseWaterSystemCacheStore();
      const resolved = await resolveWaterSystem(pwsid.match.pwsid, store);
      record = resolved.record;
      const fetch2 = envirofactsFetchNarration({
        pwsid: pwsid.match.pwsid,
        cacheKind: resolved.cache.kind,
        cacheDetail:
          resolved.cache.kind === "hit"
            ? `Cache hit on hearth.water_systems for ${pwsid.match.pwsid}, refreshed_at=${resolved.cache.refreshedAt.toISOString()}, age=${resolved.cache.ageDays}d, ttl=${CACHE_TTL_DAYS}d`
            : `Cache ${resolved.cache.reason === "no-row" ? "miss (no row)" : resolved.cache.reason === "expired" ? "miss (expired, refetched + cache updated)" : "miss (lookup error, refetched)"}; GET ${resolved.sourceUrl}`,
        ageDays:
          resolved.cache.kind === "hit" ? resolved.cache.ageDays : undefined,
      });
      log.step({
        kind: "fetch",
        narration: fetch2.narration,
        detail: fetch2.detail,
        result_summary: fetch2.result_summary,
        source: EPA_ENVIROFACTS_SOURCE,
      });
    }

    // Step 3 — branch decision.
    const decision = decideBranch({
      pwsidResolved: pwsid.match !== null,
      record,
    });
    const decideStep = branchDecideNarration({
      branch: decision.branch,
      diagnostic: decision.diagnostic,
    });
    log.step({
      kind: "decide",
      narration: decideStep.narration,
      detail: decideStep.detail,
      result_summary: decideStep.result_summary,
      source: HEARTH_BRANCH_SOURCE,
    });

    // Build the payload based on the branch.
    const payload = (() => {
      if (decision.branch === "private_well") {
        return buildPrivateWellPayload(
          decision.diagnostic ??
            "No EPA Community Water System polygon covers this address.",
        );
      }
      if (decision.branch === "stale") {
        return buildStalePayload(
          decision.diagnostic ?? "EPA returned an unrecognized record.",
        );
      }
      if (!record) {
        // Defensive — branch.ts already routes a null record into
        // 'stale'; if we land here something upstream is broken.
        return buildStalePayload("Internal: branch resolved but record is null.");
      }
      // branch.ts never returns 'cws_with_ccr' in Phase 1 — that branch
      // is decided one layer up against the shared CCR cache which
      // doesn't exist until WQA-3. Map it defensively to 'cws_no_ccr'
      // here so the payload builder's type stays narrow.
      if (decision.branch === "cws_with_ccr") {
        return buildSystemPayload("cws_no_ccr", record);
      }
      return buildSystemPayload(decision.branch, record);
    })();

    // Step 4 — finding.
    const findStep = findingStepNarration(payload.headline);
    log.step({
      kind: "finding",
      narration: findStep.narration,
      result_summary: findStep.result_summary,
    });

    return {
      severity: payload.severity,
      headline: payload.headline,
      summary: payload.summary,
      findings: payload.findings as unknown as Record<string, unknown>,
      sourceUrl: "https://www.epa.gov/ground-water-and-drinking-water",
      activityLog: log.finalize(),
    };
  },

  getOnboardingMessage(finding): string {
    const f = finding.findings as { branch?: string; system_card?: { pws_name?: string } };
    if (f?.branch === "private_well") {
      return "Your address looks like a private well — we'll add private-well guidance in an upcoming Hearth update.";
    }
    if (f?.branch === "stale") {
      return "I couldn't confirm your water system with EPA on this run — we'll try again next time.";
    }
    const name = f?.system_card?.pws_name;
    if (f?.branch === "non_community") {
      return name
        ? `Your address is served by ${name}, a non-community water system.`
        : "Your address is served by a non-community water system.";
    }
    return name
      ? `Found your water utility — ${name}.`
      : "Found your water utility on file with EPA.";
  },
};

export default WaterQualityAwarenessModule;
