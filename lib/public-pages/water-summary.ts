/**
 * Pure view-model builder for the public water system page (epic #298,
 * Phase 1; full contaminant detail + trends in issue #303). Takes the
 * place-keyed raw data (EPA inventory record, SDWIS violations + LCR
 * samples, every extracted CCR year) and derives everything
 * `/water/[systemSlug]` renders.
 *
 * Two disciplines are load-bearing here, both from the epic's hard
 * rules:
 *
 *   1. NO EXTRACTION FREE-TEXT ON THE PAGE. `extracted_data` is
 *      user-contributed content (whatever PDF someone uploaded), so a
 *      crafted upload must never place attacker-chosen text on a
 *      public, indexed page. Issue #303 amended the rule's OTHER half
 *      (summary-level only) — the page now renders full per-contaminant
 *      detail — but the text discipline stands: names, descriptions,
 *      and EPA links come from the canonical contaminants reference
 *      (`findWqaContaminantByAlias`), units pass a small allowlist,
 *      everything else is a validated number or one of our own labels.
 *      Rows that fail resolution or unit normalization are OMITTED from
 *      the named list and rolled into an honest count. The system name
 *      always comes from EPA's `pws_name`, never from the CCR.
 *   2. NOTHING house- or user-scoped comes in and nothing user-
 *      identifying goes out. The input is the same shared-cache data
 *      every house on the utility reads; no uploader identity, no
 *      contributor counts.
 *
 * The classification reuses the WQA module's pure summarizers
 * (`summarizeCompliance`, `summarizeLcr`, `buildCcrFindings`,
 * `buildDisplayedCcrContaminants`, the trend module) so the public
 * page and the in-app finding can't drift on what counts as detected,
 * approaching, above a limit, or trending.
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
  type CcrContaminantTier,
  type CcrSummarizedContaminant,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";
import {
  buildDescription,
  displaySystemName,
  formatAdminName,
  mapSourceType,
} from "@/lib/habitat/modules/water-quality-awareness/payload";
import {
  personalizeRemediationMatrix,
  recommendRemediationCombination,
  type DetectedContaminantInput,
  type PersonalizedRemediationRow,
  type RemediationCombination,
} from "@/lib/habitat/water-quality/remediation/recommend";
import { PFAS_FAMILY_HEADING } from "@/lib/habitat/water-quality/contaminants/pfas-grouping";
import { findWqaContaminantByAlias } from "@/lib/habitat/water-quality/contaminants/lookup";
import {
  applyTrendEscalation,
  buildContaminantHistory,
  computeTrend,
  findSeriesByName,
  trendDataSpanLabel,
  trendTone,
  trendWord,
  type ContaminantHistory,
  type TrendDirection,
} from "@/lib/habitat/water-quality/contaminants/trends";
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
  /**
   * Every extracted primary CCR year for the PWSID (any order; empty
   * when none exist). The latest year drives the displayed list; the
   * full set drives the year-over-year trends (issue #303).
   */
  ccrYears: Array<{
    reportYear: number;
    publishedDate: string | null;
    extractedData: CcrExtractionResult;
  }>;
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

/**
 * A single numeric reading in a public trend — year + level only. Units
 * live on the row (allowlisted); no extraction strings ride along.
 */
export type PublicTrendPoint = { year: number; level: number };

/** The sanitized trend block for one public contaminant row. */
export type PublicTrend = {
  direction: TrendDirection;
  /** Our own label ("Falling", "First year of data", …). */
  word: string;
  /** Semantic tone — the page maps this to its colors. */
  tone: "attention" | "positive" | "neutral";
  /** Our own data-span caption ("4 readings · 2022–2025"). */
  spanLabel: string;
  /** Prior reading as numbers, for the "was X in YYYY" caption. */
  previous: PublicTrendPoint | null;
  /** Oldest-first readings; drives the sparkline. */
  points: PublicTrendPoint[];
};

/**
 * One fully-renderable public contaminant row. Every string field is
 * Hearth's own text (canonical reference) or an allowlisted unit —
 * never the extraction's.
 */
export type PublicDetectedRow = {
  /** Canonical display name from the contaminants reference. */
  name: string;
  tier: CcrContaminantTier;
  level: number | null;
  /** Canonical allowlisted unit, or null when the report gave none. */
  unit: string | null;
  /** The federal limit the level is measured against (MCL or action level). */
  limit: number | null;
  /** Editorial description from the reference. */
  description: string;
  /** EPA reference link from the reference. */
  learnMoreUrl: string;
  trend: PublicTrend | null;
};

