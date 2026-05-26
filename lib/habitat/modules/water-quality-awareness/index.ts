/**
 * Water Quality Awareness (WQA) habitat module.
 *
 * Phase 1 (issue #166): Resolves a house's coordinates to a PWSID via
 * the EPA Community Water System Service Areas layer, fetches the
 * WATER_SYSTEM inventory record from EPA Envirofacts (with a 90-day
 * shared-cache window per PWSID), decides which of five branches the
 * house falls into.
 *
 * Phase 2 (issue #169): On the CWS / non-community branches, pulls
 * SDWIS violation history and Lead and Copper Rule sample results
 * (both with a 30-day shared cache), then derives a compliance status
 * and lead/copper summary that feed both the persisted payload and
 * the finding's severity. CCR work (Phase 3+) still pending.
 *
 * Branch logic lives in branch.ts. Payload assembly lives in payload.ts.
 * SDWIS summarization lives in compliance.ts and lcr.ts. Activity-log
 * narration lives in narration.ts. This file is the orchestrator-
 * facing entry point.
 *
 * Feature flag: the module is exported as the default export but only
 * registered in lib/habitat/registry.ts when `WQA_ENABLED === "true"`.
 *
 * Activity-log narration arc on the happy CWS / non-community path:
 *
 *   1. fetch    — "I looked up your address against EPA's CWS Service Areas…"
 *   2. fetch    — "I pulled the utility's record from Envirofacts…" (or "cached hit")
 *   3. decide   — branch decision
 *   4. fetch    — "I pulled your utility's violation history from EPA…"
 *                  (or "fetch failed" with a degraded-payload note)
 *   5. fetch    — "I checked the most recent lead and copper samples…"
 *                  (or "no samples on file" / "fetch failed")
 *   6. compute  — "I looked across the violations to decide…"
 *   7. finding  — "I put a short finding together…"
 *
 * 7 steps on the CWS / non-community happy path; 4 on private_well;
 * 5-6 on stale/degraded paths depending on which fetches ran.
 *
 * Violations and LCR samples are fetched in parallel — independent
 * endpoints, independent failures. A failure on one degrades only its
 * field; the other continues. The module never throws after the
 * initial coordinate-validation guard.
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
} from "./caches/water-system-cache";
import {
  createSupabaseLcrCacheStore,
  resolveLcrSamples,
  type LcrCacheLookupResult,
} from "./caches/lcr-cache";
import {
  createSupabaseViolationsCacheStore,
  resolveViolations,
  type ViolationsCacheLookupResult,
} from "./caches/violations-cache";
import {
  COMPLIANCE_RECENT_YEARS,
  countUnmappedContaminants,
  summarizeCompliance,
  type ComplianceSummary,
} from "./compliance";
import { summarizeLcr, type LeadCopperSummary } from "./lcr";
import {
  buildPrivateWellPayload,
  buildStalePayload,
  buildSystemPayload,
  type SdwisEnrichment,
} from "./payload";
import {
  branchDecideNarration,
  complianceComputeNarration,
  EPA_CWS_SERVICE_AREAS_SOURCE,
  EPA_ENVIROFACTS_SOURCE,
  EPA_SDWIS_LCR_SOURCE,
  EPA_SDWIS_VIOLATIONS_SOURCE,
  envirofactsFetchNarration,
  findingStepNarration,
  HEARTH_BRANCH_SOURCE,
  HEARTH_COMPLIANCE_RULE_SOURCE,
  lcrFetchNarration,
  pwsidFetchNarration,
  violationsFetchNarration,
} from "./narration";
import type { SdwisViolationRecord } from "./sources/sdwis-violations";
import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";
import { resolvePwsidAtPoint } from "./sources/cws-service-areas";

const MODULE_KEY = "water_quality_awareness";

const WaterQualityAwarenessModule: HabitatModule = {
  key: MODULE_KEY,
  name: "Water Quality Awareness",
  description:
    "Identifies which public water system serves your home, reads its EPA compliance record, and prepares the surface for your utility's annual Water Quality Report.",
  category: "environmental",
  // WQA-2 (issue #169) bumps cadence from 'once' to 'yearly'. SDWIS
  // submissions are quarterly; a yearly re-check window keeps
  // findings fresh without being noisy. WQA-1 set this to 'once'
  // because Tier 1 inventory data alone didn't earn a recurring
  // re-check.
  cadence: "yearly",
  iconImage: "/habitat_module_images/WQA.jpg",

  isApplicable(house: HouseContext): boolean {
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

    // Step 2 — if the PWSID resolved, fetch the WATER_SYSTEM record.
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

    // Steps 4-6 — only on CWS / non-community paths where a record
    // exists. Violations and LCR samples are fetched in parallel and
    // soft-fail independently.
    let enrichment: SdwisEnrichment | undefined;
    const shouldFetchSdwis =
      record !== null &&
      (decision.branch === "cws_no_ccr" ||
        decision.branch === "non_community" ||
        decision.branch === "cws_with_ccr");

    if (shouldFetchSdwis && pwsid.match) {
      const violationsStore = createSupabaseViolationsCacheStore();
      const lcrStore = createSupabaseLcrCacheStore();

      // Run both fetches in parallel. Using Promise.allSettled so a
      // failure on either doesn't short-circuit the other.
      const [violationsOutcome, lcrOutcome] = await Promise.allSettled([
        resolveViolations(pwsid.match.pwsid, violationsStore),
        resolveLcrSamples(pwsid.match.pwsid, lcrStore),
      ]);

      // Violations fetch step
      let violations: SdwisViolationRecord[] | null = null;
      if (violationsOutcome.status === "fulfilled") {
        violations = violationsOutcome.value.records;
        const cache = violationsOutcome.value.cache;
        const violationsRowCount = violations.length;
        const violationsSourceUrl = violationsOutcome.value.sourceUrl;
        const narr = violationsFetchNarration({
          pwsid: pwsid.match.pwsid,
          outcome:
            cache.kind === "hit"
              ? {
                  kind: "hit",
                  ageDays: cache.ageDays,
                  rowCount: violationsRowCount,
                }
              : {
                  kind: "miss",
                  reason: cache.reason,
                  rowCount: violationsRowCount,
                  sourceUrl: violationsSourceUrl,
                },
        });
        log.step({
          kind: "fetch",
          narration: narr.narration,
          detail: narr.detail,
          result_summary: narr.result_summary,
          source: EPA_SDWIS_VIOLATIONS_SOURCE,
        });
      } else {
        const message =
          violationsOutcome.reason instanceof Error
            ? violationsOutcome.reason.message
            : String(violationsOutcome.reason);
        const narr = violationsFetchNarration({
          pwsid: pwsid.match.pwsid,
          outcome: { kind: "failed", message },
        });
        log.step({
          kind: "fetch",
          narration: narr.narration,
          detail: narr.detail,
          result_summary: narr.result_summary,
          source: EPA_SDWIS_VIOLATIONS_SOURCE,
        });
      }

      // LCR fetch step
      let lcrRecords: SdwisLcrSampleRecord[] | null = null;
      let lcrOutcomeAvailable: boolean;
      if (lcrOutcome.status === "fulfilled") {
        lcrRecords = lcrOutcome.value.records;
        lcrOutcomeAvailable = true;
        const cache: LcrCacheLookupResult = lcrOutcome.value.cache;
        const narr = lcrFetchNarration({
          pwsid: pwsid.match.pwsid,
          outcome:
            cache.kind === "hit"
              ? {
                  kind: "hit",
                  ageDays: cache.ageDays,
                  rowCount: lcrRecords.length,
                }
              : {
                  kind: "miss",
                  reason: cache.reason,
                  rowCount: lcrRecords.length,
                  sourceUrl: lcrOutcome.value.sourceUrl,
                },
        });
        log.step({
          kind: "fetch",
          narration: narr.narration,
          detail: narr.detail,
          result_summary: narr.result_summary,
          source: EPA_SDWIS_LCR_SOURCE,
        });
      } else {
        lcrOutcomeAvailable = false;
        const message =
          lcrOutcome.reason instanceof Error
            ? lcrOutcome.reason.message
            : String(lcrOutcome.reason);
        const narr = lcrFetchNarration({
          pwsid: pwsid.match.pwsid,
          outcome: { kind: "failed", message },
        });
        log.step({
          kind: "fetch",
          narration: narr.narration,
          detail: narr.detail,
          result_summary: narr.result_summary,
          source: EPA_SDWIS_LCR_SOURCE,
        });
      }

      // Compute step — summarize compliance.
      const compliance: ComplianceSummary | null = violations
        ? summarizeCompliance(violations)
        : null;
      const leadCopper: LeadCopperSummary = lcrOutcomeAvailable
        ? summarizeLcr(lcrRecords ?? [])
        : { status: "unavailable" };

      const computeNarr = complianceComputeNarration({
        status: compliance?.status ?? "unknown",
        recentTotal: compliance?.recent.total_in_last_5_years ?? 0,
        recentHealth: compliance?.recent.health_based_in_last_5_years ?? 0,
        recentYears: COMPLIANCE_RECENT_YEARS,
        unmappedContaminantCount: violations
          ? countUnmappedContaminants(violations)
          : 0,
      });
      log.step({
        kind: "compute",
        narration: computeNarr.narration,
        detail: computeNarr.detail,
        result_summary: computeNarr.result_summary,
        source: HEARTH_COMPLIANCE_RULE_SOURCE,
      });

      enrichment = { compliance, leadCopper };
    }

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
      // branch.ts never returns 'cws_with_ccr' until WQA-3 ships.
      // Map it defensively to 'cws_no_ccr' here so the payload
      // builder's type stays narrow.
      const safeBranch =
        decision.branch === "cws_with_ccr" ? "cws_no_ccr" : decision.branch;
      return buildSystemPayload(safeBranch, record, enrichment);
    })();

    // Final step — finding.
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
    const f = finding.findings as { branch?: string; system_card?: { pws_name?: string; compliance_status_short?: string } };
    if (f?.branch === "private_well") {
      return "Your address looks like a private well — we'll add private-well guidance in an upcoming Hearth update.";
    }
    if (f?.branch === "stale") {
      return "I couldn't confirm your water system with EPA on this run — we'll try again next time.";
    }
    const name = f?.system_card?.pws_name;
    const compliance = f?.system_card?.compliance_status_short;
    if (f?.branch === "non_community") {
      return name
        ? `Your address is served by ${name}, a non-community water system.`
        : "Your address is served by a non-community water system.";
    }
    if (compliance === "active_violations") {
      return name
        ? `Found your water utility — ${name} — and EPA shows an active compliance issue worth a closer look.`
        : "Found your water utility on file with EPA, with an active compliance issue worth a closer look.";
    }
    if (compliance === "no_active_violations") {
      return name
        ? `Found your water utility — ${name} — and EPA shows no active compliance issues.`
        : "Found your water utility on file with EPA, with no active compliance issues.";
    }
    return name
      ? `Found your water utility — ${name}.`
      : "Found your water utility on file with EPA.";
  },
};

export default WaterQualityAwarenessModule;
