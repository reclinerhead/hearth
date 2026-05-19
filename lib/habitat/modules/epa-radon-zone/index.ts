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
 * Severity mapping (per the 6-stop scale in lib/habitat/types.ts):
 *   Zone 1 → 'concern'   (regional avg > 4 pCi/L — exceeds EPA action level)
 *   Zone 2 → 'caution'   (regional avg 2-4 pCi/L)
 *   Zone 3 → 'favorable' (regional avg < 2 pCi/L)
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
 *
 * -------------------------------------------------------------------
 * Activity-log narration arc (the reference example for future modules)
 *
 *   1. fetch    — "I pulled up the EPA's radon zone data for your county."
 *   2. compute  — "I normalized 'COUNTY, STATE' into the dataset's lookup key."
 *   3. rule     — "I checked what Zone N means" (states the EPA tier and
 *                  the pCi/L threshold for that tier).
 *   4. decide   — "Because your county is in Zone N, I'm flagging this as
 *                  '<severity>' in Hearth's classification." (input → output
 *                  → system behavior, on one line.)
 *   5. finding  — "I put the finding together for your dashboard."
 *
 *   On failure (state or county not in the dataset), an `error` step is
 *   emitted before re-throwing. The orchestrator's failure path doesn't
 *   persist the log today; the in-code emission keeps the module's
 *   intent readable and reserves the path for future partial-log persistence.
 *
 * Source citations
 *
 *   Step 1 (fetch):  EPA Map of Radon Zones — the upstream dataset.
 *   Step 3 (rule):   EPA — Radon zones and action levels — the published
 *                    guideline the rule derives from.
 *   Step 4 (decide): /how-it-works#radon — Hearth's own methodology
 *                    page. (Old findings persisted with the prior
 *                    /about/classification#radon URL still resolve via
 *                    a permanent redirect in next.config.ts.)
 * -------------------------------------------------------------------
 */

import { createActivityLogger } from "@/lib/habitat/activity-log";
import { affiliateLink } from "@/lib/affiliate/link";
import type {
  FindingAction,
  HabitatFinding,
  HabitatModule,
  HouseContext,
} from "@/lib/habitat/types";
import { RADON_ZONES_BY_STATE, type RadonZone } from "./data";

const MODULE_KEY = "epa_radon_zone";
const SOURCE_URL = "https://www.epa.gov/radon/epa-map-radon-zones-0";

// Hardcoded rather than parsed from data.ts. The build script
// (scripts/build-radon-data.ts) writes a comment with the publication
// date; this constant is the human-curated counterpart that flows into
// the activity log so a user reading the log sees which vintage of the
// dataset their finding was computed against. Update both at the same
// time when EPA republishes.
const EPA_RADON_DATASET_PUBLISHED = "June 2024";

const EPA_ZONE_SOURCE = {
  label: `EPA Map of Radon Zones (${EPA_RADON_DATASET_PUBLISHED})`,
  url: SOURCE_URL,
};

const EPA_ACTION_LEVEL_SOURCE = {
  label: "EPA — Radon zones and action levels",
  url: "https://www.epa.gov/radon/health-risk-radon",
};

// Cites Hearth's public methodology page. The /about/classification
// URL this used to point at is preserved as a permanent redirect in
// next.config.ts, so old findings persisted with the prior URL still
// resolve correctly when clicked.
const HEARTH_CLASSIFICATION_SOURCE = {
  label: "How Hearth classifies radon findings",
  url: "/how-it-works#radon",
};

/**
 * Full state name → 2-letter USPS code. Used by
 * normalizeStateForLookup() to accept either the abbreviation
 * (Mapbox's typical address_level1 for US addresses) or the full
 * name. Only the 50 states + DC are listed — the EPA dataset doesn't
 * cover territories, so falling through to "unknown" for AS/GU/MP/PR/VI
 * just produces a 'failed' finding, which is the right behavior.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/**
 * Normalize a state value to the 2-letter USPS code used as the key
 * in RADON_ZONES_BY_STATE. Accepts:
 *   - "MI" / "mi" / " MI " — already-coded inputs, upper-cased and
 *     trimmed.
 *   - "Michigan" / "michigan" — full names, mapped via
 *     STATE_NAME_TO_CODE.
 * Falls back to upper-cased input when neither matches; the caller
 * then throws because that key is absent from the dataset.
 *
 * Exported for the test suite.
 */
