import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HabitatFinding, HouseContext } from "@/lib/habitat/types";
import EpaSuperfundProximityModule, {
  buildOnboardingMessage,
} from "./index";
import type {
  PortfolioSummary,
  SiteEntry,
  SuperfundFindings,
} from "./types";

/**
 * Minimal HouseContext for tests. 604 Norton Dr, Kalamazoo MI per the
 * issue's test address. Coordinates are the ones the issue cites.
 */
function makeHouse(overrides: Partial<HouseContext> = {}): HouseContext {
  return {
    houseId: "test-house",
    addressLine1: "604 Norton Dr",
    city: "Kalamazoo",
    state: "MI",
    county: "Kalamazoo",
    postalCode: "49006",
    latitude: 42.265,
    longitude: -85.589,
    parcelId: null,
    // Default both #142 property-situation inputs to null so the
    // existing fixtures keep producing the same suppression behavior
    // they did before #142 landed (the Superfund label and #144
    // recommended-actions logic both treat null as "we don't know,
    // suppress rather than guess"). Tests that exercise the action
    // branches override these explicitly.
    waterSource: null,
    basementPresent: null,
    ...overrides,
  };
}

/**
 * Construct a single row from the EPA Envirofacts SEMS join. Defaults
 * mirror a "minimal real row" shape; overrides let each test fix the
 * relevant fields.
 */
function makeRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    site_id: "0100185",
    epa_id: "MID000000001",
    name: "EXAMPLE SITE",
    street_addr_txt: "123 EXAMPLE RD",
    supplemental_addr_txt: null,
    city_name: "KALAMAZOO",
    county_name: "KALAMAZOO",
    fk_ref_state_code: "MI",
    zip_code: "49006",
    primary_latitude_decimal_val: "42.27",
    primary_longitude_decimal_val: "-85.589",
    npl_status_code: "F",
    npl_status_name: "Final NPL",
    non_npl_status_code: null,
    non_npl_status_name: null,
    archived_ind: "N",
    archived_date: null,
    federal_facility_ind: "N",
    fips_code: "26077",
    fk_ref_region_code: "05",
    congressional_district_code: null,
    saa_agreement_site_ind: "N",
    ...overrides,
  };
}

/**
 * Stub global fetch with URL-aware routing:
 *   - data.epa.gov (Envirofacts REST) → JSON rows the EPA call expects
 *   - cumulis.epa.gov (Cumulis Contacts pages) → optional HTML map
 *     keyed by site_id, with an empty fallback that the parser turns
 *     into a null CIC
 *
 * Most tests only care about the Envirofacts response and let CIC
 * fall through to null. Tests that exercise the CIC enrichment pass
 * a `cumulisContactsHtml` map keyed by site_id.
 */
function stubFetchWithRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  options: { cumulisContactsHtml?: Record<string, string> } = {},
): void {
  const cumulisHtml = options.cumulisContactsHtml ?? {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cumulis.epa.gov")) {
        const idMatch = url.match(/[?&]id=([^&]+)/);
        const siteId = idMatch ? decodeURIComponent(idMatch[1]) : "";
        const html = cumulisHtml[siteId] ?? "";
        return {
          ok: true,
          status: 200,
          async text() {
            return html;
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return rows;
        },
      };
    }) as unknown as typeof fetch,
  );
}

// Unset both env vars the portfolio-summary AI call reads so tests
// never accidentally fire a real generateObject() call from a
// developer's seeded local env. The summary helper soft-fails to
// `text: null` when no model is configured; tests that exercise the
// AI-success path (none today — the call would be non-deterministic)
// should vi.mock the generator module instead.
const ORIGINAL_ENV = {
  SUPERFUND_SUMMARY_MODEL: process.env.SUPERFUND_SUMMARY_MODEL,
  BRIEFING_PRIMARY_MODEL: process.env.BRIEFING_PRIMARY_MODEL,
};

beforeEach(() => {
  delete process.env.SUPERFUND_SUMMARY_MODEL;
  delete process.env.BRIEFING_PRIMARY_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_ENV.SUPERFUND_SUMMARY_MODEL !== undefined) {
    process.env.SUPERFUND_SUMMARY_MODEL = ORIGINAL_ENV.SUPERFUND_SUMMARY_MODEL;
  }
  if (ORIGINAL_ENV.BRIEFING_PRIMARY_MODEL !== undefined) {
    process.env.BRIEFING_PRIMARY_MODEL = ORIGINAL_ENV.BRIEFING_PRIMARY_MODEL;
  }
});

describe("EpaSuperfundProximityModule metadata", () => {
  it("declares its key as 'epa_superfund_proximity'", () => {
    expect(EpaSuperfundProximityModule.key).toBe("epa_superfund_proximity");
  });

  it("declares cadence as 'yearly'", () => {
    expect(EpaSuperfundProximityModule.cadence).toBe("yearly");
  });

  it("has a non-empty description", () => {
    expect(EpaSuperfundProximityModule.description.length).toBeGreaterThan(0);
  });

  it("declares category as 'environmental'", () => {
    expect(EpaSuperfundProximityModule.category).toBe("environmental");
  });

  it("declares the iconImage path", () => {
    expect(EpaSuperfundProximityModule.iconImage).toBe(
      "/habitat_module_images/epa_superfund.jpg",
    );
  });
});

