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
 *   1. fetch    — "I asked EPA's Superfund database what sites are in <state>."
 *   2. compute  — "I filtered out sites EPA doesn't have coordinates for."
 *   3. compute  — "I measured the distance from your home to each remaining site."
 *   4. rule     — "I applied Hearth's three-tier proximity model."
 *   5. decide   — "The closest site is <name>, <distance> mi <direction>. That makes
 *                  this a '<severity>' in Hearth's classification."
 *                 (or, for zero hits, "Nothing within 5 miles. Marking as
 *                  'favorable'.")
 *   6. finding  — "I put the finding together for your dashboard."
 *
 * Source citations
 *
 *   Step 1 (fetch):   EPA Envirofacts SEMS — Superfund site data.
 *   Step 4 (rule):    EPA — Superfund community-impact rings.
 *   Step 5 (decide):  /about/classification#superfund — Hearth's own
 *                     classification page (forward-looking URL).
 * -------------------------------------------------------------------
 */

import { createActivityLogger } from "@/lib/habitat/activity-log";
import type {
  FindingAction,
  HabitatFinding,
  HabitatModule,
  HouseContext,
} from "@/lib/habitat/types";
import {
  buildNplSitesUrl,
  fetchNplSitesInState,
  parseSiteCoordinates,
  siteProfileUrl,
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
  EPA_ENVIROFACTS_SOURCE,
  EPA_SUPERFUND_RINGS_SOURCE,
  HEARTH_CLASSIFICATION_SOURCE,
  coordCleanupNarration,
  decideStepNarration,
  distanceStepNarration,
  fetchStepNarration,
  findingStepNarration,
  noSitesDecideNarration,
  tierFilterNarration,
} from "./narration";
import {
  applyTier,
  maxSeverity,
  nplStatusLabel,
  severityWeight,
  tierAndStatusToSeverity,
  type NplCode,
  type Tier,
} from "./severity";

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
 * Build a SiteEntry — the per-site payload that lands inside
 * findings.sites. Pure given a site and its computed context.
 */
type SiteEntry = {
  site: {
    epa_id: string;
    sems_site_id: string;
    name_display: string;
    name_original: string;
    address: {
      street: string;
      city: string;
      county: string;
      state: string;
      zip: string;
    };
    npl_status: {
      code: NplCode;
      label: string;
    };
    contaminants: string[];
    federal_facility: boolean;
    archived: boolean;
    profile_url: string;
  };
  context: {
    distance_miles: number;
    bearing: string;
    tier: Tier;
    severity: "concern" | "caution" | "neutral";
  };
};

function buildSiteEntry(
  raw: NplSite,
  nplCode: NplCode,
  distance: number,
  bearing: string,
  tier: Tier,
): SiteEntry {
  const severity = tierAndStatusToSeverity(tier, nplCode);
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
      contaminants: formatContaminants(raw.contaminants ?? []),
      federal_facility: raw.federal_facility_ind === "Y",
      archived: raw.archived_ind === "Y",
      profile_url: siteProfileUrl(raw.site_id),
    },
    context: {
      distance_miles: roundMiles(distance),
      bearing,
      tier,
      severity:
        severity === "concern" ||
        severity === "caution" ||
        severity === "neutral"
          ? severity
          : "neutral",
    },
  };
}

/**
 * Sort entries severity-desc, then distance-asc — the order findings.sites
 * is serialized in and the order the dashboard surfaces them in.
 */
function compareEntries(a: SiteEntry, b: SiteEntry): number {
  const sevDiff = severityWeight(b.context.severity) - severityWeight(a.context.severity);
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
 * One- or two-sentence summary naming the nearest site, distance,
 * direction, and current cleanup status.
 */
function buildHitSummary(entries: SiteEntry[]): string {
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

/**
 * Per-finding next-step actions. The hit case surfaces the EPA profile
 * for the closest site plus the general Superfund overview; the
 * no-hits case just surfaces the overview.
 */
function buildHitActions(closestSite: SiteEntry): FindingAction[] {
  return [
    {
      kind: "link",
      label: "View EPA site profile",
      url: closestSite.site.profile_url,
    },
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
  cadence: "yearly",

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

    const qualifying: SiteEntry[] = [];
    const tierCounts = { 1: 0, 2: 0, 3: 0 } as { 1: number; 2: number; 3: number };
    for (const { site, distance, bearing } of withDistance) {
      const nplCode = narrowNplCode(site.npl_status_code);
      if (!nplCode) continue;
      const tier = applyTier(distance, nplCode);
      if (tier === null) continue;
      tierCounts[tier]++;
      qualifying.push(buildSiteEntry(site, nplCode, distance, bearing, tier));
    }
    qualifying.sort(compareEntries);

    const tierStep = tierFilterNarration(qualifying.length, tierCounts);
    log.step({
      kind: "rule",
      narration: tierStep.narration,
      detail: tierStep.detail,
      result_summary: tierStep.result_summary,
      source: EPA_SUPERFUND_RINGS_SOURCE,
    });

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
      const summary =
        `We checked EPA's Superfund database for sites within ${SEARCH_RADIUS_MILES} miles of your home in ${county} ` +
        `and didn't find any. The ${allSites.length} site${
          allSites.length === 1 ? "" : "s"
        } in ${stateName} are all farther than that or have completed cleanup.`;

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
      },
      actions: buildHitActions(closest),
      sourceUrl: closest.site.profile_url,
      activityLog: log.finalize(),
    };
  },

  getOnboardingMessage(finding): string {
    return buildOnboardingMessage(finding);
  },
};

export default EpaSuperfundProximityModule;
