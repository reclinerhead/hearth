/**
 * FEMA Flood Zones habitat module.
 *
 * Queries FEMA's National Flood Hazard Layer (NFHL) at the user's home
 * coordinates and returns the FEMA flood zone designation for the
 * property. One HTTP call, one polygon (usually), one classification.
 *
 * The simplest live-API habitat module by every measure — no
 * state-wide fetch, no multi-record deduplication, no tier model, no
 * proximity math, no slotted-shell drill-down. Single finding, single
 * zone, generic modal.
 *
 * Cadence is 'once'. FEMA updates the NFHL roughly monthly, but a
 * homeowner's mapped flood zone basically never changes within their
 * ownership — the rare LOMA/LOMR cases are tracked as a v1.1 idea
 * rather than a recurring check.
 *
 * Severity mapping (see classify.ts for the full table):
 *   Zone X (minimal)      → favorable
 *   Zone X (shaded/500yr) → neutral
 *   Zone D                → caution
 *   A/AE/AH/AO/AR         → concern  (Special Flood Hazard Area, 100-year floodplain)
 *   AE/A + FLOODWAY       → critical (regulatory floodway)
 *   V/VE                  → critical (coastal high-hazard)
 *   No NFHL coverage      → neutral
 *
 * Edge cases the module handles:
 *   - `-9999` numeric sentinel coerced to null in fetch.ts before
 *     anything else sees the data.
 *   - Multiple overlapping polygons: pick the most severe by severity
 *     weight; log the selection so the user sees the choice.
 *   - Unknown FLD_ZONE: fall through to 'caution' with a logged
 *     warning, so a future EPA schema change shows up clearly in
 *     persisted logs.
 *   - features: []: no-coverage path, severity 'neutral', 4-step log.
 *
 * -------------------------------------------------------------------
 * Activity-log narration arc
 *
 *   1. fetch      — "I looked up your home in FEMA's National Flood Hazard Layer…"
 *   2. compute    — "FEMA put your home in Zone X…" (or "no flood zone" on no-coverage)
 *                   (When multiple polygons returned, narration calls out the selection.
 *                    When an unknown zone is returned, narration flags it.)
 *   3. rule       — "FEMA's flood zone classifications tell us what Zone X means…"
 *                   (Omitted on no-coverage.)
 *   4. decide     — "That maps to a '<severity>' finding in Hearth."
 *   5. finding    — "I put the finding together for your dashboard."
 *
 * Happy path is 5 steps; no-coverage is 4 (rule omitted because there's
 * no zone to apply the rule to).
 *
 * Source citations
 *
 *   Step 1 (fetch):  FEMA National Flood Hazard Layer — upstream dataset.
 *   Step 3 (rule):   FEMA flood zone definitions — external authority.
 *   Step 4 (decide): /about/classification#flood-zones — Hearth's own
 *                    classification page (forward-looking URL; page is
 *                    planned but doesn't exist yet, same pattern as the
 *                    radon and Superfund modules).
 * -------------------------------------------------------------------
 */

import { createActivityLogger } from "@/lib/habitat/activity-log";
import type {
  FindingAction,
  HabitatFinding,
  HabitatModule,
  HabitatSeverity,
  HouseContext,
} from "@/lib/habitat/types";
import {
  buildNfhlQueryUrl,
  fetchFloodZonesAtPoint,
  type NormalizedFloodZone,
} from "./fetch";
import {
  classifyFloodZone,
  pickMostSevere,
  type FloodZoneClassification,
} from "./classify";
import {
  FEMA_NFHL_SOURCE,
  FEMA_ZONE_DEFINITIONS_SOURCE,
  HEARTH_CLASSIFICATION_SOURCE,
  computeStepNarration,
  decideStepNarration,
  fetchStepNarration,
  findingStepNarration,
  multiFeatureComputeNarration,
  noCoverageComputeNarration,
  noCoverageDecideNarration,
  noCoverageFindingNarration,
  ruleStepNarration,
  unknownZoneComputeNarration,
} from "./narration";

const MODULE_KEY = "fema_flood_zones";
const SOURCE_URL =
  "https://www.fema.gov/flood-maps/national-flood-hazard-layer";

/**
 * Persisted finding shape. Mirrors `FemaFloodZoneFindings` in the
 * issue's design doc. The `zone` block is absent when `coverage` is
 * false; the `source` block always present.
 */
export type FemaFloodZoneFindings = {
  coverage: boolean;
  zone?: {
    code: string;
    subtype: string | null;
    is_sfha: boolean;
    static_bfe: number | null;
    v_datum: string | null;
    depth: number | null;
    velocity: number | null;
    floodway: boolean;
  };
  source: {
    dfirm_id: string | null;
    fld_ar_id: string | null;
    study_type: string | null;
    source_citation: string | null;
    queried_coordinates: { lat: number; lon: number };
  };
};