describe("EpaSuperfundProximityModule.isApplicable", () => {
  it("returns true for a fully-populated house", () => {
    expect(EpaSuperfundProximityModule.isApplicable(makeHouse())).toBe(true);
  });

  it("returns false when latitude is null", () => {
    expect(
      EpaSuperfundProximityModule.isApplicable(makeHouse({ latitude: null })),
    ).toBe(false);
  });

  it("returns false when longitude is null", () => {
    expect(
      EpaSuperfundProximityModule.isApplicable(makeHouse({ longitude: null })),
    ).toBe(false);
  });

  it("returns false when state is missing", () => {
    expect(
      EpaSuperfundProximityModule.isApplicable(makeHouse({ state: "" })),
    ).toBe(false);
  });

  it("returns false when state is not a 2-letter code", () => {
    expect(
      EpaSuperfundProximityModule.isApplicable(makeHouse({ state: "Michigan" })),
    ).toBe(false);
  });
});

describe("EpaSuperfundProximityModule.check — qualifying sites", () => {
  beforeEach(() => {
    // ~1.0 mi N of (42.265, -85.589): lat 42.2795, lng -85.589.
    // ~1.4 mi N: lat 42.2854, lng -85.589.
    // ~10 mi away (excluded by 5 mi radius): lat 42.45, lng -85.589.
    // Site with null coordinates (dropped).
    // Site with status N (shouldn't appear because URL filters F,P,A,D,
    //   but defensive — module narrowNplCode filters it again).
    stubFetchWithRows([
      makeRow({
        site_id: "MID980794473",
        epa_id: "MID980794473",
        name: "ALLIED PAPER, INC./PORTAGE CREEK/KALAMAZOO RIVER",
        street_addr_txt: "1314 KALAMAZOO RIVER",
        primary_latitude_decimal_val: "42.2795",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "POLYCHLORINATED BIPHENYLS",
      }),
      // Allied Paper has multiple contaminants; the join produces a second
      // row to test mergeContaminants.
      makeRow({
        site_id: "MID980794473",
        epa_id: "MID980794473",
        name: "ALLIED PAPER, INC./PORTAGE CREEK/KALAMAZOO RIVER",
        street_addr_txt: "1314 KALAMAZOO RIVER",
        primary_latitude_decimal_val: "42.2795",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
      makeRow({
        site_id: "MID075021883",
        epa_id: "MID075021883",
        name: "AUTO ION CHEMICALS, INC.",
        primary_latitude_decimal_val: "42.2854",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "TCE",
      }),
      makeRow({
        site_id: "MID000FAR",
        name: "FAR AWAY DUMP",
        primary_latitude_decimal_val: "42.45",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: null,
      }),
      makeRow({
        site_id: "MID000NULL",
        name: "NO COORDINATES SITE",
        primary_latitude_decimal_val: null,
        primary_longitude_decimal_val: null,
        npl_status_code: "F",
      }),
    ]);
  });

  it("returns a 'caution' finding when the closest site is a Tier 2 active NPL", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("caution");
  });

  it("title-cases site names in the finding", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (finding.findings as { sites: Array<{ site: { name_display: string } }> }).sites;
    expect(sites[0].site.name_display).toContain("Allied Paper");
    expect(sites[0].site.name_display).toContain("Inc."); // INC. → Inc.
  });

  it("sorts qualifying sites by label-desc, severity-desc, then distance-asc (issue #140)", async () => {
    // Both Tier 2 sites in this fixture carry the same label tier
    // (worth_knowing) and same severity (caution), so the sort falls
    // through to distance-asc — the closer Allied Paper still leads.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (
      finding.findings as { sites: Array<{ context: { distance_miles: number } }> }
    ).sites;
    expect(sites.length).toBe(2);
    expect(sites[0].context.distance_miles).toBeLessThanOrEqual(
      sites[1].context.distance_miles,
    );
  });

  it("populates total_npl_sites_in_state including the far-away and null-coord rows", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const f = finding.findings as {
      total_npl_sites_in_state: number;
      total_sites_with_coordinates: number;
      total_qualifying_sites: number;
    };
    expect(f.total_npl_sites_in_state).toBe(4);
    expect(f.total_sites_with_coordinates).toBe(3);
    expect(f.total_qualifying_sites).toBe(2);
  });

  it("merges contaminants across joined rows", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (
      finding.findings as { sites: Array<{ site: { contaminants: string[]; sems_site_id: string } }> }
    ).sites;
    const allied = sites.find((s) => s.site.sems_site_id === "MID980794473");
    expect(allied?.site.contaminants).toContain("Polychlorinated biphenyls");
    expect(allied?.site.contaminants).toContain("Lead");
  });

  it("populates the per-site context with distance, bearing, tier, and severity", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const closest = (
      finding.findings as { sites: Array<{ context: Record<string, unknown> }> }
    ).sites[0];
    expect(closest.context.distance_miles).toBeGreaterThan(0.5);
    expect(closest.context.distance_miles).toBeLessThan(2);
    expect(closest.context.bearing).toBe("N");
    expect(closest.context.tier).toBe(2);
    expect(closest.context.severity).toBe("caution");
  });

  it("passes archived_date and epa_region_code through from the EPA row onto the persisted site shape", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "MID000A",
        epa_id: "MID000A",
        name: "ACTIVE WITH REGION",
        primary_latitude_decimal_val: "42.2795",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        archived_ind: "N",
        archived_date: null,
        fk_ref_region_code: "05",
      }),
      makeRow({
        site_id: "MID000B",
        epa_id: "MID000B",
        name: "ARCHIVED WITH REGION",
        primary_latitude_decimal_val: "42.2796",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        archived_ind: "Y",
        archived_date: "2024-01-15",
        fk_ref_region_code: "01",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (
      finding.findings as {
        sites: Array<{
          site: {
            sems_site_id: string;
            archived: boolean;
            archived_date: string | null;
            epa_region_code: string | null;
          };
        }>;
      }
    ).sites;
    const active = sites.find((s) => s.site.sems_site_id === "MID000A");
    const archived = sites.find((s) => s.site.sems_site_id === "MID000B");
    expect(active?.site.archived).toBe(false);
    expect(active?.site.archived_date).toBeNull();
    expect(active?.site.epa_region_code).toBe("05");
    expect(archived?.site.archived).toBe(true);
    expect(archived?.site.archived_date).toBe("2024-01-15");
    expect(archived?.site.epa_region_code).toBe("01");
  });

  it("writes null passthrough when EPA omits archived_date or fk_ref_region_code", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "MID000C",
        epa_id: "MID000C",
        name: "MISSING FIELDS",
        primary_latitude_decimal_val: "42.2795",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        archived_ind: "N",
        archived_date: null,
        fk_ref_region_code: null,
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const site = (
      finding.findings as {
        sites: Array<{
          site: { archived_date: string | null; epa_region_code: string | null };
        }>;
      }
    ).sites[0].site;
    expect(site.archived_date).toBeNull();
    expect(site.epa_region_code).toBeNull();
  });

  it("emits an 11-step activity log when at least one qualifying site has multi-location structure", async () => {
    // Multi-location hit path post-#144:
    //   fetch, compute(coords), compute(distance), compute(caveat),
    //   rule, compute(cic), compute(labels), compute(summary),
    //   compute(recommended-actions), decide, finding = 11 steps.
    // Issue #143 added the cic step; issue #144 added the
    // recommended-actions step.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    expect(log.steps.length).toBe(11);
    expect(log.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "compute",
      "compute",
      "rule",
      "compute",
      "compute",
      "compute",
      "compute",
      "decide",
      "finding",
    ]);
  });

  it("annotates qualifying multi-location sites with a precision_note", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (
      finding.findings as {
        sites: Array<{
          site: { sems_site_id: string };
          context: { precision_note?: string };
        }>;
      }
    ).sites;
    const allied = sites.find((s) => s.site.sems_site_id === "MID980794473");
    const autoIon = sites.find((s) => s.site.sems_site_id === "MID075021883");
    expect(allied?.context.precision_note).toMatch(/multi-location/i);
    expect(autoIon?.context.precision_note).toBeUndefined();
  });

  it("names the flagged sites in the precision-caveat step's detail", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    // The caveat step is the fourth step (index 3) when emitted.
    const caveatStep = log.steps[3];
    expect(caveatStep.kind).toBe("compute");
    expect(caveatStep.detail).toContain("Allied Paper");
    expect(caveatStep.detail).toContain("multi-location precision caveat");
  });

  it("cites EPA Envirofacts on the fetch step", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const fetchStep = finding.activityLog!.steps.find((s) => s.kind === "fetch");
    expect(fetchStep?.source?.url).toContain("epa.gov");
    expect(fetchStep?.detail).toContain("data.epa.gov/efservice/");
    expect(fetchStep?.detail).toContain("MI");
  });

  it("cites the Hearth classification page on the decide step", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const decideStep = finding.activityLog!.steps.find((s) => s.kind === "decide");
    expect(decideStep?.source?.url).toBe("/how-it-works#superfund");
    expect(decideStep?.detail).toContain("severity('caution')");
  });

  it("cites the Hearth classification page on the rule step (not /superfund)", async () => {
    // The tier model is Hearth's, not EPA's — the rule step should cite
    // our own classification page, not EPA's Superfund landing page,
    // which would imply EPA publishes a "community-impact rings"
    // standard that doesn't exist.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const ruleStep = finding.activityLog!.steps.find((s) => s.kind === "rule");
    expect(ruleStep?.source?.url).toBe("/how-it-works#superfund");
    expect(ruleStep?.source?.label).toMatch(
      /community-involvement practice/i,
    );
  });

  it("summary copy names every qualifying site when there are multiple", async () => {
    // The 2-site fixture above produces both Allied Paper and Auto Ion.
    // Earlier copy named only the closest site, which read as
    // misleading once the modal surfaced every site as a drillable
    // card. The summary now leads with the total count and lists all
    // sites by name; per-site distance / direction / status live on
    // each card and inside the detail pane.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.summary).toMatch(/We detected 2 EPA Superfund sites/);
    expect(finding.summary).toContain("Allied Paper");
    expect(finding.summary).toContain("Auto Ion Chemicals");
    expect(finding.summary).toMatch(/Allied Paper.*\band\s+Auto Ion Chemicals/);
  });

  it("summary copy keeps the narrative closest-site phrasing when there's only one qualifying site", async () => {
    // Override the beforeEach 2-site stub with a single qualifying site.
    stubFetchWithRows([
      makeRow({
        site_id: "MID000ONE",
        epa_id: "MID000ONE",
        name: "LONE PINE LANDFILL",
        primary_latitude_decimal_val: "42.2854",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "TCE",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.summary).toContain("Lone Pine Landfill");
    expect(finding.summary).toContain("mile");
    expect(finding.summary).toContain("north");
    expect(finding.summary).not.toMatch(/We detected/);
  });

  it("does not ship a per-site EPA profile pill in the module action shelf", async () => {
    // Per-site EPA profile links are surfaced inside the modal's
    // per-site detail pane (lib/habitat/modules/epa-superfund-proximity/
    // components/site-detail.tsx). Having one in the module-level
    // action shelf read as misleading once multiple sites were rendered
    // as drillable cards — the pill pointed at only the closest one.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const actions = finding.actions ?? [];
    expect(
      actions.find((a) => a.label === "View EPA site profile"),
    ).toBeUndefined();
  });

  it("ships the module-level Superfund overview link in the action shelf", async () => {
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const actions = finding.actions ?? [];
    const overview = actions.find((a) => a.label === "EPA Superfund overview");
    expect(overview?.kind).toBe("link");
    expect(overview?.url).toBe("https://www.epa.gov/superfund");
  });
});

describe("EpaSuperfundProximityModule.check — no qualifying sites", () => {
  it("returns a 'favorable' finding when EPA returns no sites in the state", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
    expect(finding.headline).toBe(
      "No active EPA Superfund sites near your home",
    );
    const sites = (finding.findings as { sites: unknown[] }).sites;
    expect(sites).toEqual([]);
  });

  it("returns a 'favorable' finding when every site is beyond 5 miles", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "FARFAR",
        primary_latitude_decimal_val: "42.50", // ~16 mi N
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
  });

  it("emits a 5-step activity log on the no-hits path (no extra decide-then-finding split)", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    expect(log.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "compute",
      "rule",
      "decide",
      "finding",
    ]);
  });

  it("ships a 'Learn about Superfund' action", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const actions = finding.actions ?? [];
    expect(actions.length).toBe(1);
    expect(actions[0].label).toBe("Learn about Superfund");
  });
});

