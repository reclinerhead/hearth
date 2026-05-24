/**
 * EPA Superfund Proximity habitat module.
 *
 * Hits the EPA Envirofacts SEMS REST API to pull every NPL-relevant
 * Superfund site in the user's state, measures haversine distance from
 * the user's home to each, applies a three-tier proximity model, and
 * surfaces a finding with full source attribution.
 *
 * Cadence is 'yearly'. The NPL site list and statuses do change but
 * slowly; no caching layer at this point in MVP. At single-digit beta
 * volume the per-onboard latency cost is acceptable.
 *
 * Three-tier proximity model (per issue #37, EPA's standard 1- and 3-mile
 * community-impact rings):
 *   Tier 1 ≤ 0.5 mi     — any NPL status (F, P, A, D)
 *   Tier 2 0.5–2 mi     — Final (F) or Proposed (P) only
 *   Tier 3 2–5 mi       — Final (F) only
 *
 * Severity mapping (see severity.ts):
 *   Tier 1 + F/P → concern
 *   Tier 1 + A/D → caution
 *   Tier 2 + F/P → caution
 *   Tier 3 + F   → neutral
 *   Zero qualifying sites within 5 mi → favorable
 *
 * Future enhancements (deliberately deferred):
 *   - Cleanup milestones from sems.envirofacts_site_milestone.
 *   - Polygon boundary geometry (EPA distributes points only; point-edge
 *     distance is a v2 refinement).
 *   - Caching layer (habitat_sites table).
 *   - Tier 3 "distinguishing factor" gate beyond NPL=F.
 *
 * -------------------------------------------------------------------
 * Activity-log narration arc
 *
 *   1. fetch              — "I asked EPA's Superfund database what sites are in <state>."
 *   2. compute            — "I filtered out sites EPA doesn't have coordinates for."
 *   3. compute            — "I measured the distance from your home to each remaining site."
 *   3a. compute (caveat)  — "A few sites are large or span multiple locations — EPA
 *                            reports a single point even when the actual footprint
 *                            stretches across miles." Emitted only when at least one
 *                            qualifying site has multi-location structure (a `/` in
 *                            its EPA name). For a homeowner with only single-point
 *                            sites this step is omitted and the log stays at 6 steps.
 *   4. rule               — "I applied Hearth's three-tier proximity model."
 *   5. decide             — "The closest site is <name>, <distance> mi <direction>. That
 *                            makes this a '<severity>' in Hearth's classification."
 *                           (or, for zero hits, "Nothing within 5 miles. Marking as
 *                            'favorable'.")
 *   6. finding            — "I put the finding together for your dashboard."
 *
 * Source citations
 *
 *   Step 1 (fetch):   EPA Envirofacts SEMS — Superfund site data.
 *   Step 4 (rule):    /how-it-works#superfund — Hearth's own methodology
 *                     page. The tier model is Hearth's; we cite our own
 *                     page rather than imply EPA publishes a
 *                     "community-impact rings" standard. (Old findings
 *                     persisted with the prior /about/classification URL
 *                     still resolve via a permanent redirect in
 *                     next.config.ts.)
 *   Step 5 (decide):  /how-it-works#superfund — same page.
 * -------------------------------------------------------------------
 */

import { createElement } from "react";
import { createActivityLogger } from "@/lib/habitat/activity-log";
import {
  capitalizeCategoryPhrase,
  summarizeContaminantCategories,
} from "@/lib/habitat/contaminants/categories";
import { findContaminantByAlias } from "@/lib/habitat/contaminants/lookup";
import type { Contaminant } from "@/lib/habitat/contaminants/data";
import type {
  FindingAction,
  HabitatFinding,
  HabitatModule,
  HouseContext,
  OverviewCard,
} from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import {
  fetchSiteContacts,
  siteDocumentsUrl,
  siteProfileUrl,
  type CommunityInvolvementCoordinator,
} from "./cumulis";
import {
  buildNplSitesUrl,
  fetchNplSitesInState,
  parseSiteCoordinates,
  type NplSite,
} from "./fetch";
import {
  bearingWord,
  formatContaminants,
  roundMiles,
  titleCase,
} from "./format";
import { compassBearing, haversineMiles } from "./geo";
import {
  computePortfolioLabel,
  computeSiteLabel,
  LABEL_COLOR,
  LABEL_WORD,
  labelWeight,
  type SuperfundLabel,
} from "./label";
import {
  EPA_ENVIROFACTS_SOURCE,
  HEARTH_CLASSIFICATION_SOURCE,
  HEARTH_TIER_RULE_SOURCE,
  PRECISION_CAVEAT_TEXT,
  coordCleanupNarration,
  decideStepNarration,
  distanceStepNarration,
  fetchStepNarration,
  findingStepNarration,
  noContaminantsSuppressionNarration,
  noSitesDecideNarration,
  precisionCaveatNarration,
  tierFilterNarration,
} from "./narration";
import { generatePortfolioSummary } from "./portfolio-summary/generate";
import type { PortfolioSummarySite } from "./portfolio-summary/prompt";
import {
  computeRecommendedActions,
  type RecommendedAction,
} from "./recommended-actions";
import {
  applyTier,
  maxSeverity,
  nplStatusLabel,
  severityWeight,
  tierAndStatusToSeverity,
  type NplCode,
  type Tier,
} from "./severity";
import { SiteDetail } from "./components/site-detail";
import type {
  PortfolioSummary,
  SiteEntry,
  SuperfundFindings,
} from "./types";

