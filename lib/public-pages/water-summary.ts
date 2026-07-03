/**
 * Pure view-model builder for the public water system page (epic #298,
 * Phase 1). Takes the place-keyed raw data (EPA inventory record,
 * SDWIS violations + LCR samples, the latest extracted CCR) and
 * derives everything `/water/[systemSlug]` renders.
 *
 * Two disciplines are load-bearing here, both from the epic's hard
 * rules:
 *
 *   1. DERIVED VALUES ONLY from the CCR extraction. `extracted_data`
 *      is user-contributed content (whatever PDF someone uploaded), so
 *      the public surface carries counts, years, booleans, and enum
 *      statuses computed from it — never free-text strings out of the
 *      extraction. The system name always comes from EPA's `pws_name`.
 *   2. NOTHING house- or user-scoped comes in and nothing user-
 *      identifying goes out. The input is the same shared-cache data
 *      every house on the utility reads; no uploader identity, no
 *      contributor counts.
 *
 * The classification reuses the WQA module's pure summarizers
 * (`summarizeCompliance`, `summarizeLcr`, `buildCcrFindings`,
 * `buildDisplayedCcrContaminants`) so the public page and the in-app
 * finding can't drift on what counts as detected, approaching, or
 * above a limit.
 */

import {
  summarizeCompliance,
  type ComplianceStatusShort,
} from "@/lib/habitat/modules/water-quality-awareness/compliance";
import {
  classifyLcrAxis,
  summarizeLcr,
  LEAD_ACTION_LEVEL_MG_L,
  COPPER_ACTION_LEVEL_MG_L,
  type LcrMetalState,
  type LeadCopperSummary,
} from "@/lib/habitat/modules/water-quality-awareness/lcr";
import {
  buildCcrFindings,
  buildDisplayedCcrContaminants,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";
import {
  buildDescription,
  displaySystemName,
  mapSourceType,
} from "@/lib/habitat/modules/water-quality-awareness/payload";
import { isPfasName } from "@/lib/habitat/water-quality/contaminants/pfas-grouping";
import type { EnvirofactsWaterSystemRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/envirofacts";
import type { SdwisViolationRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/sdwis-violations";
import type { SdwisLcrSampleRecord } from "@/lib/habitat/modules/water-quality-awareness/sources/sdwis-lcr-samples";
import type { CcrExtractionResult } from "@/lib/documents/ai/ccr-schema";

export type PublicWaterSummaryInput = {
  record: EnvirofactsWaterSystemRecord;
  /** null = the violations fetch soft-failed (distinct from "zero rows"). */
  violations: SdwisViolationRecord[] | null;
  /** null = the LCR fetch soft-failed (distinct from "zero rows"). */
  lcrSamples: SdwisLcrSampleRecord[] | null;
  /** The latest primary CCR row for the PWSID, or null when none exists. */
  ccr: {
    reportYear: number;
    publishedDate: string | null;
    extractedData: CcrExtractionResult;
  } | null;
  /** Reference time, injected so tests can pin "now". */
  now?: Date;
};

/** One lead-or-copper reading for the public compliance block. */
export type PublicMetalReading = {
  state: LcrMetalState;
  /** 90th-percentile value as EPA reports it. */
  value: number;
  unit: string;
  /** Federal action level in the same mg/L space EPA reports in. */
  actionLevelMgL: number;
};

export type PublicWaterSummary = {
  identity: {
    /** Display name derived from EPA's pws_name — never from the CCR. */
    name: string;
    /** Templated sentence from EPA inventory fields. */
    description: string;
    sourceLabel: string;
    populationServed: number | null;
    serviceConnections: number | null;
    /** Year the EPA-recognized source water protection program began. */
    sourceProtectionSinceYear: number | null;
  };
  compliance:
    | { kind: "unknown" }
    | {
        kind: "known";
        status: Exclude<ComplianceStatusShort, "unknown">;
        recentTotal: number;
        recentHealthBased: number;
      };
  leadCopper:
    | { kind: "unknown" }
    | { kind: "no_samples" }
    | {
        kind: "available";
        lead: PublicMetalReading | null;
        copper: PublicMetalReading | null;
      };
  pfas:
    | { kind: "no_data" }
    | { kind: "none_reported" }
    | { kind: "detected"; count: number; anyAtOrAboveLimit: boolean };
  ccr:
    | { kind: "none" }
    | {
        kind: "on_file";
        year: number;
        detectedContaminantCount: number;
        status: "none_detected" | "all_below_limits" | "at_or_above_limit";
      };
};

const SOURCE_LABELS: Record<
  ReturnType<typeof mapSourceType>,
  string
> = {
  groundwater: "Groundwater",
  surface: "Surface water",
  groundwater_under_surface: "Groundwater under surface-water influence",
  unknown: "Not specified",
};

export function buildPublicWaterSummary(
  input: PublicWaterSummaryInput,
): PublicWaterSummary {
  const { record, violations, lcrSamples, ccr } = input;
  const now = input.now ?? new Date();

  // --- Identity: all EPA inventory data, reusing the in-app builders.
  const identity: PublicWaterSummary["identity"] = {
    name: displaySystemName(record),
    description: buildDescription(record),
    sourceLabel: SOURCE_LABELS[mapSourceType(record.gw_sw_code)],
    populationServed:
      typeof record.population_served_count === "number"
        ? record.population_served_count
        : null,
    serviceConnections:
      typeof record.service_connections_count === "number"
        ? record.service_connections_count
        : null,
    sourceProtectionSinceYear: sourceProtectionYear(record),
  };

  // --- Compliance: null input means the fetch failed, so the page says
  // "couldn't read" rather than implying a clean record.
  const complianceSummary =
    violations === null ? null : summarizeCompliance(violations, now);
  const compliance: PublicWaterSummary["compliance"] =
    complianceSummary === null
      ? { kind: "unknown" }
      : {
          kind: "known",
          status:
            complianceSummary.status === "active_violations"
              ? "active_violations"
              : "no_active_violations",
          recentTotal: complianceSummary.recent.total_in_last_5_years,
          recentHealthBased:
            complianceSummary.recent.health_based_in_last_5_years,
        };

  // --- Lead / copper: EPA's own LCR rollups, so values are fine to show.
  const lcrSummary: LeadCopperSummary =
    lcrSamples === null ? { status: "unavailable" } : summarizeLcr(lcrSamples);
  const leadCopper = buildLeadCopperBlock(lcrSummary);

  // --- CCR: everything below is derived — counts, tiers, booleans.
  const ccrFindings = ccr
    ? buildCcrFindings({
        reportYear: ccr.reportYear,
        publishedDate: ccr.publishedDate,
        extractedData: ccr.extractedData,
      })
    : null;
  const displayed = ccrFindings
    ? buildDisplayedCcrContaminants(ccrFindings, lcrSummary)
    : null;

  const ccrBlock: PublicWaterSummary["ccr"] =
    ccrFindings === null || displayed === null || ccr === null
      ? { kind: "none" }
      : {
          kind: "on_file",
          year: ccr.reportYear,
          detectedContaminantCount: displayed.length,
          status:
            displayed.length === 0
              ? "none_detected"
              : displayed.some((c) => c.tier === "concern")
                ? "at_or_above_limit"
                : "all_below_limits",
        };

  const pfas: PublicWaterSummary["pfas"] = (() => {
    if (displayed === null) return { kind: "no_data" };
    const pfasRows = displayed.filter((c) => isPfasName(c.contaminant_name));
    if (pfasRows.length === 0) return { kind: "none_reported" };
    return {
      kind: "detected",
      count: pfasRows.length,
      anyAtOrAboveLimit: pfasRows.some((c) => c.tier === "concern"),
    };
  })();

  return { identity, compliance, leadCopper, pfas, ccr: ccrBlock };
}

function sourceProtectionYear(
  record: EnvirofactsWaterSystemRecord,
): number | null {
  if (record.source_water_protection_code !== "Y") return null;
  if (typeof record.source_protection_begin_date !== "string") return null;
  const d = new Date(record.source_protection_begin_date);
  if (Number.isNaN(d.getTime())) {
    const yearPrefix = Number(record.source_protection_begin_date.slice(0, 4));
    return Number.isInteger(yearPrefix) ? yearPrefix : null;
  }
  return d.getFullYear();
}

function buildLeadCopperBlock(
  summary: LeadCopperSummary,
): PublicWaterSummary["leadCopper"] {
  const axis = classifyLcrAxis(summary);
  if (axis.kind === "unknown") {
    return summary.status === "no_samples_on_file"
      ? { kind: "no_samples" }
      : { kind: "unknown" };
  }
  if (summary.status !== "available") {
    // classifyLcrAxis only returns "available" for available summaries;
    // this branch is unreachable but keeps the narrowing honest.
    return { kind: "unknown" };
  }
  const period = summary.most_recent_sampling_period;
  const lead = period.lead_90th_percentile;
  const copper = period.copper_90th_percentile;
  return {
    kind: "available",
    lead:
      lead && axis.lead !== "absent"
        ? {
            state: axis.lead,
            value: lead.value,
            unit: lead.unit,
            actionLevelMgL: LEAD_ACTION_LEVEL_MG_L,
          }
        : null,
    copper:
      copper && axis.copper !== "absent"
        ? {
            state: axis.copper,
            value: copper.value,
            unit: copper.unit,
            actionLevelMgL: COPPER_ACTION_LEVEL_MG_L,
          }
        : null,
  };
}
