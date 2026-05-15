/**
 * EPA Radon Zone habitat module.
 *
 * Looks up a house's county in EPA's Map of Radon Zones and returns a
 * finding describing the regional radon potential for that area. The
 * underlying dataset is static (1993, last republished by EPA in
 * June 2024), so this module performs a pure in-memory lookup — no
 * HTTP, no I/O, sub-millisecond.
 *
 * Cadence is 'once' because the answer for a given county doesn't
 * change unless EPA republishes the underlying dataset, at which point
 * we re-run scripts/build-radon-data.ts and the new data ships with
 * the next deploy.
 *
 * Severity mapping:
 *   Zone 1 → 'high'     (regional avg > 4 pCi/L — exceeds EPA action level)
 *   Zone 2 → 'moderate' (regional avg 2-4 pCi/L)
 *   Zone 3 → 'good'     (regional avg < 2 pCi/L)
 *
 * Note: "regional" is load-bearing. The EPA zone is a county-level
 * predicted average. An individual home in a Zone 3 county can still
 * test high; an individual home in a Zone 1 county can still test
 * low. EPA recommends testing every home regardless of zone. The
 * module's summary copy says so explicitly.
 *
 * Future enhancements (deliberately deferred):
 *   - If a house has a radon mitigation system in its inventory,
 *     downgrade severity and adjust summary to mention the every-2-year
 *     post-mitigation re-test EPA recommends.
 *   - LLM-rewritten summary in Hearth's voice via a synthesis step.
 */

import type {
  HabitatFinding,
  HabitatModule,
  HouseContext,
} from "@/lib/habitat/types";
import { RADON_ZONES_BY_STATE, type RadonZone } from "./data";

const MODULE_KEY = "epa_radon_zone";
const SOURCE_URL = "https://www.epa.gov/radon/epa-map-radon-zones-0";

/**
 * Normalize a county name for lookup against RADON_ZONES_BY_STATE.
 * Mirrors normalizeCountyName() in scripts/build-radon-data.ts —
 * the two MUST stay in sync. Exported for the test suite.
 *
 * The transformations:
 *   - Strip geography-type suffix: County, Borough, Parish,
 *     Census Area, Municipality.
 *   - Lowercase.
 *   - Trim.
 *
 * Mapbox strips "County" at extraction time (see extractCounty in
 * onboarding/extract-address.ts), so most US counties arrive here
 * already partially normalized. The other suffixes show up for
 * Alaska, Louisiana, and a few Alaska/HI-style census areas — those
 * pass through Mapbox with the suffix intact and we strip them here.
 */
export function normalizeForLookup(county: string): string {
  return county
    .replace(/\s+(County|Borough|Parish|Census Area|Municipality)$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Map an EPA radon zone to the habitat severity scale.
 * Exported for the test suite.
 */
export function zoneToSeverity(zone: RadonZone): "good" | "moderate" | "high" {
  if (zone === 1) return "high";
  if (zone === 2) return "moderate";
  return "good";
}

function zoneDescription(zone: RadonZone): string {
  if (zone === 1) return "highest potential";
  if (zone === 2) return "moderate potential";
  return "low potential";
}

function zoneSummary(zone: RadonZone, county: string, state: string): string {
  const countyDisplay = `${county} County, ${state}`;

  if (zone === 1) {
    return (
      `${countyDisplay} is classified as EPA Radon Zone 1, the highest of three ` +
      `potential tiers. Counties in this zone have predicted average indoor radon ` +
      `screening levels above the EPA's 4.0 pCi/L action threshold. Test every home ` +
      `regardless of zone — short-term kits are inexpensive, and EPA recommends ` +
      `re-testing every two years (and after any mitigation work).`
    );
  }

  if (zone === 2) {
    return (
      `${countyDisplay} is classified as EPA Radon Zone 2, moderate potential. ` +
      `Counties in this zone have predicted average indoor radon screening levels ` +
      `between 2 and 4 pCi/L. EPA recommends testing every home regardless of zone — ` +
      `elevated radon has been found in homes in all three zones.`
    );
  }

  return (
    `${countyDisplay} is classified as EPA Radon Zone 3, the lowest of three ` +
    `potential tiers. Counties in this zone have predicted average indoor radon ` +
    `screening levels below 2 pCi/L. EPA still recommends testing every home — ` +
    `elevated radon has been found in homes in all three zones.`
  );
}

const EpaRadonZoneModule: HabitatModule = {
  key: MODULE_KEY,
  name: "EPA Radon Zone",
  description:
    "Looks up the county's EPA radon potential classification (Zone 1, 2, or 3).",
  cadence: "once",

  isApplicable(): boolean {
    // Radon zone data covers all US counties. We always apply; check()
    // throws on missing state/county, which the orchestrator surfaces as
    // a 'failed' finding ("we couldn't check radon — county wasn't
    // found") rather than silently as 'not_applicable' ("this doesn't
    // apply to you").
    return true;
  },

  async check(house: HouseContext): Promise<HabitatFinding> {
    // isApplicable guarantees these are present, but TS doesn't carry
    // that guarantee across the call so we re-narrow.
    if (!house.state || !house.county) {
      throw new Error("Radon check requires state and county");
    }

    const stateData = RADON_ZONES_BY_STATE[house.state];
    if (!stateData) {
      throw new Error(
        `EPA radon dataset has no entry for state "${house.state}"`,
      );
    }

    const countyKey = normalizeForLookup(house.county);
    const zone = stateData[countyKey];
    if (zone === undefined) {
      throw new Error(
        `EPA radon dataset has no entry for "${house.county}" in "${house.state}"`,
      );
    }

    return {
      severity: zoneToSeverity(zone),
      headline: `EPA Radon Zone ${zone} — ${zoneDescription(zone)}`,
      summary: zoneSummary(zone, house.county, house.state),
      findings: {
        zone,
        zone_description: zoneDescription(zone),
        county: house.county,
        state: house.state,
        action_threshold_pci_l: 4.0,
        source_dataset: "EPA Map of Radon Zones (1993, republished June 2024)",
        source_dataset_note:
          "County-level regional potential. Not a substitute for testing an individual home.",
      },
      sourceUrl: SOURCE_URL,
    };
  },
};

export default EpaRadonZoneModule;
