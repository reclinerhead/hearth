import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HabitatFinding, HouseContext } from "@/lib/habitat/types";
import EpaSuperfundProximityModule, {
  buildOnboardingMessage,
} from "./index";

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
 * Stub global fetch with a function that always returns the given rows.
 * The module's fetchNplSitesInState reads only Response.ok and
 * Response.json(), so we mock just those two.
 */
function stubFetchWithRows(rows: ReadonlyArray<Record<string, unknown>>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return rows;
      },
    })) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("sorts qualifying sites severity-desc then distance-asc", async () => {
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

  it("emits a 7-step activity log when at least one qualifying site has multi-location structure", async () => {
    // Allied Paper's name contains "/" — Allied Paper, Inc./Portage
    // Creek/Kalamazoo River. That trips the precision-caveat compute
    // step inserted between distance and tier-filter.
    const finding = await EpaSuperfundProximityModule.check(makeHouse());
    const log = finding.activityLog!;
    expect(log.steps.length).toBe(7);
    expect(log.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "compute",
      "compute",
      "rule",
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
    expect(log.steps.length).toBe(6);
    expect(log.steps.map((s) => s.kind)).toEqual([
      "fetch",
      "compute",
      "compute",
      "rule",
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
