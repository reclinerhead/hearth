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
 * registered in lib/habitat/registry.ts when `NEXT_PUBLIC_WQA_ENABLED === "true"`.
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
import { decideBranch, shouldSkipEpaLookups } from "./branch";
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
  createSupabaseCcrCacheStore,
  resolveLatestCcr,
  type CcrCacheRow,
} from "./caches/ccr-cache";
import { buildCcrFindings } from "./ccr";
import {
  COMPLIANCE_RECENT_YEARS,
  countUnmappedContaminants,
  summarizeCompliance,
  type ComplianceSummary,
} from "./compliance";
import { classifyLcrAxis, summarizeLcr, type LeadCopperSummary } from "./lcr";
import { buildCwsOnboardingMessage } from "./onboarding-message";
import {
  buildCwsUnmappedPayload,
  buildPrivateWellPayload,
  buildStalePayload,
  buildSystemPayload,
  type SdwisEnrichment,
} from "./payload";
import { summarizeWqaRecheckChanges } from "./recheck-summary";
import {
  branchDecideNarration,
  ccrCacheFetchNarration,
  complianceComputeNarration,
  EPA_CWS_SERVICE_AREAS_SOURCE,
  EPA_ENVIROFACTS_SOURCE,
  EPA_SDWIS_LCR_SOURCE,
  EPA_SDWIS_VIOLATIONS_SOURCE,
  envirofactsFetchNarration,
  findingStepNarration,
  HEARTH_BRANCH_SOURCE,
  HEARTH_CCR_CACHE_SOURCE,
  HEARTH_COMPLIANCE_RULE_SOURCE,
  lcrFetchNarration,
  nearestPwsidFetchNarration,
  pwsidFetchNarration,
  recommendedActionsComputeNarration,
  trustedWaterSourceNarration,
  userSuppliedPwsidNarration,
  violationsFetchNarration,
} from "./narration";
import {
  buildRecommendedActions,
  type RecommendedActionsInputs,
} from "./recommended-actions";
import { formatAdminName, displaySystemName } from "./payload";
import type { WqaRecommendedAction } from "./types";
import { createElement } from "react";
import { WqaOverviewBody } from "./components/overview-body";
import type { SdwisViolationRecord } from "./sources/sdwis-violations";
import type { SdwisLcrSampleRecord } from "./sources/sdwis-lcr-samples";
import {
  NEAREST_POLYGON_FALLBACK_RADIUS_M,
  resolveNearestPwsid,
  resolvePwsidAtPoint,
  type NearestPwsidResult,
} from "./sources/cws-service-areas";
import type { PwsidResolution, WqaBranch } from "./types";

const MODULE_KEY = "water_quality_awareness";