export function normalizeStateForLookup(state: string): string {
  const trimmed = state.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const code = STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  return code ?? trimmed.toUpperCase();
}

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
 * Map an EPA radon zone to the habitat severity scale. Aligned with the
 * 6-stop scale in lib/habitat/types.ts and the CHECK constraint on
 * hearth.habitat_findings.severity.
 *
 * Exported for the test suite.
 */
export function zoneToSeverity(
  zone: RadonZone,
): "favorable" | "caution" | "concern" {
  if (zone === 1) return "concern";
  if (zone === 2) return "caution";
  return "favorable";
}

function zoneDescription(zone: RadonZone): string {
  if (zone === 1) return "highest potential";
  if (zone === 2) return "moderate potential";
  return "low potential";
}

/**
 * Activity-log narration for the EPA threshold rule a given zone falls
 * under. Each branch's narration is written in first-person voice — the
 * log reads like someone explaining what they just looked up.
 */
function zoneRuleNarration(zone: RadonZone): {
  narration: string;
  result_summary: string;
} {
  if (zone === 1) {
    return {
      narration:
        "I checked what Zone 1 means: it's the EPA's highest tier, where the predicted indoor radon average is above 4 pCi/L — the level at which the EPA recommends taking action.",
      result_summary: "Zone 1 — highest potential",
    };
  }
  if (zone === 2) {
    return {
      narration:
        "I checked what Zone 2 means: it's the EPA's middle tier, where the predicted indoor radon average sits between 2 and 4 pCi/L.",
      result_summary: "Zone 2 — moderate potential",
    };
  }
  return {
    narration:
      "I checked what Zone 3 means: it's the EPA's lowest tier, where the predicted indoor radon average is below 2 pCi/L.",
    result_summary: "Zone 3 — low potential",
  };
}

/**
 * Activity-log narration for mapping an EPA zone to Hearth's severity
 * scale. The result_summary echoes the severity label so a reader
 * skimming the log can see the verdict at a glance.
 */