describe("EpaSuperfundProximityModule.check — precision caveat", () => {
  it("omits the precision-caveat step when no qualifying site has multi-location structure", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "SINGLE_LOC",
        name: "SINGLE LOCATION SITE",
        primary_latitude_decimal_val: "42.2795",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    // Single-location hit path post-#144: fetch, compute(coords),
    // compute(distance), rule, compute(cic), compute(labels),
    // compute(summary), compute(recommended-actions), decide,
    // finding = 10 steps.
    expect(log.steps.length).toBe(10);
    expect(log.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "compute",
      "rule",
      "compute",
      "compute",
      "compute",
      "compute",
      "decide",
      "finding",
    ]);
    const sites = (
      finding.findings as { sites: Array<{ context: { precision_note?: string } }> }
    ).sites;
    expect(sites[0].context.precision_note).toBeUndefined();
  });
});

describe("EpaSuperfundProximityModule.check — tier filtering", () => {
  it("excludes status 'A' (part-of-NPL) sites in the Tier 2 band", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "A_TIER2",
        name: "PART OF NPL SITE",
        primary_latitude_decimal_val: "42.2795", // ~1.0 mi N
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "A",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
  });

  it("excludes status 'D' (deleted) sites at Tier 3 distance", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "D_TIER3",
        name: "OLD CLEANED-UP DUMP",
        primary_latitude_decimal_val: "42.30", // ~2.5 mi N
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "D",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("favorable");
  });

  it("includes status 'A' (part-of-NPL) sites inside the Tier 1 band as 'caution'", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "A_TIER1",
        name: "PART OF LARGER SITE",
        primary_latitude_decimal_val: "42.267", // ~0.15 mi N
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "A",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    expect(finding.severity).toBe("caution");
    const sites = (
      finding.findings as { sites: Array<{ context: { tier: number; severity: string } }> }
    ).sites;
    expect(sites[0].context.tier).toBe(1);
    expect(sites[0].context.severity).toBe("caution");
  });
});

