import { describe, expect, it } from "vitest";
import {
  computeRecommendedActions,
  type ComputeRecommendedActionsInput,
  type RecommendedAction,
} from "./recommended-actions";
import type { SiteEntry } from "./types";

/**
 * Build a SiteEntry with overrides for tests. Defaults to a Tier 2
 * Final-NPL site with no contaminants so the test author has to opt
 * in to anything more specific (which also catches "the action
 * accidentally fires because the default matched something").
 */
function makeEntry(overrides: {
  contaminants?: string[];
  tier?: 1 | 2 | 3;
  nplCode?: "F" | "P" | "A" | "D";
  semsSiteId?: string;
} = {}): SiteEntry {
  const tier = overrides.tier ?? 2;
  const npl = overrides.nplCode ?? "F";
  return {
    site: {
      epa_id: `EPA-${overrides.semsSiteId ?? "0000000"}`,
      sems_site_id: overrides.semsSiteId ?? "0000000",
      name_display: "Test Site",
      name_original: "TEST SITE",
      address: {
        street: "1 Main St",
        city: "Kalamazoo",
        county: "Kalamazoo",
        state: "MI",
        zip: "49006",
      },
      npl_status: {
        code: npl,
        label:
          npl === "F"
            ? "Final NPL"
            : npl === "P"
              ? "Proposed NPL"
              : npl === "A"
                ? "Part of NPL site"
                : "Deleted from NPL",
      },
      contaminants: overrides.contaminants ?? [],
      federal_facility: false,
      archived: false,
      archived_date: null,
      epa_region_code: "05",
      profile_url: "https://example.invalid/profile",
      documents_url: "https://example.invalid/docs",
    },
    context: {
      distance_miles: tier === 1 ? 0.4 : tier === 2 ? 1.2 : 3.0,
      bearing: "N",
      tier,
      severity:
        tier === 1 && (npl === "F" || npl === "P")
          ? "concern"
          : tier === 1 || (tier === 2 && (npl === "F" || npl === "P"))
            ? "caution"
            : "neutral",
      label: null,
    },
  };
}

function makeInput(
  overrides: Partial<ComputeRecommendedActionsInput> = {},
): ComputeRecommendedActionsInput {
  return {
    qualifyingSites: [],
    houseState: "MI",
    houseCity: "Kalamazoo",
    waterSource: null,
    basementPresent: null,
    ...overrides,
  };
}

function ids(actions: RecommendedAction[]): string[] {
  return actions.map((a) => a.id);
}