function severityDecisionNarration(zone: RadonZone): {
  narration: string;
  result_summary: string;
} {
  const severity = zoneToSeverity(zone);
  if (zone === 1) {
    return {
      narration:
        "Because your county is in Zone 1, I'm flagging this as a 'concern' in Hearth's classification so it surfaces near the top of your dashboard.",
      result_summary: `Severity: ${severity}`,
    };
  }
  if (zone === 2) {
    return {
      narration:
        "Because your county is in Zone 2, I'm marking this as 'caution' in Hearth's classification — worth testing, but not urgent.",
      result_summary: `Severity: ${severity}`,
    };
  }
  return {
    narration:
      "Because your county is in Zone 3, I'm marking this as 'favorable' in Hearth's classification — your area is on the low end of EPA's radon predictions.",
    result_summary: `Severity: ${severity}`,
  };
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

/**
 * Zone-aware recommended next steps for a radon finding. Product URLs
 * pass through affiliateLink() so a future Associates-tag migration is a
 * one-file change.
 *
 * Zone 1 surfaces the "find a certified mitigator" service alongside the
 * test kit, because the regional average there exceeds the EPA action
 * threshold and mitigation is a likely follow-up. Zones 2 and 3 stay
 * with the kit + EPA learn-more pair — testing is still the first step,
 * but most homes in those zones won't need professional mitigation.
 *
 * Exported for the test suite.
 */
export function buildActions(zone: RadonZone): FindingAction[] {
  const testKit: FindingAction = {
    kind: "product",
    label: "Short-term radon test kit",
    url: affiliateLink("https://amzn.to/3RjLYfZ"),
    priceHint: "~$19",
  };
  const testKitDevice: FindingAction = {
    kind: "product",
    label: "Long-term radon test device",
    url: affiliateLink("https://amzn.to/3PoPftZ"),
    priceHint: "~$60",
  };
  const epaLearnMore: FindingAction = {
    kind: "link",
    label: "EPA radon overview",
    url: "https://www.epa.gov/radon",
  };
  const findMitigator: FindingAction = {
    kind: "service",
    label: "Find a certified mitigator",
    url: "https://www.nrpp.info/proSearch.shtml",
  };

  if (zone === 1) return [testKit, testKitDevice, findMitigator, epaLearnMore];
  return [testKit, epaLearnMore];
}

/**
 * Short, user-facing string rendered in the first-run onboarding modal
 * after this module's check() resolves. Leads with the finding (zone +
 * what it means) and uses the county name when present so the line
 * reads as something a person would say, not a system status.
 *
 * Exported for the test suite.
 */
export function buildOnboardingMessage(finding: HabitatFinding): string {
  const zone = finding.findings.zone;
  const county =
    typeof finding.findings.county === "string" && finding.findings.county
      ? `${finding.findings.county} County`
      : "your county";

  if (zone === 1) {
    return `Found Zone 1 radon in ${county} — the highest of three tiers. We'll flag this for follow-up.`;
  }
  if (zone === 2) {
    return `${county} is in EPA Radon Zone 2 — moderate potential. Worth testing when you get a chance.`;
  }
  // Zone 3 (the only remaining value the radon dataset produces) — positive framing.
  return `Good news — ${county} is in EPA Radon Zone 3, the lowest radon tier.`;
}

const EpaRadonZoneModule: HabitatModule = {
  key: MODULE_KEY,
  name: "EPA Radon Zone",
  description:
    "Looks up the county's EPA radon potential classification (Zone 1, 2, or 3).",
  category: "environmental",
  cadence: "once",
  iconImage: "/habitat_module_images/radon.jpg",

  isApplicable(): boolean {
    // Radon zone data covers all US counties. We always apply; check()
    // throws on missing state/county, which the orchestrator surfaces as
    // a 'failed' finding ("we couldn't check radon — county wasn't
    // found") rather than silently as 'not_applicable' ("this doesn't
    // apply to you").
    return true;
  },

  async check(house: HouseContext): Promise<HabitatFinding> {
    const log = createActivityLogger();

    // isApplicable guarantees these are present, but TS doesn't carry
    // that guarantee across the call so we re-narrow.
    if (!house.state || !house.county) {
      log.step({
        kind: "error",
        narration:
          "I couldn't run the radon check because your address is missing a state or county.",
        detail: `state: ${JSON.stringify(house.state)}, county: ${JSON.stringify(house.county)}`,
      });
      throw new Error("Radon check requires state and county");
    }

    log.step({
      kind: "fetch",
      narration: `I started by pulling up the EPA's radon zone data for ${house.county} County, ${house.state}.`,
      detail: `lib/habitat/modules/epa-radon-zone/data.ts (EPA dataset published ${EPA_RADON_DATASET_PUBLISHED})`,
      source: EPA_ZONE_SOURCE,
    });

    const stateKey = normalizeStateForLookup(house.state);
    const countyKey = normalizeForLookup(house.county);

    log.step({
      kind: "compute",
      narration: `I normalized "${house.county} County, ${house.state}" into a lookup key the dataset uses.`,
      detail: `RADON_ZONES_BY_STATE[${stateKey}][${countyKey}]`,
    });

    const stateData = RADON_ZONES_BY_STATE[stateKey];
    if (!stateData) {
      log.step({
        kind: "error",
        narration: `I couldn't find ${house.state} in the EPA dataset, so I can't tell you the radon zone for your county.`,
        detail: `Normalized state key "${stateKey}" not present in RADON_ZONES_BY_STATE.`,
      });
      throw new Error(
        `EPA radon dataset has no entry for state "${house.state}"`,
      );
    }

    const zone = stateData[countyKey];
    if (zone === undefined) {
      log.step({
        kind: "error",
        narration: `I found ${house.state} in the dataset but couldn't locate ${house.county} County inside it.`,
        detail: `Normalized county key "${countyKey}" not present under state "${stateKey}".`,
      });
      throw new Error(
        `EPA radon dataset has no entry for "${house.county}" in "${house.state}"`,
      );
    }

    const ruleNarration = zoneRuleNarration(zone);
    log.step({
      kind: "rule",
      narration: ruleNarration.narration,
      result_summary: ruleNarration.result_summary,
      detail: "EPA action level: 4.0 pCi/L.",
      source: EPA_ACTION_LEVEL_SOURCE,
    });

    const severityDecision = severityDecisionNarration(zone);
    log.step({
      kind: "decide",
      narration: severityDecision.narration,
      detail: `zone(${zone}) → severity('${zoneToSeverity(zone)}')`,
      result_summary: severityDecision.result_summary,
      source: HEARTH_CLASSIFICATION_SOURCE,
    });

    const headline = `EPA Radon Zone ${zone} — ${zoneDescription(zone)}`;

    log.step({
      kind: "finding",
      narration:
        "I put the finding together for your dashboard with a short summary and the next steps you can take.",
      result_summary: headline,
    });

    return {
      severity: zoneToSeverity(zone),
      headline,
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
      actions: buildActions(zone),
      sourceUrl: SOURCE_URL,
      activityLog: log.finalize(),
    };
  },

  getOnboardingMessage(finding): string {
    return buildOnboardingMessage(finding);
  },
};

export default EpaRadonZoneModule;