const MODULE_KEY = "epa_superfund_proximity";
const SEARCH_RADIUS_MILES = 5;
const SOURCE_DATASET = "EPA Envirofacts SEMS";
const SOURCE_DATASET_NOTE =
  "EPA provides a single representative point per site, not a polygon. " +
  "Distance is the straight-line haversine distance from your home to that point.";

/**
 * Narrow an EPA-returned npl_status_code string to the four codes this
 * module recognizes. Returns null for "N" or any unexpected value —
 * the consumer skips those sites (they shouldn't appear in the
 * response because the URL filters on F,P,A,D, but defensive against
 * future EPA schema changes).
 */
function narrowNplCode(value: string | null | undefined): NplCode | null {
  if (value === "F" || value === "P" || value === "A" || value === "D") {
    return value;
  }
  return null;
}

/**
 * Per-site payload shapes live in `./types.ts` so the per-site detail
 * component in `./components/site-detail.tsx` can consume them without
 * cycling through this file's runtime imports. The build helper below
 * is what populates the shape.
 */

/**
 * Whether a SEMS site name suggests multiple physical locations rolled
 * into one EPA record. Today: any name containing a `/` separator.
 * Future refinement could lean on EPA's operable-unit (OU) data, but
 * the slash heuristic catches the most visually-misleading cases
 * (Allied Paper / Portage Creek / Kalamazoo River) without over-flagging.
 */
function hasMultiLocationStructure(nameOriginal: string): boolean {
  return nameOriginal.includes("/");
}

function buildSiteEntry(
  raw: NplSite,
  nplCode: NplCode,
  distance: number,
  bearing: string,
  tier: Tier,
  labelContext: {
    waterSource: HouseContext["waterSource"];
    basementPresent: HouseContext["basementPresent"];
  },
): SiteEntry {
  const severity = tierAndStatusToSeverity(tier, nplCode);
  const contaminants = formatContaminants(raw.contaminants ?? []);
  const label = computeSiteLabel({
    tier,
    nplCode,
    contaminants,
    waterSource: labelContext.waterSource,
    basementPresent: labelContext.basementPresent,
  });
  const context: SiteEntry["context"] = {
    distance_miles: roundMiles(distance),
    bearing,
    tier,
    severity:
      severity === "concern" ||
      severity === "caution" ||
      severity === "neutral"
        ? severity
        : "neutral",
    label,
  };
  if (hasMultiLocationStructure(raw.name)) {
    context.precision_note = PRECISION_CAVEAT_TEXT;
  }
  return {
    site: {
      epa_id: raw.epa_id,
      sems_site_id: raw.site_id,
      name_display: titleCase(raw.name),
      name_original: raw.name,
      address: {
        street: titleCase(raw.street_addr_txt ?? ""),
        city: titleCase(raw.city_name ?? ""),
        county: titleCase(raw.county_name ?? ""),
        state: (raw.fk_ref_state_code ?? "").toUpperCase(),
        zip: raw.zip_code ?? "",
      },
      npl_status: {
        code: nplCode,
        label: nplStatusLabel(nplCode),
      },
      contaminants,
      federal_facility: raw.federal_facility_ind === "Y",
      archived: raw.archived_ind === "Y",
      archived_date: raw.archived_date ?? null,
      epa_region_code: raw.fk_ref_region_code ?? null,
      profile_url: siteProfileUrl(raw.site_id),
      documents_url: siteDocumentsUrl(raw.site_id),
      // CIC is enriched in a separate post-filter pass — see
      // enrichQualifyingSitesWithCic() in check() below. The field is
      // omitted here so the type's `?` is honored when the enrichment
      // hasn't been merged in yet (e.g. inside unit tests that exercise
      // buildSiteEntry directly).
    },
    context,
  };
}