describe("computeRecommendedActions — empty input", () => {
  it("returns [] when there are no qualifying sites", () => {
    expect(computeRecommendedActions(makeInput())).toEqual([]);
  });

  it("returns [] when sites have no enriched (alias-resolved) contaminants", () => {
    // Even with sites and a well user, an unknown chemistry string
    // doesn't match the canonical table and so doesn't enable any
    // pathway-gated action. Better to skip than alarm on noise.
    expect(
      computeRecommendedActions(
        makeInput({
          waterSource: "well",
          basementPresent: true,
          qualifyingSites: [
            makeEntry({ contaminants: ["Phlogiston-42"], tier: 1 }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("computeRecommendedActions — water-test branches", () => {
  it("emits 'test your well water' for well users with groundwater-pathway contaminants of concern", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [makeEntry({ contaminants: ["Lead", "Arsenic"] })],
      }),
    );
    expect(ids(actions)).toEqual(["test-your-well"]);
    const a = actions[0];
    expect(a.headline).toBe("Test your well water");
    expect(a.supporting_line).toContain("private well");
    expect(a.supporting_line).toContain("heavy metals");
    expect(a.link?.url).toContain("epa.gov/dwlabcert");
  });

  it("emits the shared-system variant for water_source = 'shared'", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "shared",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(actions[0]?.headline).toBe("Test your shared water system");
    expect(actions[0]?.supporting_line).toContain("shared private water system");
  });

  it("emits 'check your utility's water quality report' for municipal users with relevant groundwater contaminants", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: "MI",
        houseCity: "Kalamazoo",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(ids(actions)).toEqual(["review-utility-ccr"]);
    const a = actions[0];
    expect(a.supporting_line).toContain("Kalamazoo");
    expect(a.supporting_line).toContain("Consumer Confidence Report");
    expect(a.link?.url).toContain("safewater");
  });

  it("pre-fills the CCR search form via APEX item URL pattern (state + city)", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: "MI",
        houseCity: "Kalamazoo",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    // The form's APEX item names are P102_STATE and P102_CITY; the
    // f?p=...:itemNames:itemValues convention lands the user on the
    // search page with both fields populated and the dropdown
    // pre-selected — they just have to click Search.
    expect(actions[0]?.link?.url).toBe(
      "https://ofmpub.epa.gov/apex/safewater/f?p=136:102:0::::P102_STATE,P102_CITY:MI,Kalamazoo",
    );
  });

  it("falls back to a city-less CCR phrasing AND state-only URL pre-fill when houseCity is null", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: "MI",
        houseCity: null,
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(actions[0]?.supporting_line).not.toContain("Kalamazoo");
    expect(actions[0]?.supporting_line).toContain(
      "Your utility's most recent",
    );
    expect(actions[0]?.link?.url).toBe(
      "https://ofmpub.epa.gov/apex/safewater/f?p=136:102:0::::P102_STATE:MI",
    );
  });

  it("falls back to the bare CCR landing URL when houseState is missing (state is form-required)", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: null,
        houseCity: "Kalamazoo",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(actions[0]?.link?.url).toBe(
      "https://ofmpub.epa.gov/apex/safewater/f?p=136:102",
    );
  });

  it("URL-encodes city values with spaces (e.g. 'New York')", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: "NY",
        houseCity: "New York",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(actions[0]?.link?.url).toBe(
      "https://ofmpub.epa.gov/apex/safewater/f?p=136:102:0::::P102_STATE,P102_CITY:NY,New%20York",
    );
  });

  it("skips the city pre-fill when the city name contains a comma (state still pre-fills)", () => {
    // APEX uses comma as the item-values separator. A city with a
    // comma in its name would corrupt the parse. Skip the city
    // rather than implement the escape convention for a rare case;
    // the state pre-fill is still worth keeping.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        houseState: "MO",
        houseCity: "St. Louis, MO",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(actions[0]?.link?.url).toBe(
      "https://ofmpub.epa.gov/apex/safewater/f?p=136:102:0::::P102_STATE:MO",
    );
  });

  it("suppresses both water-test variants when water_source is 'unknown'", () => {
    // The household explicitly told us they don't know — we can't
    // pick well-vs-municipal copy responsibly. Skip the whole
    // category. (Same intent as the #140 label suppression for
    // unknowables.)
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "unknown",
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(ids(actions)).toEqual([]);
  });

  it("suppresses both water-test variants when water_source is null (never captured)", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: null,
        qualifyingSites: [makeEntry({ contaminants: ["Lead"] })],
      }),
    );
    expect(ids(actions)).toEqual([]);
  });

  it("does not emit a water-test action when sites have no groundwater-pathway contaminants", () => {
    // Asbestos pathway is airborne_particulate only — no groundwater.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [makeEntry({ contaminants: ["Asbestos"] })],
      }),
    );
    expect(actions.find((a) => a.id === "test-your-well")).toBeUndefined();
    expect(actions.find((a) => a.id === "review-utility-ccr")).toBeUndefined();
  });

  it("does not emit a water-test action when only low-concern groundwater contaminants are present", () => {
    // Iron is concern_level: 'low'. Below the moderate threshold.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [makeEntry({ contaminants: ["Iron"] })],
      }),
    );
    expect(ids(actions)).toEqual([]);
  });
});

describe("computeRecommendedActions — vapor intrusion branch", () => {
  it("emits the vapor-intrusion action for basement=true + Tier 1 site with VOC pathway", () => {
    const actions = computeRecommendedActions(
      makeInput({
        basementPresent: true,
        qualifyingSites: [
          makeEntry({ contaminants: ["Trichloroethene"], tier: 1 }),
        ],
      }),
    );
    expect(ids(actions)).toContain("check-vapor-intrusion");
  });

  it("does not emit vapor intrusion when basement_present is null (unknown)", () => {
    const actions = computeRecommendedActions(
      makeInput({
        basementPresent: null,
        qualifyingSites: [
          makeEntry({ contaminants: ["Trichloroethene"], tier: 1 }),
        ],
      }),
    );
    expect(ids(actions)).not.toContain("check-vapor-intrusion");
  });

  it("does not emit vapor intrusion when basement_present is false", () => {
    const actions = computeRecommendedActions(
      makeInput({
        basementPresent: false,
        qualifyingSites: [
          makeEntry({ contaminants: ["Trichloroethene"], tier: 1 }),
        ],
      }),
    );
    expect(ids(actions)).not.toContain("check-vapor-intrusion");
  });

  it("does not emit vapor intrusion when the VOC site is Tier 2 (farther than half a mile)", () => {
    // The radius gate maps to Tier 1 (≤0.5 mi). Tier 2 sites can
    // still have VOCs, but the action's precautionary half-mile
    // framing doesn't apply to them.
    const actions = computeRecommendedActions(
      makeInput({
        basementPresent: true,
        qualifyingSites: [
          makeEntry({ contaminants: ["Trichloroethene"], tier: 2 }),
        ],
      }),
    );
    expect(ids(actions)).not.toContain("check-vapor-intrusion");
  });

  it("does not emit vapor intrusion when the only Tier 1 sites lack vapor-intrusion-pathway contaminants", () => {
    // PCBs are soil + surface_water — no vapor intrusion path.
    const actions = computeRecommendedActions(
      makeInput({
        basementPresent: true,
        qualifyingSites: [
          makeEntry({
            contaminants: ["Polychlorinated biphenyls"],
            tier: 1,
          }),
        ],
      }),
    );
    expect(ids(actions)).not.toContain("check-vapor-intrusion");
  });
});