/**
 * Build the FEMA Map Service Center URL for the user's address. The
 * MSC search page accepts a single `AddressQuery` parameter and renders
 * the FEMA flood map polygon overlay for the user's location — gives
 * the user a way to see the actual polygon edge for their area.
 *
 * Exported for the test suite.
 */
export function buildMscAddressQuery(house: HouseContext): string {
  return [house.addressLine1, house.city, `${house.state} ${house.postalCode}`]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Per-finding action chips. Two on the happy path: a deep link to FEMA's
 * own Map Service Center pre-populated to the user's address, plus a
 * link to FEMA's flood-zone definitions page. The no-coverage case
 * drops the MSC link (FEMA has nothing to render for that area) and
 * keeps the learn-more.
 *
 * Exported for the test suite.
 */
export function buildActions(
  house: HouseContext,
  coverage: boolean,
): FindingAction[] {
  const learnMore: FindingAction = {
    kind: "link",
    label: "Learn about flood zones",
    url: "https://www.fema.gov/glossary/flood-zones",
  };
  if (!coverage) return [learnMore];

  const addressQuery = encodeURIComponent(buildMscAddressQuery(house));
  return [
    {
      kind: "link",
      label: "See your area on FEMA's flood map",
      url: `https://msc.fema.gov/portal/search?AddressQuery=${addressQuery}`,
    },
    learnMore,
  ];
}

/**
 * Headline and summary copy for a successful classification. Tone is
 * warm and reassuring without being saccharine — like a knowledgeable
 * friend who looked up the answer for you. The summary always names
 * the zone code so the user can cross-check against FEMA's own site.
 *
 * Exported for the test suite.
 */
export function buildCopy(
  zone: NormalizedFloodZone,
  classification: FloodZoneClassification,
): { headline: string; summary: string } {
  switch (classification.kind) {
    case "minimal_x":
      return {
        headline: "Good news — your home isn't in a FEMA flood zone",
        summary:
          "FEMA puts your property in Zone X, which means minimal flood risk. " +
          "You're outside both the 100-year and 500-year floodplains.",
      };
    case "shaded_x":
      return {
        headline: "Your home is in a low-risk flood area",
        summary:
          "FEMA puts your property in Zone X (shaded) — outside the federally " +
          "regulated floodplain, but in an area with about a 0.2% chance of " +
          "flooding in any given year. Flood insurance is optional here, but " +
          "worth a thought.",
      };
    case "undetermined_d":
      return {
        headline: "FEMA hasn't fully mapped flood risk for your area yet",
        summary:
          "FEMA puts your property in Zone D, which means flood hazard is " +
          "possible but hasn't been formally studied. It's worth checking " +
          "with your local floodplain administrator if you have questions.",
      };
    case "sfha_inland": {
      const bfeSentence = buildBfeSentence(zone);
      return {
        headline: "FEMA has mapped your home in the 100-year floodplain",
        summary:
          `FEMA puts your property in Zone ${zone.fldZone} — a Special Flood ` +
          `Hazard Area. ${bfeSentence}If you have a federally-backed mortgage, ` +
          `flood insurance is required, and it's worth understanding what ` +
          `that means for your property.`,
      };
    }
    case "floodway":
      return {
        headline:
          "Your home is in a regulatory floodway — this needs attention",
        summary:
          "FEMA classifies your property as a regulatory floodway, the active " +
          "channel that carries flood flows during a major event. This is the " +
          "highest-risk inland flood classification, and there are usually " +
          "restrictions on what you can build or modify on properties in this zone.",
      };
    case "coastal_high_hazard":
      return {
        headline:
          "Your home is in a coastal high-hazard zone — worth understanding",
        summary:
          `FEMA classifies your property as Zone ${zone.fldZone} — a coastal ` +
          `high-hazard area where wave action and storm surge add risk on top ` +
          `of standard floodplain flooding. Flood insurance is required for ` +
          `federally-backed mortgages, and building codes here are typically ` +
          `stricter than inland zones.`,
      };
    case "unknown":
      return {
        headline: `FEMA returned a flood zone we don't recognize (Zone ${zone.fldZone})`,
        summary:
          `FEMA puts your property in Zone ${zone.fldZone}, which isn't in ` +
          `Hearth's classification table. We're flagging this for follow-up ` +
          `rather than guessing — FEMA's flood zone definitions page has the ` +
          `most up-to-date list.`,
      };
  }
}

/**
 * Build the "FEMA's base flood elevation here is X feet (DATUM)."
 * sentence when STATIC_BFE is present, or an empty string otherwise.
 * Trailing space included so callers can splice into the summary
 * without worrying about whitespace.
 *
 * Exported for the test suite.
 */
export function buildBfeSentence(zone: NormalizedFloodZone): string {
  if (zone.staticBfe == null) return "";
  const datumClause = zone.vDatum ? ` (${zone.vDatum})` : "";
  return `FEMA's base flood elevation here is ${zone.staticBfe} feet${datumClause}. `;
}

const NO_COVERAGE_HEADLINE = "FEMA hasn't mapped flood zones in your area";
const NO_COVERAGE_SUMMARY =
  "FEMA's National Flood Hazard Layer doesn't have digital coverage for this " +
  "location. NFHL covers roughly 90% of the U.S. population — the remaining " +
  "10% includes some rural and remote areas. Your local floodplain " +
  "administrator likely has the best information for your area.";

/**
 * Onboarding-modal one-liner. Read from the persisted finding shape so
 * the modal can call this off any row, not just the live result of the
 * current run.
 *
 * Exported for the test suite.
 */
export function buildOnboardingMessage(finding: HabitatFinding): string {
  const f = finding.findings as FemaFloodZoneFindings;

  if (!f?.coverage) {
    return "FEMA hasn't mapped flood zones in your area, so I couldn't pull a designation.";
  }

  const zoneCode = f.zone?.code ?? "";
  const subtype = f.zone?.subtype ?? null;
  const floodway = f.zone?.floodway === true;

  if (floodway && (zoneCode === "A" || zoneCode === "AE")) {
    return "FEMA has mapped your home in a regulatory floodway — worth a closer look.";
  }
  if (zoneCode === "V" || zoneCode === "VE") {
    return "FEMA has mapped your home in a coastal high-hazard zone.";
  }
  if (
    zoneCode === "A" ||
    zoneCode === "AE" ||
    zoneCode === "AH" ||
    zoneCode === "AO" ||
    zoneCode === "AR"
  ) {
    return `FEMA has mapped your home in the 100-year floodplain — Zone ${zoneCode}.`;
  }
  if (zoneCode === "D") {
    return "FEMA hasn't fully mapped flood risk for your area yet.";
  }
  if (zoneCode === "X") {
    const sub = subtype?.toUpperCase() ?? "";
    if (sub.includes("0.2 PCT") || sub.includes("0.2%")) {
      return "Your home sits in a low-risk flood area — the 500-year floodplain.";
    }
    return "Good news — your home is in a low-risk flood area.";
  }

  // Unknown zone codes fall through here. The check() flow classifies
  // them as 'caution'; surface a matching one-liner instead of pretending
  // we know what the zone is.
  return `FEMA returned a flood zone we don't recognize (Zone ${zoneCode}).`;
}

const FemaFloodZonesModule: HabitatModule = {
  key: MODULE_KEY,
  name: "FEMA Flood Zones",
  description:
    "Looks up your home's flood zone in FEMA's National Flood Hazard Layer.",
  category: "environmental",
  cadence: "once",
  iconImage: "/habitat_module_images/fema_flood_zones.jpg",

  isApplicable(house: HouseContext): boolean {
    return (
      house.latitude != null &&
      house.longitude != null &&
      Number.isFinite(house.latitude) &&
      Number.isFinite(house.longitude)
    );
  },

  async check(house: HouseContext): Promise<HabitatFinding> {
    const log = createActivityLogger();

    // isApplicable guarantees these but TS doesn't carry the narrowing
    // across the call.
    if (
      house.latitude == null ||
      house.longitude == null ||
      !Number.isFinite(house.latitude) ||
      !Number.isFinite(house.longitude)
    ) {
      log.step({
        kind: "error",
        narration:
          "I couldn't run the FEMA flood zone check because your address is missing coordinates.",
        detail: `lat: ${house.latitude}, lng: ${house.longitude}`,
      });
      throw new Error(
        "FEMA flood zones check requires lat/lng coordinates",
      );
    }

    const lat = house.latitude;
    const lon = house.longitude;

    log.step({
      kind: "fetch",
      narration: fetchStepNarration(),
      detail: `GET ${buildNfhlQueryUrl(lat, lon)}`,
      source: FEMA_NFHL_SOURCE,
    });

    const zones = await fetchFloodZonesAtPoint(lat, lon);

    if (zones.length === 0) {
      return buildNoCoverageFinding({ log, house, lat, lon });
    }

    // Pick the most severe when FEMA returned multiple overlapping polygons.
    // For the single-polygon case (typical), pickMostSevere is the no-op
    // identity selector.
    if (zones.length > 1) {
      const { zone, classification } = pickMostSevere(zones);
      const multi = multiFeatureComputeNarration({
        totalFeatures: zones.length,
        selectedZone: zone.fldZone,
      });
      log.step({
        kind: "compute",
        narration: multi.narration,
        detail: multi.detail,
        result_summary: multi.result_summary,
      });
      return buildHappyPathFinding({
        log,
        house,
        zone,
        classification,
        lat,
        lon,
      });
    }

    const zone = zones[0];
    const classification = classifyFloodZone(zone);

    if (classification.kind === "unknown") {
      const unknown = unknownZoneComputeNarration(zone.fldZone);
      log.step({
        kind: "compute",
        narration: unknown.narration,
        detail: unknown.detail,
        result_summary: unknown.result_summary,
      });
    } else {
      const compute = computeStepNarration(zone);
      log.step({
        kind: "compute",
        narration: compute.narration,
        detail: compute.detail,
        result_summary: compute.result_summary,
      });
    }

    return buildHappyPathFinding({
      log,
      house,
      zone,
      classification,
      lat,
      lon,
    });
  },

  getOnboardingMessage(finding): string {
    return buildOnboardingMessage(finding);
  },
};

/**
 * Build the happy-path finding after the compute step has been logged.
 * Adds the rule + decide + finding steps and returns the persisted
 * shape. Multi-feature and single-feature paths both flow through
 * here so the rule/decide/finding emission stays in one place.
 */
function buildHappyPathFinding(input: {
  log: ReturnType<typeof createActivityLogger>;
  house: HouseContext;
  zone: NormalizedFloodZone;
  classification: FloodZoneClassification;
  lat: number;
  lon: number;
}): HabitatFinding {
  const { log, house, zone, classification, lat, lon } = input;

  const rule = ruleStepNarration(zone, classification);
  log.step({
    kind: "rule",
    narration: rule.narration,
    detail: rule.detail,
    source: FEMA_ZONE_DEFINITIONS_SOURCE,
  });

  const decide = decideStepNarration(zone, classification);
  log.step({
    kind: "decide",
    narration: decide.narration,
    detail: decide.detail,
    result_summary: decide.result_summary,
    source: HEARTH_CLASSIFICATION_SOURCE,
  });

  const { headline, summary } = buildCopy(zone, classification);

  const finding = findingStepNarration(headline);
  log.step({
    kind: "finding",
    narration: finding.narration,
    result_summary: finding.result_summary,
  });

  const findings: FemaFloodZoneFindings = {
    coverage: true,
    zone: {
      code: zone.fldZone,
      subtype: zone.zoneSubty,
      is_sfha: zone.isSfha,
      static_bfe: zone.staticBfe,
      v_datum: zone.vDatum,
      depth: zone.depth,
      velocity: zone.velocity,
      floodway: zone.floodway,
    },
    source: {
      dfirm_id: zone.dfirmId,
      fld_ar_id: zone.fldArId,
      study_type: zone.studyType,
      source_citation: zone.sourceCitation,
      queried_coordinates: { lat, lon },
    },
  };

  return {
    severity: classification.severity satisfies HabitatSeverity,
    headline,
    summary,
    findings: findings as unknown as Record<string, unknown>,
    sourceUrl: SOURCE_URL,
    actions: buildActions(house, true),
    activityLog: log.finalize(),
  };
}

/**
 * Build the no-coverage finding. 4-step log (fetch already emitted;
 * compute / decide / finding here — rule is omitted because there's
 * no zone to apply a rule to).
 */
function buildNoCoverageFinding(input: {
  log: ReturnType<typeof createActivityLogger>;
  house: HouseContext;
  lat: number;
  lon: number;
}): HabitatFinding {
  const { log, house, lat, lon } = input;

  const compute = noCoverageComputeNarration();
  log.step({
    kind: "compute",
    narration: compute.narration,
    detail: compute.detail,
    result_summary: compute.result_summary,
  });

  const decide = noCoverageDecideNarration();
  log.step({
    kind: "decide",
    narration: decide.narration,
    detail: decide.detail,
    result_summary: decide.result_summary,
    source: HEARTH_CLASSIFICATION_SOURCE,
  });

  const finding = noCoverageFindingNarration(NO_COVERAGE_HEADLINE);
  log.step({
    kind: "finding",
    narration: finding.narration,
    result_summary: finding.result_summary,
  });

  const findings: FemaFloodZoneFindings = {
    coverage: false,
    source: {
      dfirm_id: null,
      fld_ar_id: null,
      study_type: null,
      source_citation: null,
      queried_coordinates: { lat, lon },
    },
  };

  return {
    severity: "neutral",
    headline: NO_COVERAGE_HEADLINE,
    summary: NO_COVERAGE_SUMMARY,
    findings: findings as unknown as Record<string, unknown>,
    sourceUrl: SOURCE_URL,
    actions: buildActions(house, false),
    activityLog: log.finalize(),
  };
}

export default FemaFloodZonesModule;