/**
 * Sort entries by computed risk-relevance to the user's property
 * (issue #140): label-desc first, then severity-desc, then distance-asc.
 *
 * The label is the issue's preferred visual anchor — worth_acting_on
 * sites lead, worth_knowing next, informational last, with suppressed
 * (null) labels at the bottom. Severity stays a secondary key so two
 * sites at the same label tier still order by Hearth's classification
 * weight. Distance is the final tie-break.
 */
function compareEntries(a: SiteEntry, b: SiteEntry): number {
  const labelDiff =
    labelWeight(b.context.label ?? null) - labelWeight(a.context.label ?? null);
  if (labelDiff !== 0) return labelDiff;
  const sevDiff =
    severityWeight(b.context.severity) - severityWeight(a.context.severity);
  if (sevDiff !== 0) return sevDiff;
  return a.context.distance_miles - b.context.distance_miles;
}

/**
 * Headline for a finding with at least one qualifying site. Tunes
 * the phrasing based on tier (1 = literally in your neighborhood,
 * 2/3 = nearby) and active-cleanup status.
 */
function buildHitHeadline(entries: SiteEntry[]): string {
  if (entries.length === 1) {
    const e = entries[0];
    const active =
      e.site.npl_status.code === "F" || e.site.npl_status.code === "P";
    if (e.context.tier === 1) {
      return active
        ? "An active EPA Superfund cleanup is in your neighborhood"
        : "An EPA Superfund site is in your neighborhood";
    }
    return active
      ? "An active EPA Superfund site is near your home"
      : "An EPA Superfund site is near your home";
  }
  return `${entries.length} EPA Superfund sites are near your home`;
}

/**
 * Render a list of names as a comma-separated phrase with an
 * Oxford-comma "and" before the last entry.
 *
 *   ["A"]            → "A"
 *   ["A", "B"]       → "A and B"
 *   ["A", "B", "C"]  → "A, B, and C"
 *
 * Returns "" for an empty input. Pure given the input.
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const lead = names.slice(0, -1).join(", ");
  return `${lead}, and ${names[names.length - 1]}`;
}

/**
 * Summary copy for a finding with one or more qualifying sites.
 *
 * One site: a one-or-two-sentence narrative naming the site, distance,
 * direction, and current cleanup status — the original v1 copy that
 * still reads well when there's nothing else to list.
 *
 * Two or more sites: a single sentence that names every qualifying
 * site by `name_display`, ordered the same way `findings.sites` is
 * (severity-desc then distance-asc, so the most concerning sites lead
 * the list). Earlier copy named only the closest site, which read as
 * misleading once the modal surfaced every site as a drillable card —
 * the summary was reporting one of five rather than the full picture.
 * Per-site distance / direction / cleanup status live on each card and
 * inside the detail pane.
 */
function buildHitSummary(entries: SiteEntry[]): string {
  if (entries.length === 1) {
    const e = entries[0];
    const dir = bearingWord(e.context.bearing);
    const dist = e.context.distance_miles.toFixed(1);
    const miles = `${dist} mile${dist === "1.0" ? "" : "s"}`;
    const status =
      e.site.npl_status.code === "F"
        ? "Active cleanup is in progress under EPA oversight."
        : e.site.npl_status.code === "P"
          ? "EPA has proposed adding this site to the National Priorities List."
          : e.site.npl_status.code === "A"
            ? "This is part of a larger NPL site listed elsewhere."
            : "Cleanup is complete and the site has been removed from the National Priorities List.";
    return `The ${e.site.name_display} site sits about ${miles} ${dir} of your home. ${status}`;
  }

  const names = entries.map((e) => e.site.name_display);
  return `We detected ${entries.length} EPA Superfund sites near your home, including ${joinNames(names)}.`;
}

/**
 * Per-finding next-step actions. Per-site EPA profile links are
 * surfaced inside the modal's per-site detail pane (see
 * `components/site-detail.tsx`) rather than in the module-level action
 * shelf — the shelf was carrying a "View EPA site profile" pill that
 * pointed at only the closest site, which read as misleading once
 * multiple sites were rendered as drillable cards. The shelf now keeps
 * only the module-level overview link.
 */
function buildHitActions(): FindingAction[] {
  return [
    {
      kind: "link",
      label: "EPA Superfund overview",
      url: "https://www.epa.gov/superfund",
    },
  ];
}

function buildNoHitActions(): FindingAction[] {
  return [
    {
      kind: "link",
      label: "Learn about Superfund",
      url: "https://www.epa.gov/superfund",
    },
  ];
}