describe("computeRecommendedActions — full integration cases", () => {
  it("(well user + heavy-metals-dominant portfolio) emits the well-test action only — no vapor intrusion", () => {
    // Sample test case explicitly named in issue #144's acceptance
    // criteria. Heavy metals are groundwater + soil, no vapor path,
    // so the vapor intrusion action correctly stays off.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        basementPresent: true,
        qualifyingSites: [
          makeEntry({
            contaminants: ["Lead", "Arsenic", "Cadmium"],
            tier: 1,
          }),
          makeEntry({
            contaminants: ["Mercury"],
            tier: 2,
          }),
        ],
      }),
    );
    expect(ids(actions)).toEqual(["test-your-well"]);
  });

  it("(municipal user + chlorinated-solvents-dominant portfolio + basement) emits CCR + vapor intrusion", () => {
    // The other sample test case from issue #144's acceptance
    // criteria. Municipal water + VOC pathway + basement should
    // produce two actions: one to read the CCR, one to investigate
    // vapor intrusion since the close site has a VOC.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "municipal",
        basementPresent: true,
        qualifyingSites: [
          makeEntry({
            contaminants: ["Trichloroethene", "Tetrachloroethene"],
            tier: 1,
          }),
          makeEntry({
            contaminants: ["Vinyl chloride"],
            tier: 2,
          }),
        ],
      }),
    );
    expect(ids(actions)).toEqual([
      "review-utility-ccr",
      "check-vapor-intrusion",
    ]);
  });

  it("dedups the contaminant category phrase across many sites (Lead+Lead+Lead+Arsenic = 'heavy metals', not repeated)", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [
          makeEntry({ contaminants: ["Lead"], semsSiteId: "1" }),
          makeEntry({ contaminants: ["Lead"], semsSiteId: "2" }),
          makeEntry({ contaminants: ["Arsenic"], semsSiteId: "3" }),
        ],
      }),
    );
    expect(actions[0]?.supporting_line).toContain("heavy metals");
    // The phrase appears once. Two heavy-metal chemicals collapse to
    // one category label.
    const matches = actions[0].supporting_line.match(/heavy metals/g);
    expect(matches?.length).toBe(1);
  });

  it("lists at most three category labels then suffixes 'and other contaminants'", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [
          makeEntry({
            contaminants: [
              "Lead", // heavy_metal
              "Trichloroethene", // vocs
              "Polychlorinated biphenyls", // pcbs_dioxins (no groundwater pathway → won't count for water test)
              "Benzo(a)pyrene", // pahs (no groundwater pathway → won't count)
              "PFOA", // pfas
              "DDT", // pesticides
              "Total petroleum hydrocarbons", // petroleum
            ],
          }),
        ],
      }),
    );
    // Only the contaminants with groundwater pathway and at least
    // moderate concern feed into the water-test action's phrase.
    // For this fixture that's heavy_metal (Lead), vocs (TCE), pfas
    // (PFOA), pesticides (DDT), petroleum (TPH) — five categories.
    // The phrase truncates to MAX_CATEGORY_LABELS_IN_LINE (3) plus
    // the "and other contaminants" tail.
    expect(actions[0]?.supporting_line).toContain("and other contaminants");
  });

  it("ignores unknown contaminant strings while still emitting actions based on the known ones", () => {
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        qualifyingSites: [
          makeEntry({
            contaminants: ["Lead", "Phlogiston-42", "Elementum mysticum"],
          }),
        ],
      }),
    );
    expect(ids(actions)).toEqual(["test-your-well"]);
  });
});

describe("computeRecommendedActions — ordering", () => {
  it("orders water-test before vapor-intrusion when both fire", () => {
    // The intended "by leverage" ordering: water test is the action
    // a homeowner can act on immediately (call a lab today), vapor
    // intrusion needs an environmental consultant which is a bigger
    // commitment. Water test leads.
    const actions = computeRecommendedActions(
      makeInput({
        waterSource: "well",
        basementPresent: true,
        qualifyingSites: [
          makeEntry({
            contaminants: ["Trichloroethene"], // groundwater + vapor_intrusion
            tier: 1,
          }),
        ],
      }),
    );
    expect(ids(actions)).toEqual([
      "test-your-well",
      "check-vapor-intrusion",
    ]);
  });
});