describe("EpaSuperfundProximityModule.check — error handling", () => {
  it("throws when EPA returns a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        async json() {
          return null;
        },
      })) as unknown as typeof fetch,
    );
    await expect(
      EpaSuperfundProximityModule.check(makeHouse()),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws when EPA returns a non-array body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { something: "else" };
        },
      })) as unknown as typeof fetch,
    );
    await expect(
      EpaSuperfundProximityModule.check(makeHouse()),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when isApplicable would have returned false (missing lat/lng)", async () => {
    await expect(
      EpaSuperfundProximityModule.check(makeHouse({ latitude: null })),
    ).rejects.toThrow(/coordinates/);
  });
});

/**
 * Helpers for buildOnboardingMessage tests — construct a finding payload
 * shaped like the one check() persists.
 */
function makeFinding(overrides: Partial<HabitatFinding> = {}): HabitatFinding {
  return {
    severity: "favorable",
    headline: "test",
    summary: "test",
    findings: {
      search_state: "MI",
      total_qualifying_sites: 0,
      sites: [],
    },
    ...overrides,
  };
}

describe("EpaSuperfundProximityModule.check — issue #140 label + portfolio summary", () => {
  it("populates a per-site label inside each site's context", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_F_HIGH",
        name: "TIER1 SITE WITH LEAD",
        primary_latitude_decimal_val: "42.267", // ~0.15 mi N → Tier 1
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (finding.findings as SuperfundFindings).sites;
    expect(sites[0].context.label).toBe("worth_acting_on");
  });

  it("computes a portfolio_label as the max across per-site labels", async () => {
    // Tier 1 + Final + Lead → worth_acting_on
    // Tier 2 + Final + TCE → worth_knowing
    // Portfolio rolls up to worth_acting_on.
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_F_HIGH",
        name: "CLOSE LEAD SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
      makeRow({
        site_id: "TIER2_F",
        name: "FARTHER TCE SITE",
        primary_latitude_decimal_val: "42.285",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "TRICHLOROETHYLENE",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const findings = finding.findings as SuperfundFindings;
    expect(findings.portfolio_label).toBe("worth_acting_on");
  });

  it("sorts qualifying sites by label-desc so worth_acting_on leads even when it isn't the closest", async () => {
    // Use a closer worth_knowing site and a farther worth_acting_on
    // site to prove label-desc beats distance-asc as the lead sort key.
    stubFetchWithRows([
      makeRow({
        site_id: "CLOSE_KNOWING",
        name: "CLOSE PART OF NPL",
        primary_latitude_decimal_val: "42.267", // ~0.15 mi N → Tier 1
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "A", // Tier 1 + A → worth_knowing
      }),
      makeRow({
        site_id: "FAR_ACTING",
        name: "FAR ACTIVE WITH LEAD",
        primary_latitude_decimal_val: "42.270", // ~0.35 mi N → Tier 1
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F", // Tier 1 + F + high → worth_acting_on
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (finding.findings as SuperfundFindings).sites;
    expect(sites[0].site.sems_site_id).toBe("FAR_ACTING");
    expect(sites[0].context.label).toBe("worth_acting_on");
    expect(sites[1].site.sems_site_id).toBe("CLOSE_KNOWING");
    expect(sites[1].context.label).toBe("worth_knowing");
  });

  it("suppresses portfolio_label (null) when every per-site label is suppressed", async () => {
    // Tier 3 site with no contaminants → per-site label null → portfolio null.
    stubFetchWithRows([
      makeRow({
        site_id: "TIER3_EMPTY",
        name: "DISTANT EMPTY SITE",
        primary_latitude_decimal_val: "42.30", // ~2.5 mi N → Tier 3
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: null,
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const findings = finding.findings as SuperfundFindings;
    expect(findings.sites[0].context.label).toBeNull();
    expect(findings.portfolio_label).toBeNull();
  });

  it("persists a portfolio_summary with text=null and an env-unset error_reason when the AI call is not configured", async () => {
    // beforeEach explicitly deletes both env vars so the summary call
    // gracefully skips. The summary shape still lands on the finding —
    // null text + populated error_reason — so the modal layer can
    // render the banner or suppress consistently.
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_F_HIGH",
        name: "ANY HIT",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const findings = finding.findings as SuperfundFindings;
    const summary = findings.portfolio_summary as PortfolioSummary;
    expect(summary).toBeDefined();
    expect(summary.text).toBeNull();
    expect(summary.model).toBeNull();
    expect(summary.generated_at).toBeNull();
    expect(summary.error_reason).toMatch(/SUPERFUND_SUMMARY_MODEL/);
  });

  it("does not generate a portfolio_summary on the no-hits path (it would have nothing to summarize)", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const findings = finding.findings as SuperfundFindings;
    expect(findings.portfolio_label).toBeUndefined();
    expect(findings.portfolio_summary).toBeUndefined();
  });

  it("appends the label-rollup compute step's source citation to /how-it-works#superfund", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "ANY",
        name: "ANY SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    // Post-#143: the order after the rule step is
    //   ruleIdx + 1 → compute(cic enrichment)
    //   ruleIdx + 2 → compute(label rollup)
    //   ruleIdx + 3 → compute(summary)
    const log = finding.activityLog!;
    const ruleIdx = log.steps.findIndex((s) => s.kind === "rule");
    const labelStep = log.steps[ruleIdx + 2];
    expect(labelStep.kind).toBe("compute");
    expect(labelStep.narration).toMatch(/labeled each qualifying site/i);
    expect(labelStep.source?.url).toBe("/how-it-works#superfund");
  });

  it("labels the summary compute step 'skipped' when no AI model is configured", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "ANY",
        name: "ANY SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    const ruleIdx = log.steps.findIndex((s) => s.kind === "rule");
    // Summary is at ruleIdx + 3 post-#143 (cic at +1, labels at +2).
    const summaryStep = log.steps[ruleIdx + 3];
    expect(summaryStep.kind).toBe("compute");
    expect(summaryStep.result_summary).toBe("summary: skipped");
    expect(summaryStep.detail).toContain("error_reason");
  });
});

describe("EpaSuperfundProximityModule.check — issue #143 CIC enrichment + documents URL", () => {
  it("populates documents_url on every qualifying site (deterministic, no scraping)", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "0503011",
        epa_id: "MID000503011",
        name: "VERONA WELL FIELD",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const sites = (finding.findings as SuperfundFindings).sites;
    expect(sites[0].site.documents_url).toBe(
      "https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.docdata&id=0503011",
    );
  });

  it("populates community_involvement_coordinator from the Cumulis Contacts page when EPA publishes one", async () => {
    const html = `
      <b>Community Involvement Coordinator:</b><br>
      <p>
        Kirstin&nbsp;Safakas
        <br><a href="mailto:Safakas.Kirstin@epa.gov">Safakas.Kirstin@epa.gov</a>
        <br>(312) 886-6015
      </p>
    `;
    stubFetchWithRows(
      [
        makeRow({
          site_id: "0503011",
          epa_id: "MID000503011",
          name: "VERONA WELL FIELD",
          primary_latitude_decimal_val: "42.267",
          primary_longitude_decimal_val: "-85.589",
          npl_status_code: "F",
        }),
      ],
      { cumulisContactsHtml: { "0503011": html } },
    );
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const cic = (finding.findings as SuperfundFindings).sites[0].site
      .community_involvement_coordinator;
    expect(cic).not.toBeNull();
    expect(cic?.name).toBe("Kirstin Safakas");
    expect(cic?.email).toBe("Safakas.Kirstin@epa.gov");
    expect(cic?.phone).toBe("(312) 886-6015");
  });

  it("sets community_involvement_coordinator = null when the Contacts page has no CIC block (Peerless Plating case)", async () => {
    // Page only lists a Remedial Project Manager — RPM is the
    // technical contact, not the homeowner-facing one. Parser
    // returns null and the field on the site entry is null.
    stubFetchWithRows([
      makeRow({
        site_id: "0502373",
        epa_id: "MID000502373",
        name: "PEERLESS PLATING CO",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const site = (finding.findings as SuperfundFindings).sites[0].site;
    // Field is explicitly null (lookup attempted, no CIC found) — not
    // undefined (legacy row, lookup never ran).
    expect(site.community_involvement_coordinator).toBeNull();
  });

  it("logs the CIC enrichment compute step with a hits-out-of-total result summary", async () => {
    const html = `
      <b>Community Involvement Coordinator:</b><br>
      <p>
        Diane&nbsp;Russell
        <br><a href="mailto:russell.diane@epa.gov">russell.diane@epa.gov</a>
      </p>
    `;
    stubFetchWithRows(
      [
        makeRow({
          site_id: "0503011",
          epa_id: "MID000503011",
          name: "WITH CIC",
          primary_latitude_decimal_val: "42.267",
          primary_longitude_decimal_val: "-85.589",
          npl_status_code: "F",
        }),
        makeRow({
          site_id: "0502373",
          epa_id: "MID000502373",
          name: "WITHOUT CIC",
          primary_latitude_decimal_val: "42.268",
          primary_longitude_decimal_val: "-85.589",
          npl_status_code: "F",
        }),
      ],
      { cumulisContactsHtml: { "0503011": html } },
    );
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    const ruleIdx = log.steps.findIndex((s) => s.kind === "rule");
    const cicStep = log.steps[ruleIdx + 1];
    expect(cicStep.kind).toBe("compute");
    expect(cicStep.narration).toMatch(/Community Involvement Coordinator/i);
    expect(cicStep.result_summary).toBe("1 of 2 sites have a CIC");
  });

  it("does not include the CIC enrichment step on the no-hits path", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    // No qualifying sites = nothing to enrich. The no-hits log shape
    // stays unchanged (6 steps).
    expect(log.steps.length).toBe(6);
    const cicStep = log.steps.find((s) =>
      s.narration.includes("Community Involvement Coordinator"),
    );
    expect(cicStep).toBeUndefined();
  });

  it("uses the canonical SiteProfiles URL for the per-site profile_url (issue #143 fix to the legacy URL bug)", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "0503011",
        epa_id: "MID000503011",
        name: "VERONA WELL FIELD",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const site = (finding.findings as SuperfundFindings).sites[0].site;
    // The legacy cursites/csitinfo.cfm URL with the leading zero
    // stripped returned a "No site is found" error page in production.
    // The fix uses the canonical SiteProfiles path AND preserves the
    // zero-padded site_id.
    expect(site.profile_url).toBe(
      "https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.scs&id=0503011",
    );
  });
});

describe("EpaSuperfundProximityModule.check — issue #144 recommended actions", () => {
  it("persists recommended_actions on the findings jsonb when actions apply", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_LEAD",
        epa_id: "MID000TIER1",
        name: "TIER1 LEAD SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(
      makeHouse({ waterSource: "well" }),
    );
    const findings = finding.findings as SuperfundFindings;
    expect(findings.recommended_actions).toBeDefined();
    expect(findings.recommended_actions?.map((a) => a.id)).toEqual([
      "test-your-well",
    ]);
  });

  it("persists an empty recommended_actions array when no actions apply (well water but only airborne contaminants)", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_ASBESTOS",
        epa_id: "MID000ASB",
        name: "ASBESTOS SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "ASBESTOS",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(
      makeHouse({ waterSource: "well" }),
    );
    const findings = finding.findings as SuperfundFindings;
    expect(findings.recommended_actions).toEqual([]);
  });

  it("omits recommended_actions on the no-hits path (nothing to recommend against)", async () => {
    stubFetchWithRows([]);
    const finding = await EpaSuperfundProximityModule.check(
      makeHouse({ waterSource: "well", basementPresent: true }),
    );
    const findings = finding.findings as SuperfundFindings;
    expect(findings.recommended_actions).toBeUndefined();
  });

  it("includes vapor-intrusion action for basement=true + Tier 1 VOC site (water test also fires for the same VOC's groundwater pathway)", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_TCE",
        epa_id: "MID000TCE",
        name: "TCE SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "TRICHLOROETHYLENE",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(
      makeHouse({ waterSource: "well", basementPresent: true }),
    );
    const findings = finding.findings as SuperfundFindings;
    expect(findings.recommended_actions?.map((a) => a.id)).toEqual([
      "test-your-well",
      "check-vapor-intrusion",
    ]);
  });

  it("logs the recommended-actions compute step after the summary step with action ids in the detail field", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_LEAD",
        epa_id: "MID000TIER1",
        name: "TIER1 LEAD SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(
      makeHouse({ waterSource: "well" }),
    );
    const log = finding.activityLog!;
    const ruleIdx = log.steps.findIndex((s) => s.kind === "rule");
    // recommended-actions is at ruleIdx + 4 post-#144:
    //   +1 cic, +2 labels, +3 summary, +4 recommended-actions
    const actionsStep = log.steps[ruleIdx + 4];
    expect(actionsStep.kind).toBe("compute");
    expect(actionsStep.narration).toMatch(/recommended actions/i);
    expect(actionsStep.result_summary).toMatch(/1 recommended action/);
    expect(actionsStep.detail).toContain("test-your-well");
  });

  it("logs the recommended-actions step with 'no actions emitted' when the user's situation produces none", async () => {
    stubFetchWithRows([
      makeRow({
        site_id: "TIER1_LEAD",
        epa_id: "MID000TIER1",
        name: "TIER1 LEAD SITE",
        primary_latitude_decimal_val: "42.267",
        primary_longitude_decimal_val: "-85.589",
        npl_status_code: "F",
        preferred_contaminant_name: "LEAD",
      }),
    ]);
    const finding = await EpaSuperfundProximityModule.check(
      // Water source unknown → no water-test action; no basement → no
      // vapor intrusion. Lead has groundwater pathway but we can't
      // responsibly recommend the well or municipal variant without
      // knowing the water source.
      makeHouse({ waterSource: "unknown", basementPresent: false }),
    );
    const log = finding.activityLog!;
    const actionsStep = log.steps.find(
      (s) =>
        s.kind === "compute" && s.narration.includes("recommended actions"),
    );
    expect(actionsStep?.result_summary).toBe("0 recommended actions");
    expect(actionsStep?.detail).toContain("no actions emitted");
  });
});