/**
 * Onboarding-modal one-liner. Reads from the persisted finding shape
 * (`findings.sites`, `findings.search_state`) rather than from anything
 * the module retained in closure — the modal calls this from whatever
 * row it's hydrating, which may be a different run than the one that
 * built the message helpers.
 *
 * Exported for the test suite.
 */
export function buildOnboardingMessage(finding: HabitatFinding): string {
  const f = finding.findings as {
    sites?: Array<{
      site?: { name_display?: string };
      context?: { distance_miles?: number; bearing?: string };
    }>;
    total_qualifying_sites?: number;
    search_state?: string;
  };
  const sites = Array.isArray(f.sites) ? f.sites : [];

  if (sites.length === 0) {
    const state = f.search_state ? ` in ${f.search_state}` : "";
    return `Good news — no active Superfund sites within 5 miles of your home${state}.`;
  }

  const closest = sites[0];
  const name = closest?.site?.name_display ?? "a Superfund site";
  const distance = closest?.context?.distance_miles;
  const bearing = closest?.context?.bearing;

  if (typeof distance === "number" && typeof bearing === "string") {
    const miles = `${distance.toFixed(1)} mi`;
    if (sites.length === 1) {
      return `Found a Superfund site ${miles} ${bearing} of you — ${name}.`;
    }
    return `Found ${sites.length} Superfund sites near you — closest is ${name}, ${miles} ${bearing}.`;
  }
  if (sites.length === 1) {
    return `Found a Superfund site near you — ${name}.`;
  }
  return `Found ${sites.length} Superfund sites near you — closest is ${name}.`;
}