/** A list entry: a normal row, or the PFAS family card (2+ analytes). */
export type PublicDetectedItem =
  | { kind: "single"; row: PublicDetectedRow }
  | {
      kind: "pfas_family";
      heading: string;
      description: string;
      learnMoreUrl: string;
      /** Ordered by detected level, descending. */
      analytes: PublicDetectedRow[];
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
    | {
        kind: "detected";
        count: number;
        anyAtOrAboveLimit: boolean;
        /** Trend tallies across the detected PFAS analytes. */
        falling: number;
        rising: number;
        stable: number;
        /** Analytes with fewer than two comparable readings. */
        inconclusive: number;
      };
  /** Full per-contaminant detail from the latest report (issue #303). */
  detected:
    | { kind: "no_data" }
    | {
        kind: "available";
        reportYear: number;
        reportsOnFile: { count: number; firstYear: number; lastYear: number };
        items: PublicDetectedItem[];
        /** Rows omitted because they didn't resolve against the
         *  canonical reference (or their unit failed the allowlist). */
        omittedCount: number;
        omittedAnyConcern: boolean;
      };
  ccr:
    | { kind: "none" }
    | {
        kind: "on_file";
        year: number;
        detectedContaminantCount: number;
        status: "none_detected" | "all_below_limits" | "at_or_above_limit";
      };
  /**
   * The utility's EPA-listed contact for the civic "what you can do next"
   * block. Name + phone only — the admin email is deliberately NOT carried
   * (epic #298 hard rule 7, as amended for #303 follow-up: an org-level
   * phone for a resident to call is legitimate; a harvestable email is
   * not). PWSID is never included here (hard rule 3). Null when EPA has no
   * phone on file.
   */
  utilityContact: { name: string | null; phone: string | null } | null;
  /**
   * The public remediation matrix (issue #303 follow-up) — the same "which
   * filter addresses what's in your water, and the best-bang-for-buck
   * combination" analysis the in-app modal shows, personalized to the
   * latest report's detected contaminants. Every rendered string is a
   * static matrix label or a sanitized level; the detected inputs are the
   * canonical-resolved public rows, so no extraction free-text feeds it.
   * `none` when there's no CCR, or nothing detected maps onto a matrix row.
   */
  remediation:
    | { kind: "none" }
    | {
        kind: "available";
        reportYear: number;
        /** Detected-first, then reference order — matches the in-app view. */
        personalized: PersonalizedRemediationRow[];
        combination: RemediationCombination;
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

/**
 * Unit allowlist — lowercase-normalized report spelling → the canonical
 * form the page renders. A unit outside this list disqualifies its row
 * from the named public list (the row still counts in `omittedCount`):
 * the unit column is the one free-text field a detected row would
 * otherwise carry onto the page.
 */
const UNIT_CANONICAL: Record<string, string> = {
  ppt: "ppt",
  ppb: "ppb",
  ppm: "ppm",
  "ng/l": "ng/L",
  "ug/l": "µg/L",
  "µg/l": "µg/L",
  "mg/l": "mg/L",
  "pci/l": "pCi/L",
  ntu: "NTU",
  mfl: "MFL",
  gpg: "grains per gallon",
  "grains per gallon": "grains per gallon",
  "mg/l as caco3": "mg/L as CaCO₃",
};

function normalizePublicUnit(
  raw: string | null,
): { ok: true; unit: string | null } | { ok: false } {
  if (raw === null) return { ok: true, unit: null };
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const canonical = UNIT_CANONICAL[key];
  return canonical ? { ok: true, unit: canonical } : { ok: false };
}

export function buildPublicWaterSummary(
  input: PublicWaterSummaryInput,
): PublicWaterSummary {
  const { record, violations, lcrSamples, ccrYears } = input;
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

  // --- CCR: latest year drives the displayed list; every year feeds
  // the trend history — the same pipeline the in-app finding runs.
  const latest =
    ccrYears.length > 0
      ? ccrYears.reduce((a, b) => (b.reportYear > a.reportYear ? b : a))
      : null;
  const history: ContaminantHistory | null =
    ccrYears.length > 0
      ? buildContaminantHistory(
          ccrYears.map((y) => ({
            report_year: y.reportYear,
            published_date: y.publishedDate,
            extracted_data: y.extractedData,
          })),
        )
      : null;

  const ccrFindings = latest
    ? buildCcrFindings({
        reportYear: latest.reportYear,
        publishedDate: latest.publishedDate,
        extractedData: latest.extractedData,
      })
    : null;
  // Trend-aware tier escalation (issue #291), same as the in-app check():
  // a below-limit contaminant rising toward its limit reads as caution.
  if (ccrFindings?.contaminants && history) {
    ccrFindings.contaminants = applyTrendEscalation(
      ccrFindings.contaminants,
      history,
    );
  }
  const displayed = ccrFindings
    ? buildDisplayedCcrContaminants(ccrFindings, lcrSummary)
    : null;

  const ccrBlock: PublicWaterSummary["ccr"] =
    ccrFindings === null || displayed === null || latest === null
      ? { kind: "none" }
      : {
          kind: "on_file",
          year: latest.reportYear,
          detectedContaminantCount: displayed.length,
          status:
            displayed.length === 0
              ? "none_detected"
              : displayed.some((c) => c.tier === "concern")
                ? "at_or_above_limit"
                : "all_below_limits",
        };

  const detected = buildDetectedBlock({
    displayed,
    latestYear: latest?.reportYear ?? null,
    ccrYears,
    history,
  });

  const pfas = buildPfasBlock(detected, displayed);
  const remediation = buildRemediationBlock(detected);

  // Utility contact for the civic next-steps block: name + phone only,
  // never the email (hard rule 7 as amended). Gated on a phone being on
  // file — a contact block with no callable number isn't worth showing.
  const utilityContact: PublicWaterSummary["utilityContact"] =
    typeof record.phone_number === "string" && record.phone_number.trim()
      ? {
          name: formatAdminName(record.admin_name ?? record.org_name),
          phone: record.phone_number,
        }
      : null;

  return {
    identity,
    compliance,
    leadCopper,
    pfas,
    detected,
    ccr: ccrBlock,
    utilityContact,
    remediation,
  };
}

/**
 * Personalize the remediation matrix to the detected contaminants and
 * pick the best-value treatment combination — reusing the same pure
 * WQA-5 helpers the in-app modal uses. The inputs are built from the
 * already-sanitized public rows (canonical name + level/allowlisted
 * unit), so nothing the matcher sees or the recommender renders is
 * extraction free-text. `none` when nothing detected maps onto a row.
 */
function buildRemediationBlock(
  detected: PublicWaterSummary["detected"],
): PublicWaterSummary["remediation"] {
  if (detected.kind !== "available") return { kind: "none" };

  const inputs: DetectedContaminantInput[] = [];
  for (const item of detected.items) {
    if (item.kind === "single") inputs.push(toMatrixInput(item.row));
    else for (const a of item.analytes) inputs.push(toMatrixInput(a));
  }

  const combination = recommendRemediationCombination(inputs);
  // Nothing detected mapped onto a matrix row (e.g. copper-only) — the
  // matrix would render all-blank, so suppress the section.
  if (combination.primary.detected_count === 0) return { kind: "none" };

  const personalized = [...personalizeRemediationMatrix(inputs)].sort(
    (a, b) => Number(b.detected) - Number(a.detected),
  );
  return {
    kind: "available",
    reportYear: detected.reportYear,
    personalized,
    combination,
  };
}

/** Sanitized matrix input: canonical name (for matching) + a level label
 *  built only from a validated number and an allowlisted unit. */
function toMatrixInput(row: PublicDetectedRow): DetectedContaminantInput {
  return {
    name: row.name,
    level_label:
      row.level !== null
        ? row.unit
          ? `${row.level} ${row.unit}`
          : `${row.level}`
        : null,
  };
}

/**
 * Resolve one displayed contaminant into a public row, or null when it
 * can't be rendered without extraction text (no canonical reference
 * entry, or a unit outside the allowlist).
 */
function toPublicRow(
  c: CcrSummarizedContaminant,
  history: ContaminantHistory | null,
): PublicDetectedRow | null {
  const ref = findWqaContaminantByAlias(c.contaminant_name);
  if (!ref) return null;
  const unit = normalizePublicUnit(c.unit);
  if (!unit.ok) return null;

  // The same limit fallback the modal and PDF use: MCL first, then the
  // LCR action level (lead/copper carry their limit there).
  const limit =
    c.mcl !== null && c.mcl > 0
      ? c.mcl
      : c.mcl_action_level !== null && c.mcl_action_level > 0
        ? c.mcl_action_level
        : null;

  // Trend, sanitized to numbers + our own labels. The series is keyed by
  // the extraction name (used as a lookup key only — never rendered).
  const trendSource = computeTrend(findSeriesByName(history, c.contaminant_name));
  const points: PublicTrendPoint[] = trendSource.points.map((p) => ({
    year: p.year,
    level: p.level,
  }));
  const trend: PublicTrend | null =
    trendSource.yearsOfData >= 2
      ? {
          direction: trendSource.direction,
          word: trendWord(trendSource.direction),
          tone: trendTone(trendSource.direction),
          spanLabel: trendDataSpanLabel(trendSource),
          previous: trendSource.previous
            ? {
                year: trendSource.previous.year,
                level: trendSource.previous.level,
              }
            : null,
          points,
        }
      : null;

  return {
    name: ref.canonical_name,
    tier: c.tier,
    level: c.detected_level,
    unit: unit.unit,
    limit,
    description: ref.description,
    learnMoreUrl: ref.learn_more_url,
    trend,
  };
}

function buildDetectedBlock(args: {
  displayed: CcrSummarizedContaminant[] | null;
  latestYear: number | null;
  ccrYears: PublicWaterSummaryInput["ccrYears"];
  history: ContaminantHistory | null;
}): PublicWaterSummary["detected"] {
  const { displayed, latestYear, ccrYears, history } = args;
  if (displayed === null || latestYear === null) return { kind: "no_data" };

  // Resolve every row; track omissions honestly.
  let omittedCount = 0;
  let omittedAnyConcern = false;
  const resolved: Array<{
    row: PublicDetectedRow;
    isPfas: boolean;
  }> = [];
  for (const c of displayed) {
    const row = toPublicRow(c, history);
    if (!row) {
      omittedCount += 1;
      if (c.tier === "concern") omittedAnyConcern = true;
      continue;
    }
    const ref = findWqaContaminantByAlias(c.contaminant_name);
    resolved.push({ row, isPfas: ref?.category === "pfas" });
  }

  // PFAS family folding, mirroring `groupPfasFamily`: 2+ analytes fold
  // into one family card at the first PFAS position, ordered by level
  // descending. Family copy comes from the "PFAS" reference entry.
  const pfasRows = resolved.filter((r) => r.isPfas).map((r) => r.row);
  const items: PublicDetectedItem[] = [];
  if (pfasRows.length < 2) {
    for (const r of resolved) items.push({ kind: "single", row: r.row });
  } else {
    const familyRef = findWqaContaminantByAlias("PFAS");
    const analytes = pfasRows
      .slice()
      .sort((a, b) => (b.level ?? -Infinity) - (a.level ?? -Infinity));
    let familyEmitted = false;
    for (const r of resolved) {
      if (r.isPfas) {
        if (!familyEmitted && familyRef) {
          items.push({
            kind: "pfas_family",
            heading: PFAS_FAMILY_HEADING,
            description: familyRef.description,
            learnMoreUrl: familyRef.learn_more_url,
            analytes,
          });
          familyEmitted = true;
        }
        continue;
      }
      items.push({ kind: "single", row: r.row });
    }
  }

  const years = ccrYears.map((y) => y.reportYear);
  return {
    kind: "available",
    reportYear: latestYear,
    reportsOnFile: {
      count: years.length,
      firstYear: Math.min(...years),
      lastYear: Math.max(...years),
    },
    items,
    omittedCount,
    omittedAnyConcern,
  };
}

/**
 * The PFAS block, derived from the public detected rows (so the news
 * section and the family card can't disagree). Trend tallies count the
 * detected analytes by direction — the "four of five trending down"
 * sentence is computed here, never hand-written.
 */
function buildPfasBlock(
  detected: PublicWaterSummary["detected"],
  displayed: CcrSummarizedContaminant[] | null,
): PublicWaterSummary["pfas"] {
  if (displayed === null) return { kind: "no_data" };
  if (detected.kind !== "available") return { kind: "no_data" };

  const family = detected.items.find((i) => i.kind === "pfas_family");
  const analytes: PublicDetectedRow[] =
    family?.kind === "pfas_family"
      ? family.analytes
      : detected.items
          .filter(
            (i): i is Extract<PublicDetectedItem, { kind: "single" }> =>
              i.kind === "single",
          )
          .map((i) => i.row)
          .filter((r) => isPfasCanonicalName(r.name));

  if (analytes.length === 0) return { kind: "none_reported" };

  let falling = 0;
  let rising = 0;
  let stable = 0;
  let inconclusive = 0;
  for (const a of analytes) {
    switch (a.trend?.direction) {
      case "falling":
        falling += 1;
        break;
      case "rising":
        rising += 1;
        break;
      case "stable":
        stable += 1;
        break;
      default:
        inconclusive += 1;
    }
  }

  return {
    kind: "detected",
    count: analytes.length,
    anyAtOrAboveLimit: analytes.some((a) => a.tier === "concern"),
    falling,
    rising,
    stable,
    inconclusive,
  };
}

/** Canonical-name PFAS check for the lone-analyte (no family card) case. */
function isPfasCanonicalName(name: string): boolean {
  const ref = findWqaContaminantByAlias(name);
  return ref?.category === "pfas";
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