/**
 * The two module slots introduced for issue #140 — getFindingLabel and
 * getOverviewBanner. Both read the persisted finding shape, so we
 * exercise them with synthetic row payloads rather than re-running
 * check() (we already cover the persistence path above).
 */
describe("EpaSuperfundProximityModule module slots (issue #140)", () => {
  function makeRow(findings: Partial<SuperfundFindings>) {
    return {
      house_id: "h",
      module_key: "epa_superfund_proximity",
      status: "completed",
      severity: "caution",
      headline: "h",
      summary: "s",
      findings: {
        search_radius_miles: 5,
        search_state: "MI",
        source_dataset: "EPA Envirofacts SEMS",
        source_dataset_note: "",
        total_npl_sites_in_state: 0,
        total_sites_with_coordinates: 0,
        total_qualifying_sites: 0,
        sites: [] as SiteEntry[],
        ...findings,
      },
      source_url: null,
      actions: [],
      activity_log: null,
      checked_at: null,
      category: "environmental",
      next_check_due_at: null,
      created_at: "",
      updated_at: "",
      severity_weight: 4,
    };
  }

  describe("getFindingLabel", () => {
    it("returns the LABEL_WORD + LABEL_COLOR for a populated portfolio_label", () => {
      const result = EpaSuperfundProximityModule.getFindingLabel!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ portfolio_label: "worth_acting_on" }) as any,
      );
      expect(result?.word).toBe("Worth acting on");
      expect(result?.color).toMatch(/^var\(--/);
    });

    it("returns null when portfolio_label is explicitly null (suppressed)", () => {
      const result = EpaSuperfundProximityModule.getFindingLabel!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ portfolio_label: null }) as any,
      );
      expect(result).toBeNull();
    });

    it("returns undefined when the row predates #140 (no portfolio_label field at all) — modal falls back to severity word", () => {
      // Distinct from the explicit-null suppression case above. Legacy
      // rows return undefined so the modal renders the default severity
      // word instead of suppressing the eyebrow entirely. They'll
      // backfill on the next yearly cadence and start returning
      // populated labels.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = makeRow({}) as any;
      const result = EpaSuperfundProximityModule.getFindingLabel!(row);
      expect(result).toBeUndefined();
    });
  });

  describe("getOverviewBanner", () => {
    it("returns the summary text when present", () => {
      const result = EpaSuperfundProximityModule.getOverviewBanner!(
        makeRow({
          portfolio_summary: {
            text: "Five sites are nearby. Two are active cleanups.",
            model: "openai/gpt-5-mini",
            generated_at: "2026-05-23T00:00:00Z",
            error_reason: null,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(result?.text).toMatch(/Five sites are nearby/);
    });

    it("returns null when text is null (AI failed or env unset)", () => {
      const result = EpaSuperfundProximityModule.getOverviewBanner!(
        makeRow({
          portfolio_summary: {
            text: null,
            model: null,
            generated_at: null,
            error_reason: "env unset",
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(result).toBeNull();
    });

    it("returns null when the row predates #140", () => {
      const result = EpaSuperfundProximityModule.getOverviewBanner!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({}) as any,
      );
      expect(result).toBeNull();
    });
  });

  describe("getRecommendedActions (issue #144)", () => {
    it("returns the persisted recommended_actions verbatim", () => {
      const result = EpaSuperfundProximityModule.getRecommendedActions!(
        makeRow({
          recommended_actions: [
            {
              id: "test-your-well",
              icon: "droplet",
              headline: "Test your well water",
              supporting_line: "Lead has been documented at nearby sites.",
              link: {
                label: "Find a state-certified lab",
                url: "https://example.invalid/labs",
              },
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("test-your-well");
      expect(result[0].link?.url).toBe("https://example.invalid/labs");
    });

    it("returns [] when recommended_actions is explicitly empty (no actions applied for the user's situation)", () => {
      const result = EpaSuperfundProximityModule.getRecommendedActions!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ recommended_actions: [] }) as any,
      );
      expect(result).toEqual([]);
    });

    it("returns [] when the row predates #144 (recommended_actions field absent)", () => {
      const result = EpaSuperfundProximityModule.getRecommendedActions!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({}) as any,
      );
      expect(result).toEqual([]);
    });
  });

  describe("getOverviewCards — eyebrow restructure (issue #140)", () => {
    function siteWithLabel(
      label: "worth_acting_on" | "worth_knowing" | "informational" | null,
    ): SiteEntry {
      return {
        site: {
          epa_id: "X",
          sems_site_id: "X",
          name_display: "Test Site",
          name_original: "TEST SITE",
          address: {
            street: "1 Main St",
            city: "Kalamazoo",
            county: "Kalamazoo",
            state: "MI",
            zip: "49006",
          },
          npl_status: { code: "F", label: "Final NPL" },
          contaminants: [],
          federal_facility: false,
          archived: false,
          archived_date: null,
          epa_region_code: "05",
          profile_url: "https://example.invalid/profile",
          // Required since #143; this synthetic fixture builds the
          // shape by hand rather than going through buildSiteEntry.
          documents_url: "https://example.invalid/docs",
        },
        context: {
          distance_miles: 1.2,
          bearing: "N",
          tier: 2,
          severity: "caution",
          label,
        },
      };
    }

    it("leads the eyebrow with the label word when the per-site label is populated", () => {
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ sites: [siteWithLabel("worth_knowing")] }) as any,
      );
      expect(cards[0].eyebrow.startsWith("Worth knowing · ")).toBe(true);
      expect(cards[0].eyebrow).toContain("1.2 mi N");
      expect(cards[0].eyebrow).toContain("Tier 2");
    });

    it("falls back to the legacy Tier-led eyebrow when the per-site label is null (suppressed)", () => {
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ sites: [siteWithLabel(null)] }) as any,
      );
      expect(cards[0].eyebrow.startsWith("Tier 2 · ")).toBe(true);
    });
  });

  describe("getOverviewCards — subheading (issue #145)", () => {
    /** Variant of the synthetic fixture that lets the test set the
     *  contaminants array directly so we can exercise the subheading
     *  population without spinning up the full check() pipeline. */
    function siteWithContaminants(contaminants: string[]): SiteEntry {
      return {
        site: {
          epa_id: "X",
          sems_site_id: "X",
          name_display: "Test Site",
          name_original: "TEST SITE",
          address: {
            street: "1 Main St",
            city: "Kalamazoo",
            county: "Kalamazoo",
            state: "MI",
            zip: "49006",
          },
          npl_status: { code: "F", label: "Final NPL" },
          contaminants,
          federal_facility: false,
          archived: false,
          archived_date: null,
          epa_region_code: "05",
          profile_url: "https://example.invalid/profile",
          documents_url: "https://example.invalid/docs",
        },
        context: {
          distance_miles: 1.2,
          bearing: "N",
          tier: 2,
          severity: "caution",
          label: "worth_knowing",
        },
      };
    }

    it("populates a sentence-case category subheading from the site's contaminants", () => {
      // Lead + Arsenic resolve to heavy_metal; TCE resolves to vocs.
      // Expected: "Volatile organic compounds and heavy metals"
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        makeRow({
          sites: [
            siteWithContaminants(["Lead", "Arsenic", "Trichloroethene"]),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(cards[0].subheading).toBe(
        "Volatile organic compounds and heavy metals",
      );
    });

    it("suppresses the subheading entirely when EPA hasn't published any contaminants (Georgia-Pacific case)", () => {
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ sites: [siteWithContaminants([])] }) as any,
      );
      expect(cards[0].subheading).toBeUndefined();
    });

    it("suppresses the subheading when every contaminant string is unknown to the canonical table", () => {
      // The site has contaminants on paper but none resolve via the
      // alias map — so we have no categories to summarize, same
      // outcome as the empty-array case.
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        makeRow({
          sites: [
            siteWithContaminants(["Phlogiston-42", "Elementum mysticum"]),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(cards[0].subheading).toBeUndefined();
    });

    it("renders the subheading sentence-case (first letter capitalized) for inline-form categories", () => {
      // Lead alone → "heavy metals" inline → "Heavy metals" subheading.
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ sites: [siteWithContaminants(["Lead"])] }) as any,
      );
      expect(cards[0].subheading).toBe("Heavy metals");
    });

    it("preserves already-capitalized labels (PFAS, PCBs) at the start of the subheading", () => {
      // PFOA resolves to pfas → "PFAS" inline → capitalizeCategoryPhrase
      // is a no-op since it's already capitalized.
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeRow({ sites: [siteWithContaminants(["PFOA"])] }) as any,
      );
      expect(cards[0].subheading).toBe("PFAS");
    });

    it("truncates the subheading at three categories with 'and other contaminants' suffix", () => {
      const cards = EpaSuperfundProximityModule.getOverviewCards!(
        makeRow({
          sites: [
            siteWithContaminants([
              "Trichloroethene", // vocs
              "Lead", // heavy_metal
              "Polychlorinated biphenyls", // pcbs_dioxins
              "Benzo(a)pyrene", // pahs (would be 4th, gets dropped)
              "PFOA", // pfas (5th, also dropped)
            ]),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
      expect(cards[0].subheading).toBe(
        "Volatile organic compounds, heavy metals, and PCBs and dioxins, and other contaminants",
      );
    });
  });
});

describe("buildOnboardingMessage", () => {
  it("opens with 'good news' on the zero-hits case", () => {
    const message = buildOnboardingMessage(makeFinding());
    expect(message).toMatch(/good news/i);
    expect(message).toMatch(/no active superfund/i);
  });

  it("names the closest site, distance, and bearing on a single-hit finding", () => {
    const finding = makeFinding({
      findings: {
        search_state: "MI",
        total_qualifying_sites: 1,
        sites: [
          {
            site: { name_display: "Allied Paper Inc." },
            context: { distance_miles: 1.0, bearing: "N" },
          },
        ],
      },
    });
    const message = buildOnboardingMessage(finding);
    expect(message).toContain("Allied Paper Inc.");
    expect(message).toContain("1.0 mi");
    expect(message).toContain("N");
  });

  it("pluralizes on a multi-hit finding", () => {
    const finding = makeFinding({
      findings: {
        search_state: "MI",
        total_qualifying_sites: 3,
        sites: [
          {
            site: { name_display: "Allied Paper Inc." },
            context: { distance_miles: 1.0, bearing: "N" },
          },
          {
            site: { name_display: "Auto Ion Chemicals" },
            context: { distance_miles: 1.4, bearing: "N" },
          },
          {
            site: { name_display: "Cork Street Landfill" },
            context: { distance_miles: 1.8, bearing: "NE" },
          },
        ],
      },
    });
    const message = buildOnboardingMessage(finding);
    expect(message).toMatch(/3 superfund sites/i);
    expect(message).toContain("Allied Paper Inc.");
  });
});