const EpaSuperfundProximityModule: HabitatModule = {
  key: MODULE_KEY,
  name: "EPA Superfund proximity",
  description:
    "Looks up EPA Superfund sites within 5 miles of the house and ranks them by a three-tier proximity model.",
  category: "environmental",
  cadence: "yearly",
  iconImage: "/habitat_module_images/epa_superfund.jpg",

  isApplicable(house: HouseContext): boolean {
    // Need lat/lng to compute distance, and the 2-letter state to
    // query EPA Envirofacts efficiently. If any is missing, the
    // module doesn't run.
    return (
      house.latitude !== null &&
      house.longitude !== null &&
      Number.isFinite(house.latitude) &&
      Number.isFinite(house.longitude) &&
      typeof house.state === "string" &&
      house.state.trim().length === 2
    );
  },

  async check(house: HouseContext): Promise<HabitatFinding> {
    const log = createActivityLogger();

    // isApplicable guarantees these but TS doesn't carry that guarantee
    // across the call, so re-narrow defensively.
    if (
      house.latitude == null ||
      house.longitude == null ||
      !Number.isFinite(house.latitude) ||
      !Number.isFinite(house.longitude) ||
      !house.state ||
      house.state.trim().length !== 2
    ) {
      log.step({
        kind: "error",
        narration:
          "I couldn't run the Superfund check because your address is missing coordinates or a state code.",
        detail: `state: ${JSON.stringify(house.state)}, lat: ${house.latitude}, lng: ${house.longitude}`,
      });
      throw new Error(
        "Superfund check requires lat/lng coordinates and a 2-letter state code",
      );
    }

    const state = house.state.trim().toUpperCase();
    const home = { latitude: house.latitude, longitude: house.longitude };

    log.step({
      kind: "fetch",
      narration: fetchStepNarration(state),
      detail: `GET ${buildNplSitesUrl(state)}`,
      source: EPA_ENVIROFACTS_SOURCE,
    });

    const allSites = await fetchNplSitesInState(state);

    const geocoded: Array<{ site: NplSite; coords: { latitude: number; longitude: number } }> = [];
    let droppedNoCoords = 0;
    for (const site of allSites) {
      const coords = parseSiteCoordinates(site);
      if (coords) geocoded.push({ site, coords });
      else droppedNoCoords++;
    }

    const coordStep = coordCleanupNarration(droppedNoCoords, geocoded.length);
    log.step({
      kind: "compute",
      narration: coordStep.narration,
      detail: coordStep.detail,
      result_summary: `${allSites.length} fetched → ${geocoded.length} geocoded`,
    });

    const withDistance = geocoded.map(({ site, coords }) => ({
      site,
      coords,
      distance: haversineMiles(home, coords),
      bearing: compassBearing(home, coords),
    }));

    const distanceStep = distanceStepNarration(
      home.latitude,
      home.longitude,
      withDistance.length,
    );
    log.step({
      kind: "compute",
      narration: distanceStep.narration,
      detail: distanceStep.detail,
    });

    // Issue #154: suppress qualifying sites for which EPA hasn't published
    // any contaminants. Without an inventory the modal has nothing
    // actionable to render and the EPA profile URL frequently 404s for
    // these rollup entries (Georgia-Pacific is the canonical example).
    // Filter happens at qualification time so everything downstream
    // (cic enrichment, label rollup, summary, recommended-actions,
    // headline / summary copy, ordering) automatically reflects only
    // the useful sites — no special-casing in any of those layers.
    //
    // The tier step's count still reports sites that passed the tier
    // filter (pre-suppression); the conditional suppression step that
    // follows reports the drop. Keeping the rule step honest about
    // tier-pass count and giving suppression its own beat lets a reader
    // trace the math without conflating two distinct filters.
    const qualifying: SiteEntry[] = [];
    const droppedNoContaminants: SiteEntry[] = [];
    const tierCounts = { 1: 0, 2: 0, 3: 0 } as { 1: number; 2: number; 3: number };
    // Issue #149: per-site label now factors in the homeowner's water
    // source and basement presence. Pass them once through buildSiteEntry
    // so the label-computation call site keeps the rule in one place.
    const labelContext = {
      waterSource: house.waterSource ?? null,
      basementPresent: house.basementPresent ?? null,
    };
    for (const { site, distance, bearing } of withDistance) {
      const nplCode = narrowNplCode(site.npl_status_code);
      if (!nplCode) continue;
      const tier = applyTier(distance, nplCode);
      if (tier === null) continue;
      tierCounts[tier]++;
      const entry = buildSiteEntry(
        site,
        nplCode,
        distance,
        bearing,
        tier,
        labelContext,
      );
      if (entry.site.contaminants.length === 0) {
        droppedNoContaminants.push(entry);
        continue;
      }
      qualifying.push(entry);
    }
    qualifying.sort(compareEntries);
    // tierCounts above includes the suppressed sites — they passed the
    // tier filter, which is the rule step's narrative. tierPassedCount
    // is the value the rule step reports.
    const tierPassedCount = qualifying.length + droppedNoContaminants.length;

    // Conditional compute step: when at least one qualifying site carries
    // the multi-location precision caveat, surface it in the activity log
    // before applying the tier rule so the reader sees the caveat in the
    // same beat as the distance computation it applies to. For a
    // homeowner with only single-point sites the log stays at 6 steps.
    const flaggedSites = qualifying.filter((s) => s.context.precision_note);
    if (flaggedSites.length > 0) {
      const precisionStep = precisionCaveatNarration(
        flaggedSites.map((s) => s.site.name_display),
      );
      log.step({
        kind: "compute",
        narration: precisionStep.narration,
        detail: precisionStep.detail,
      });
    }

    const tierStep = tierFilterNarration(tierPassedCount, tierCounts);
    log.step({
      kind: "rule",
      narration: tierStep.narration,
      detail: tierStep.detail,
      result_summary: tierStep.result_summary,
      source: HEARTH_TIER_RULE_SOURCE,
    });

    // Issue #154: conditional suppression step. Emitted only when at
    // least one tier-qualifying site was dropped for having no
    // contaminant inventory. Names the dropped sites in the detail so a
    // homeowner who notices the count discrepancy can see what was
    // filtered.
    if (droppedNoContaminants.length > 0) {
      const suppression = noContaminantsSuppressionNarration(
        droppedNoContaminants.map((s) => s.site.name_display),
      );
      log.step({
        kind: "compute",
        narration: suppression.narration,
        detail: suppression.detail,
        result_summary: suppression.result_summary,
        source: HEARTH_CLASSIFICATION_SOURCE,
      });
    }

    // Issue #143: enrich each qualifying site with its EPA Community
    // Involvement Coordinator pulled from the Cumulis Contacts sub-page.
    // Runs in parallel across the (small, post-distance-filter) set of
    // qualifying sites — at single-digit n the wall-clock cost is
    // ~1s in the worst case. Soft-fail at every step: a network /
    // parse miss for one site leaves that site's CIC null and does
    // not affect the others. Skipped on the no-hits path below
    // because there are no sites to enrich.
    if (qualifying.length > 0) {
      const cics = await Promise.all(
        qualifying.map((s) => fetchSiteContacts(s.site.sems_site_id)),
      );
      let cicHits = 0;
      for (let i = 0; i < qualifying.length; i++) {
        const cic = cics[i];
        qualifying[i].site.community_involvement_coordinator = cic;
        if (cic) cicHits++;
      }
      log.step({
        kind: "compute",
        narration:
          "I looked up the EPA Community Involvement Coordinator for each nearby site so you have a direct contact for questions.",
        detail: `GET ${qualifying.length} Cumulis contact page${qualifying.length === 1 ? "" : "s"} in parallel; ${cicHits} site${cicHits === 1 ? "" : "s"} had a CIC published`,
        result_summary: `${cicHits} of ${qualifying.length} sites have a CIC`,
      });
    }

    if (qualifying.length === 0) {
      const decideStep = noSitesDecideNarration({
        state,
        totalSites: allSites.length,
      });
      log.step({
        kind: "decide",
        narration: decideStep.narration,
        detail: decideStep.detail,
        result_summary: decideStep.result_summary,
        source: HEARTH_CLASSIFICATION_SOURCE,
      });

      const headline = "No active EPA Superfund sites near your home";
      const stateName = state;
      const county = house.county ? `${house.county} County, ${stateName}` : stateName;
      const suppressedCount = droppedNoContaminants.length;
      // Issue #154: when the only tier-qualifying sites were dropped
      // for missing contaminant inventories, acknowledge the
      // suppression in the no-hits summary so the activity log and
      // the headline copy tell a consistent story to a reader
      // wondering why the count went to zero. Drops the qualifier
      // when nothing was suppressed so the pure no-hits copy stays
      // unchanged for the common case.
      const matchedClause =
        suppressedCount > 0 ? " with published contaminant data" : "";
      const suppressionClause =
        suppressedCount > 0
          ? ` We checked ${suppressedCount} additional site${
              suppressedCount === 1 ? "" : "s"
            } that EPA's database knows about but for which it hasn't published a contaminant inventory; those aren't actionable for a homeowner, so we filtered them out.`
          : "";
      const summary =
        `We checked EPA's Superfund database for sites within ${SEARCH_RADIUS_MILES} miles of your home in ${county} ` +
        `and didn't find any${matchedClause}. The ${allSites.length} site${
          allSites.length === 1 ? "" : "s"
        } in ${stateName} are all farther than that or have completed cleanup.` +
        suppressionClause;

      const findingStep = findingStepNarration(0, headline);
      log.step({
        kind: "finding",
        narration: findingStep.narration,
        result_summary: findingStep.result_summary,
      });

      return {
        severity: "favorable",
        headline,
        summary,
        findings: {
          search_radius_miles: SEARCH_RADIUS_MILES,
          search_state: state,
          source_dataset: SOURCE_DATASET,
          source_dataset_note: SOURCE_DATASET_NOTE,
          total_npl_sites_in_state: allSites.length,
          total_sites_with_coordinates: geocoded.length,
          total_qualifying_sites: 0,
          sites: [],
        },
        actions: buildNoHitActions(),
        sourceUrl: "https://www.epa.gov/superfund",
        activityLog: log.finalize(),
      };
    }

    const topSeverity = maxSeverity(qualifying.map((s) => s.context.severity));
    const closest = qualifying[0];

    // Per-site labels were computed inside buildSiteEntry above; roll
    // them up to a single portfolio label. Issue #140.
    const portfolioLabel = computePortfolioLabel(
      qualifying.map((s) => s.context.label ?? null),
    );

    {
      const labelCounts = qualifying.reduce(
        (acc, s) => {
          const k = s.context.label ?? "suppressed";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const breakdown = Object.entries(labelCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      log.step({
        kind: "compute",
        narration:
          "I labeled each qualifying site by how relevant it is to a homeowner reasoning about whether to take action.",
        detail: `per-site labels → portfolio label('${portfolioLabel ?? "suppressed"}'); breakdown: ${breakdown}`,
        result_summary: portfolioLabel
          ? `portfolio: ${portfolioLabel}`
          : "portfolio: suppressed",
        source: HEARTH_CLASSIFICATION_SOURCE,
      });
    }

    // Portfolio summary generation. Soft-fail: if the env var is unset
    // or the AI call throws, we persist a `text: null` summary and
    // surface the reason in the activity log + debug log. The finding
    // itself ships either way.
    const portfolioSummary = await generatePortfolioSummary({
      state,
      total_qualifying_sites: qualifying.length,
      portfolio_label: portfolioLabel,
      // Issue #149: forward the homeowner's water source and basement
      // presence so the model can mention pathway alignment where it
      // materially changes the framing. Null / "unknown" values flow
      // through verbatim — the prompt builder drops them so the model
      // doesn't try to comment on missing context.
      water_source: house.waterSource ?? null,
      basement_present: house.basementPresent ?? null,
      sites: qualifying.map<PortfolioSummarySite>((s) => ({
        name: s.site.name_display,
        distance_miles: s.context.distance_miles,
        bearing: s.context.bearing,
        npl_status: s.site.npl_status.label,
        site_label: s.context.label ?? null,
        contaminants: s.site.contaminants,
        archived: s.site.archived,
      })),
    });

    log.step({
      kind: "compute",
      narration: portfolioSummary.text
        ? "I drafted a portfolio summary so you can hold the whole picture in your head."
        : "I couldn't draft a portfolio summary this run; the per-site cards still carry the details.",
      detail: portfolioSummary.text
        ? `model('${portfolioSummary.model}'); chars=${portfolioSummary.text.length}`
        : `error_reason: ${portfolioSummary.error_reason}`,
      result_summary: portfolioSummary.text ? "summary: ok" : "summary: skipped",
    });

    // Issue #144: compute recommended actions for THIS user's
    // situation (water source + basement presence) given the
    // contaminant pathway profile across qualifying sites.
    // Deduplicated across sites by design — a single "test your
    // well" action references the union of relevant contaminants,
    // not one entry per site. Suppressed when no actions apply
    // (e.g. user water_source unknown, or all sites have only
    // contaminants whose pathways don't match the home's setup).
    const recommendedActions: RecommendedAction[] =
      computeRecommendedActions({
        qualifyingSites: qualifying,
        houseState: house.state ?? null,
        houseCity: house.city ?? null,
        waterSource: house.waterSource ?? null,
        basementPresent: house.basementPresent ?? null,
      });
    log.step({
      kind: "compute",
      narration:
        recommendedActions.length === 0
          ? "I checked which recommended actions apply to your situation; none fit your water source and basement setup for the sites we found, so I'm not surfacing any."
          : "I built a short list of recommended actions tailored to your water source, basement, and the contaminants documented at nearby sites.",
      detail:
        recommendedActions.length === 0
          ? `waterSource=${house.waterSource ?? "null"}, basementPresent=${house.basementPresent ?? "null"}; no actions emitted`
          : `actions: ${recommendedActions.map((a) => a.id).join(", ")}`,
      result_summary: `${recommendedActions.length} recommended action${recommendedActions.length === 1 ? "" : "s"}`,
    });

    const decideStep = decideStepNarration({
      closestName: closest.site.name_display,
      closestDistance: closest.context.distance_miles,
      closestBearing: closest.context.bearing,
      topSeverity,
      closestTier: closest.context.tier,
      closestNplCode: closest.site.npl_status.code,
    });
    log.step({
      kind: "decide",
      narration: decideStep.narration,
      detail: decideStep.detail,
      result_summary: decideStep.result_summary,
      source: HEARTH_CLASSIFICATION_SOURCE,
    });

    const headline = buildHitHeadline(qualifying);
    const summary = buildHitSummary(qualifying);

    const findingStep = findingStepNarration(qualifying.length, headline);
    log.step({
      kind: "finding",
      narration: findingStep.narration,
      result_summary: findingStep.result_summary,
    });

    const persistedSummary: PortfolioSummary = {
      text: portfolioSummary.text,
      model: portfolioSummary.model,
      generated_at: portfolioSummary.generated_at,
      error_reason: portfolioSummary.error_reason,
    };

    return {
      severity: topSeverity,
      headline,
      summary,
      findings: {
        search_radius_miles: SEARCH_RADIUS_MILES,
        search_state: state,
        source_dataset: SOURCE_DATASET,
        source_dataset_note: SOURCE_DATASET_NOTE,
        total_npl_sites_in_state: allSites.length,
        total_sites_with_coordinates: geocoded.length,
        total_qualifying_sites: qualifying.length,
        sites: qualifying,
        portfolio_label: portfolioLabel,
        portfolio_summary: persistedSummary,
        recommended_actions: recommendedActions,
      },
      actions: buildHitActions(),
      sourceUrl: closest.site.profile_url,
      activityLog: log.finalize(),
      // Issue #158: transient debug capture for the developer-time
      // file-based prompt log. Read by the habitat workflow's
      // writeModuleDebugLog step, never persisted to the row.
      debug: { portfolio_summary: portfolioSummary.debug },
    };
  },

  getOnboardingMessage(finding): string {
    return buildOnboardingMessage(finding);
  },

  overviewCardsHeader: "Sites near your home",

  /**
   * Surface one card per qualifying Superfund site so the modal's
   * slotted shell can render the per-site list in the overview pane.
   * Returns [] when the row hasn't populated `findings.sites` yet
   * (still computing) or when the no-hits payload was written — the
   * modal then falls back to the action shelf + activity log alone.
   */
  getOverviewCards(row: HabitatFindingRow): OverviewCard[] {
    const findings = (row.findings ?? null) as SuperfundFindings | null;
    const sites: SiteEntry[] = Array.isArray(findings?.sites)
      ? findings!.sites
      : [];
    return sites.map((s) => {
      const subtitleParts = [s.site.address.street, s.site.npl_status.label]
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      // Issue #140: lead the eyebrow with the computed label word, so
      // the per-site list's visual anchor is risk-relevance to the
      // user's situation rather than the raw Hearth tier number. Tier
      // stays in the eyebrow as a secondary anchor; suppressed labels
      // fall back to the prior `Tier N · ...` shape.
      const labelKey = s.context.label ?? null;
      const labelWord = labelKey ? LABEL_WORD[labelKey] : null;
      const eyebrow = labelWord
        ? `${labelWord} · ${s.context.distance_miles} mi ${s.context.bearing} · Tier ${s.context.tier}`
        : `Tier ${s.context.tier} · ${s.context.distance_miles} mi ${s.context.bearing}`;
      // Issue #145: plain-English contaminant-category summary
      // rendered as a subheading below the site name, so a user can
      // triage what's actually at each site without opening the
      // detail pane. Suppressed (left undefined) when EPA hasn't
      // published any contaminants for the site (Georgia-Pacific's
      // empty inventory is the canonical example) — the modal then
      // renders just headline + subtitle as before.
      const enrichments: Contaminant[] = s.site.contaminants
        .map((raw) => findContaminantByAlias(raw))
        .filter((c): c is Contaminant => c !== null);
      const lowerPhrase = summarizeContaminantCategories(enrichments);
      const subheading =
        lowerPhrase.length > 0
          ? capitalizeCategoryPhrase(lowerPhrase)
          : undefined;
      return {
        id: s.site.epa_id,
        eyebrow,
        headline: s.site.name_display,
        subheading,
        subtitle: subtitleParts.join(" · "),
        severity: s.context.severity,
        sourceUrl: s.site.profile_url,
      };
    });
  },

  /**
   * Replaces the modal header's severity word with the issue #140
   * computed finding label. Three return cases:
   *
   *   - `{ word, color }` — populated portfolio_label, rendered as the
   *     header eyebrow word in the label's color.
   *   - `null` — explicit suppression. The module computed the label
   *     this run and decided it can't characterize confidently (e.g.
   *     every per-site label suppressed because EPA didn't publish
   *     contaminants). Modal shows no second eyebrow word — a bare
   *     default could read as Hearth-endorsed reassurance.
   *   - `undefined` — legacy row from before #140 landed, with no
   *     `portfolio_label` field on `findings`. Modal falls back to
   *     the default severity-word treatment, same as every other
   *     module. These rows backfill on the next yearly cadence.
   */
  getFindingLabel(row: HabitatFindingRow) {
    const findings = (row.findings ?? null) as SuperfundFindings | null;
    if (!findings || findings.portfolio_label === undefined) {
      return undefined;
    }
    const label = findings.portfolio_label;
    if (label === null) return null;
    return { word: LABEL_WORD[label], color: LABEL_COLOR[label] };
  },

  /**
   * Surfaces the AI-generated portfolio summary as a banner at the top
   * of the modal's overview pane. Returns null when no summary was
   * produced (env unset, AI error, or row persisted before #140) — the
   * pane then falls back to its prior layout (cards → actions → log).
   */
  getOverviewBanner(row: HabitatFindingRow) {
    const findings = (row.findings ?? null) as SuperfundFindings | null;
    const text = findings?.portfolio_summary?.text ?? null;
    if (!text) return null;
    return { text };
  },

  /**
   * Surfaces the issue #144 recommended-actions list. Returns the
   * persisted actions verbatim — they were computed at check() time
   * from the full HouseContext (which isn't on the row), and the
   * slot is a pure read off the finding. Empty array when no actions
   * applied for this portfolio × user situation, or when the row was
   * persisted before #144 landed.
   */
  getRecommendedActions(row: HabitatFindingRow) {
    const findings = (row.findings ?? null) as SuperfundFindings | null;
    return findings?.recommended_actions ?? [];
  },

  /**
   * Render the per-site profile inside the modal's detail pane. The
   * shell provides the back affordance and the scroll container; this
   * function returns the site-detail body content only.
   *
   * Uses createElement rather than JSX so this file (index.ts) stays
   * pure TypeScript — keeps the orchestrator-facing module entry free
   * of JSX-runtime imports the server side never needs.
   */
  renderDetail(row: HabitatFindingRow, cardId: string) {
    return createElement(SiteDetail, { row, cardId });
  },
};

export default EpaSuperfundProximityModule;
