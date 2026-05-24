/**
 * Recommended-actions logic for the EPA Superfund module (issue #144).
 *
 * The Superfund finding modal renders an actions section between the
 * portfolio summary banner and the per-site card list — a small number
 * of concrete "here's what you'd do" cards calibrated to the
 * homeowner's situation (water source, basement presence) and the
 * portfolio's contaminant pathway profile.
 *
 * Three action types in v1:
 *
 *   1. Test your well water — for well / shared water sources when
 *      any nearby site has groundwater-pathway contaminants of
 *      concern.
 *   2. Check your utility's water quality report — for municipal
 *      water source under the same contaminant condition; links to
 *      EPA's CCR search tool.
 *   3. Check for vapor intrusion concerns — only when the home has
 *      a basement AND at least one Tier 1 site has a vapor-intrusion
 *      pathway contaminant.
 *
 * Suppression matches the project's "suppress rather than guess"
 * pattern (the #140 label work). Unknown water_source / null
 * basement_present skip the relevant actions rather than rendering a
 * hedged version that might mislead.
 *
 * The function is pure: input is the qualifying-site list plus the
 * three property-situation inputs from HouseContext; output is the
 * actions array. Easy to unit-test across every branch.
 */

import { summarizeContaminantCategories } from "@/lib/habitat/contaminants/categories";
import {
  findContaminantByAlias,
} from "@/lib/habitat/contaminants/lookup";
import type {
  Contaminant,
  Pathway,
} from "@/lib/habitat/contaminants/data";
import type { SiteEntry } from "./types";

export type RecommendedAction = {
  /** Stable id for React keys + sort stability across runs. */
  id: string;
  /**
   * Icon name to render in the card's leading slot. Must be a valid
   * key in components/icon.tsx — the modal renders this through
   * `<Icon name={...} />`. Type widened to string here so this
   * pure-logic module doesn't take a dependency on the icon registry.
   */
  icon: string;
  headline: string;
  supporting_line: string;
  /** Optional CTA. When present the modal renders a trailing link. */
  link?: {
    label: string;
    url: string;
  };
};

export type ComputeRecommendedActionsInput = {
  qualifyingSites: SiteEntry[];
  /**
   * From HouseContext — used to pre-fill EPA's CCR search form via
   * its APEX P102_STATE item (a USPS 2-letter code). When null we
   * fall back to the bare landing URL.
   */
  houseState: string | null;
  /**
   * From HouseContext — also pre-fills the CCR search form via the
   * P102_CITY item. Optional; the form already requires the state.
   */
  houseCity: string | null;
  /** From HouseContext.waterSource. */
  waterSource: "well" | "municipal" | "shared" | "unknown" | null;
  /** From HouseContext.basementPresent. */
  basementPresent: boolean | null;
};

/**
 * Collect every enriched (canonical-table-known) contaminant across
 * the qualifying sites whose pathways include the given pathway and
 * whose concern_level is at least moderate. Returns a unique set
 * keyed by canonical_name — a chemical mentioned at 5 sites still
 * appears once.
 */
function collectRelevantContaminants(
  sites: SiteEntry[],
  pathway: Pathway,
  minConcern: "moderate" | "high",
): Contaminant[] {
  const seen = new Map<string, Contaminant>();
  for (const site of sites) {
    for (const raw of site.site.contaminants) {
      const c = findContaminantByAlias(raw);
      if (!c) continue;
      if (!c.pathways.includes(pathway)) continue;
      if (minConcern === "high" && c.concern_level !== "high") continue;
      if (
        minConcern === "moderate" &&
        c.concern_level !== "high" &&
        c.concern_level !== "moderate"
      ) {
        continue;
      }
      seen.set(c.canonical_name, c);
    }
  }
  return Array.from(seen.values());
}

/** Half-mile = Tier 1. The vapor-intrusion radius is the issue's
 *  "defensible half-mile precautionary radius" mapped onto the
 *  existing proximity model. */
function hasVaporIntrusionConcern(sites: SiteEntry[]): boolean {
  return sites.some((s) => {
    if (s.context.tier !== 1) return false;
    for (const raw of s.site.contaminants) {
      const c = findContaminantByAlias(raw);
      if (!c) continue;
      if (c.pathways.includes("vapor_intrusion")) return true;
    }
    return false;
  });
}

/**
 * EPA's CCR (Consumer Confidence Report) search tool. The underlying
 * APEX form takes deep-link pre-fills via the
 * `f?p=<app>:<page>:<session>::<debug>:<clear>:<itemNames>:<itemValues>`
 * URL convention. The form's item names are `P102_STATE` and
 * `P102_CITY` (verified by inspecting the rendered form HTML); the
 * generated link arrives at the page with the state pre-selected
 * and the city pre-typed, so the user only has to click Search.
 *
 * If we don't have a state (every real house does, but defensive),
 * fall back to the bare landing URL — the form's state field is
 * required, so pre-filling just city doesn't save the user a step.
 *
 * If the city contains a comma we skip it: APEX uses `,` as the item-
 * values separator and we don't want to bother with the escape
 * convention for the rare city-with-comma case. State pre-fill is
 * still preserved.
 */