const WaterQualityAwarenessModule: HabitatModule = {
  key: MODULE_KEY,
  name: "Water Quality Awareness",
  sourceLabel: "WATER QUALITY CHECK",
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

    // Short-circuit: when the user's onboarding answer is 'well' or
    // 'shared', EPA has no useful data for this house — no PWSID, no
    // SDWIS, no CCR. Trust the user, skip the lookups, and emit a
    // 3-step log that narrates the trust path.
    if (
      house.waterSource === "well" ||
      house.waterSource === "shared"
    ) {
      const trustedStep = trustedWaterSourceNarration({
        waterSource: house.waterSource,
      });
      log.step({
        kind: "compute",
        narration: trustedStep.narration,
        detail: trustedStep.detail,
        result_summary: trustedStep.result_summary,
      });
      const decision = decideBranch({
        waterSource: house.waterSource,
        pwsidResolved: false,
        record: null,
      });
      const decideStep = branchDecideNarration({
        branch: decision.branch,
        diagnostic: decision.diagnostic,
        source: "user-declared",
      });
      log.step({
        kind: "decide",
        narration: decideStep.narration,
        detail: decideStep.detail,
        result_summary: decideStep.result_summary,
        source: HEARTH_BRANCH_SOURCE,
      });

      const payload = buildPrivateWellPayload(
        decision.diagnostic ?? "User declared a private/shared water source during onboarding.",
        "user-declared",
      );

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
    }

    // Belt-and-suspenders for the shouldSkipEpaLookups helper. If this
    // ever desyncs from the short-circuit above, the test suite will
    // catch the divergence; the assertion keeps the invariant local.
    if (shouldSkipEpaLookups(house.waterSource)) {
      throw new Error(
        "shouldSkipEpaLookups disagrees with the short-circuit logic above",
      );
    }

    // Issue #193 — user-supplied PWSID short-circuit. When the user has
    // confirmed or corrected their PWSID via the WQA findings panel,
    // we skip the EPA polygon lookup entirely and use their override as
    // the authoritative PWSID. Downstream WATER_SYSTEM / CCR / SDWIS
    // fetches all key off this PWSID the same way they would for a
    // verified polygon match. The confidence flag travels through to
    // the persisted payload so the UI keeps the strip suppressed and
    // surfaces the edit affordance on the system card.
    let resolution: PwsidResolution;
    let nearbyOutcome: NearestPwsidResult | null = null;

    if (
      house.waterSystemUserPwsid !== null &&
      house.waterSystemPwsidConfidence !== null
    ) {
      const userStep = userSuppliedPwsidNarration({
        pwsid: house.waterSystemUserPwsid,
        confidence: house.waterSystemPwsidConfidence,
      });
      log.step({
        kind: "fetch",
        narration: userStep.narration,
        detail: userStep.detail,
        result_summary: userStep.result_summary,
        source: HEARTH_BRANCH_SOURCE,
      });
      resolution = {
        confidence: house.waterSystemPwsidConfidence,
        pwsid: house.waterSystemUserPwsid,
        pwsName: null,
      };
    } else {
      // Step 1 — direct point-in-polygon lookup.
      const directMatch = await resolvePwsidAtPoint(lat, lng);
      const fetch1 = pwsidFetchNarration({
        lat,
        lng,
        resolved: directMatch.match !== null,
        totalFeatures: directMatch.totalFeatures,
        // Fallback always runs on a direct miss (post-WQA-2-followup).
        willRunFallback: directMatch.match === null,
      });
      log.step({
        kind: "fetch",
        narration: fetch1.narration,
        detail: fetch1.detail,
        result_summary: fetch1.result_summary,
        source: EPA_CWS_SERVICE_AREAS_SOURCE,
      });

      // Step 1b — when the direct lookup missed, run the nearest-polygon
      // fallback (~500m buffer). EPA's national polygon coverage has
      // documented gaps (rural fringes, recent annexations, and pockets
      // inside major cities — 604 Norton Dr in Kalamazoo is the
      // canonical regression case). The fallback recovers the correct
      // PWSID when every nearby polygon belongs to the same utility.
      if (directMatch.match) {
        resolution = {
          confidence: "verified",
          pwsid: directMatch.match.pwsid,
          pwsName: directMatch.match.pwsName,
        };
      } else {
        nearbyOutcome = await resolveNearestPwsid(lat, lng);
        const fallbackStep = nearestPwsidFetchNarration({
          radiusMeters: NEAREST_POLYGON_FALLBACK_RADIUS_M,
          outcome: nearbyOutcome,
        });
        log.step({
          kind: "fetch",
          narration: fallbackStep.narration,
          detail: fallbackStep.detail,
          result_summary: fallbackStep.result_summary,
          source: EPA_CWS_SERVICE_AREAS_SOURCE,
        });
        if (nearbyOutcome.kind === "single-nearby") {
          resolution = {
            confidence: "inferred",
            pwsid: nearbyOutcome.pwsid,
            pwsName: nearbyOutcome.pwsName,
          };
        } else {
          resolution = { confidence: "unmapped" };
        }
      }
    }
    // Step 2 — when we have a PWSID (verified / inferred / user_*),
    // fetch the WATER_SYSTEM inventory record. Inferred and user-
    // supplied PWSIDs are treated as authoritative for data fetching;
    // the confidence distinction surfaces only in payload + activity
    // log.
    let record = null as Awaited<ReturnType<typeof resolveWaterSystem>>["record"];
    if (resolution.confidence !== "unmapped") {
      const store = createSupabaseWaterSystemCacheStore();
      const resolved = await resolveWaterSystem(resolution.pwsid, store);
      record = resolved.record;
      const fetch2 = envirofactsFetchNarration({
        pwsid: resolution.pwsid,
        cacheKind: resolved.cache.kind,
        cacheDetail:
          resolved.cache.kind === "hit"
            ? `Cache hit on hearth.water_systems for ${resolution.pwsid}, refreshed_at=${resolved.cache.refreshedAt.toISOString()}, age=${resolved.cache.ageDays}d, ttl=${CACHE_TTL_DAYS}d`
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

    // Step 2b — CCR shared-cache lookup. Runs whenever we have a PWSID
    // to look up, regardless of the record's activity_code or type.
    // The branch decision honors ccrCached only on the active-CWS path
    // (see branch.ts), so a hit on an inactive or non-community
    // system flows through harmlessly. Soft-fail: a Supabase outage
    // on the cache lookup becomes a no-row result so the rest of
    // the run proceeds with the cws_no_ccr branch. Issue #176 (WQA-3).
    let ccrCacheRow: CcrCacheRow | null = null;
    if (resolution.confidence !== "unmapped") {
      const ccrStore = createSupabaseCcrCacheStore();
      const ccrResolved = await resolveLatestCcr(resolution.pwsid, ccrStore);
      ccrCacheRow = ccrResolved.row;
      const ccrStep = ccrCacheFetchNarration({
        pwsid: resolution.pwsid,
        outcome:
          ccrResolved.cache.kind === "hit"
            ? {
                kind: "hit",
                reportYear: ccrResolved.cache.row.report_year,
                // Contributor city hint is a later WQA-3 follow-up
                // (joins through water_system_report_contributors →
                // hearth.houses → city); for now the narration falls
                // back to the generic "another homeowner on the same
                // system" form.
                cityHint: null,
              }
            : { kind: "miss", reason: ccrResolved.cache.reason },
      });
      log.step({
        kind: "fetch",
        narration: ccrStep.narration,
        detail: ccrStep.detail,
        result_summary: ccrStep.result_summary,
        source: HEARTH_CCR_CACHE_SOURCE,
      });
    }

    // Step 3 — branch decision. The competing-utilities-nearby case is
    // special-cased here rather than in branch.ts: a user with
    // waterSource=null who has multiple utilities within 500m is
    // almost certainly on city water (we just can't pick which one),
    // and the default branch.ts logic would route them to private_well
    // — wrong answer. Route to cws_unmapped instead so the user sees
    // the right framing.
    let decision: { branch: WqaBranch; diagnostic?: string };
    if (
      resolution.confidence === "unmapped" &&
      nearbyOutcome?.kind === "multiple-competing"
    ) {
      const list = nearbyOutcome.candidates
        .map((c) => c.pwsid)
        .join(", ");
      decision = {
        branch: "cws_unmapped",
        diagnostic: `EPA's national map didn't directly match your address. Multiple utilities (${list}) have polygons within ${NEAREST_POLYGON_FALLBACK_RADIUS_M}m, so we can't pick one with confidence.`,
      };
    } else {
      decision = decideBranch({
        waterSource: house.waterSource,
        pwsidResolved: resolution.confidence !== "unmapped",
        record,
        ccrCached: ccrCacheRow !== null,
      });
    }
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
    // soft-fail independently. The cws_unmapped and private_well
    // branches don't have a PWSID to query, so SDWIS is skipped.
    let enrichment: SdwisEnrichment | undefined;
    const shouldFetchSdwis =
      record !== null &&
      (decision.branch === "cws_no_ccr" ||
        decision.branch === "non_community" ||
        decision.branch === "cws_with_ccr");

    if (shouldFetchSdwis && resolution.confidence !== "unmapped") {
      const resolutionPwsid = resolution.pwsid;
      const violationsStore = createSupabaseViolationsCacheStore();
      const lcrStore = createSupabaseLcrCacheStore();

      // Run both fetches in parallel. Using Promise.allSettled so a
      // failure on either doesn't short-circuit the other.
      const [violationsOutcome, lcrOutcome] = await Promise.allSettled([
        resolveViolations(resolutionPwsid, violationsStore),
        resolveLcrSamples(resolutionPwsid, lcrStore),
      ]);

      // Violations fetch step
      let violations: SdwisViolationRecord[] | null = null;
      if (violationsOutcome.status === "fulfilled") {
        violations = violationsOutcome.value.records;
        const cache = violationsOutcome.value.cache;
        const violationsRowCount = violations.length;
        const violationsSourceUrl = violationsOutcome.value.sourceUrl;
        const narr = violationsFetchNarration({
          pwsid: resolutionPwsid,
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
          pwsid: resolutionPwsid,
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
          pwsid: resolutionPwsid,
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
          pwsid: resolutionPwsid,
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

    // Compute the WQA-4 recommended-actions list before payload
    // assembly. We compute here (not inside buildSystemPayload) so the
    // activity log can narrate the emitted IDs without re-running the
    // pure compute. Inputs come from `record` + `enrichment` (both in
    // scope here); skipped entirely on private_well / stale /
    // cws_unmapped — those branches don't surface action cards.
    let recommendedActions: WqaRecommendedAction[] = [];
    if (record && enrichment) {
      const inputs: RecommendedActionsInputs = {
        compliance: enrichment.compliance,
        leadCopper: enrichment.leadCopper,
        adminContact: {
          name: formatAdminName(record.admin_name ?? record.org_name),
          email: record.email_addr ?? null,
          phone: record.phone_number ?? null,
        },
        systemName: displaySystemName(record),
      };
      recommendedActions = buildRecommendedActions(inputs);
      const actionsStep = recommendedActionsComputeNarration({
        emittedActionIds: recommendedActions.map((a) => a.id),
      });
      log.step({
        kind: "compute",
        narration: actionsStep.narration,
        detail: actionsStep.detail,
        result_summary: actionsStep.result_summary,
        source: HEARTH_COMPLIANCE_RULE_SOURCE,
      });
    }

    // Build the payload based on the branch.
    const payload = (() => {
      if (decision.branch === "private_well") {
        return buildPrivateWellPayload(
          decision.diagnostic ??
            "No EPA Community Water System polygon covers this address.",
          // The user-declared private_well path is handled by the
          // short-circuit at the top of check(). Any private_well
          // we reach here came from the polygon-driven fallback.
          "epa-inferred",
        );
      }
      if (decision.branch === "cws_unmapped") {
        return buildCwsUnmappedPayload(
          decision.diagnostic ??
            "User declared municipal water but EPA's polygon coverage didn't include this address.",
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
      // When we reach the buildSystemPayload path the resolution
      // confidence is always "verified" / "inferred" / "user_confirmed"
      // / "user_corrected" — "unmapped" routes to cws_unmapped via the
      // branches above. TypeScript can't narrow that across the IIFE
      // boundary, so we read off the live resolution object directly
      // and fall back to "verified" defensively (unreachable).
      const confidence: "verified" | "inferred" | "user_confirmed" | "user_corrected" =
        resolution.confidence === "unmapped" ? "verified" : resolution.confidence;
      // Build the CCR enrichment from the cache row when we landed on
      // cws_with_ccr. The persisted row's coverage year is the
      // authoritative report_year; published_date may be null.
      const ccrEnrichment =
        decision.branch === "cws_with_ccr" && ccrCacheRow
          ? {
              reportYear: ccrCacheRow.report_year,
              findings: buildCcrFindings({
                reportYear: ccrCacheRow.report_year,
                publishedDate: ccrCacheRow.published_date,
                extractedData: ccrCacheRow.extracted_data,
              }),
            }
          : null;
      return buildSystemPayload(
        decision.branch,
        record,
        enrichment,
        confidence,
        recommendedActions,
        ccrEnrichment,
      );
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
    const f = finding.findings as {
      branch?: string;
      system_card?: {
        pws_name?: string;
        compliance_status_short?:
          | "unknown"
          | "no_active_violations"
          | "active_violations";
      };
      lead_copper_summary?: LeadCopperSummary;
    };
    if (f?.branch === "private_well") {
      return "Your home is on a private water system — we'll add tailored guidance in an upcoming Hearth update.";
    }
    if (f?.branch === "cws_unmapped") {
      return "You're on city water, but EPA's national map doesn't pinpoint your exact utility — you'll be able to upload your annual Water Quality Report manually in a future Hearth update.";
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
    // CWS branches: build the line off severity + compliance + LCR axis
    // so the message names the actual flag driver (issues #186, #188).
    // Helper is pure and unit-tested in `onboarding-message.test.ts`.
    return buildCwsOnboardingMessage({
      severity: finding.severity,
      pwsName: name,
      complianceStatus: f?.system_card?.compliance_status_short,
      lcrAxis: classifyLcrAxis(
        f?.lead_copper_summary ?? { status: "unavailable" },
      ),
    });
  },

  /**
   * Issue #171 (WQA-4): WQA takes over the entire modal body between
   * the header and the activity log. The overview-body component
   * renders the five WQA sections (branch header, system card,
   * recommended actions, detected-in-water, sources) reading purely
   * off the persisted finding.
   *
   * Uses `createElement` rather than JSX so this file stays free of
   * JSX-runtime imports — same discipline `renderDetail` uses for
   * the Superfund site-detail card.
   */
  renderOverviewBody(row, context) {
    return createElement(WqaOverviewBody, {
      row,
      houseId: context.houseId,
      notifyRecheckTriggered: context.notifyRecheckTriggered,
    });
  },

  /**
   * Issue #196 — drives the "fresh-update" banner that surfaces at the
   * top of the modal body after a Recheck completes. Logic + voice in
   * `recheck-summary.ts`; this is the slot binding.
   */
  summarizeRecheckChanges: summarizeWqaRecheckChanges,
};

export default WaterQualityAwarenessModule;