const EPA_CCR_SEARCH_BASE =
  "https://ofmpub.epa.gov/apex/safewater/f?p=136:102";

function buildCcrSearchUrl(
  state: string | null,
  city: string | null,
): string {
  if (!state) return EPA_CCR_SEARCH_BASE;
  const items: string[] = ["P102_STATE"];
  const values: string[] = [encodeURIComponent(state)];
  if (city && !city.includes(",")) {
    items.push("P102_CITY");
    values.push(encodeURIComponent(city));
  }
  return `${EPA_CCR_SEARCH_BASE}:0::::${items.join(",")}:${values.join(",")}`;
}

/**
 * EPA's "find a state-certified drinking water laboratory" page.
 * Lists the certifying authority per state with contact info. Closer
 * to a definitive starting point than any single commercial lab
 * search, and EPA-authoritative.
 */
const EPA_CERTIFIED_LABS_URL =
  "https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water";

/**
 * EPA's vapor intrusion overview — used as the link target for the
 * vapor-intrusion action so users can read the underlying technical
 * framing before deciding whether to engage a consultant.
 */
const EPA_VAPOR_INTRUSION_URL =
  "https://www.epa.gov/vaporintrusion";

export function computeRecommendedActions(
  input: ComputeRecommendedActionsInput,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  if (input.qualifyingSites.length === 0) return actions;

  // --- Action 1 / 2: water-test variants (mutually exclusive by water source).
  // Skip entirely when water_source is null (never captured) or
  // "unknown" (user said they don't know) — we can't responsibly
  // recommend a specific water-test action without knowing whether
  // the user is on a private well or a municipal supply.
  const groundwaterContaminants = collectRelevantContaminants(
    input.qualifyingSites,
    "groundwater",
    "moderate",
  );

  if (
    groundwaterContaminants.length > 0 &&
    (input.waterSource === "well" || input.waterSource === "shared")
  ) {
    const phrase = summarizeContaminantCategories(groundwaterContaminants);
    actions.push({
      id: "test-your-well",
      icon: "droplet",
      headline:
        input.waterSource === "shared"
          ? "Test your shared water system"
          : "Test your well water",
      supporting_line:
        input.waterSource === "shared"
          ? `Your home draws from a shared private water system. Nearby Superfund sites have documented ${phrase} that can migrate through groundwater to wells in the area. A state-certified water-testing laboratory can run a panel covering the relevant contaminants.`
          : `Your home draws from a private well. Nearby Superfund sites have documented ${phrase} that can migrate through groundwater to private wells in the area. A state-certified water-testing laboratory can run a panel covering the relevant contaminants.`,
      link: {
        label: "Find a state-certified water-testing lab",
        url: EPA_CERTIFIED_LABS_URL,
      },
    });
  }

  if (
    groundwaterContaminants.length > 0 &&
    input.waterSource === "municipal"
  ) {
    const phrase = summarizeContaminantCategories(groundwaterContaminants);
    const cityPhrase = input.houseCity
      ? `Your utility serves ${input.houseCity}, and their most recent`
      : "Your utility's most recent";
    actions.push({
      id: "review-utility-ccr",
      icon: "file-text",
      headline: "Check your utility's water quality report",
      supporting_line:
        `Your home is on a municipal water system, which is independently tested and treated by your utility. ` +
        `Nearby Superfund sites have documented ${phrase} that can migrate through groundwater — your utility's monitoring covers whether any of these are detected in the treated supply. ` +
        `${cityPhrase} Consumer Confidence Report is the authoritative source for what's actually at your tap.`,
      link: {
        label: "Find your utility's Consumer Confidence Report",
        url: buildCcrSearchUrl(input.houseState, input.houseCity),
      },
    });
  }

  // --- Action 3: vapor intrusion.
  // Gates on all three conditions being true:
  //   - basement_present === true (not null/false — suppress when
  //     unknown or absent rather than alarm the wrong households)
  //   - at least one Tier 1 (≤0.5 mi) site is in scope
  //   - that close site has a contaminant with vapor_intrusion pathway
  if (
    input.basementPresent === true &&
    hasVaporIntrusionConcern(input.qualifyingSites)
  ) {
    actions.push({
      id: "check-vapor-intrusion",
      icon: "wind",
      headline: "Check for vapor intrusion concerns",
      supporting_line:
        "Your home has a basement, and at least one nearby Superfund site within half a mile has documented volatile chemicals (typically chlorinated solvents like TCE or PCE) that can rise as gas from contaminated soil or groundwater through cracks in foundations and basement floors. A licensed environmental consultant can test indoor air or sub-slab soil gas.",
      link: {
        label: "About vapor intrusion (EPA)",
        url: EPA_VAPOR_INTRUSION_URL,
      },
    });
  }

  return actions;
}
