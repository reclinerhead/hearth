/**
 * Integration tests for the WQA module's check() entry point.
 *
 * Mocks `global.fetch` based on URL substring so the full pipeline runs
 * end-to-end with deterministic EPA responses. The Supabase cache
 * stores soft-fail when env vars are absent (which they are in this
 * test runner), so every "lookup" returns miss and every "upsert" is
 * a no-op — every fetch goes through the mocked fetch.
 *
 * Coverage target: the WQA-2-followup nearest-polygon fallback. The
 * pure-logic tests in branch.test.ts and payload.test.ts cover the
 * mapping rules; this file verifies the orchestration in check() —
 * which fetch URLs get hit, in what order, and that the resulting
 * finding has the right shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WqaModule from "./index";
import type { HouseContext } from "@/lib/habitat/types";
import type { WqaFindings } from "./types";

const KALAMAZOO_HOUSE: HouseContext = {
  houseId: "test-house-id",
  addressLine1: "100 Fixture Ave",
  city: "Kalamazoo",
  state: "MI",
  county: "Kalamazoo",
  postalCode: "49001",
  latitude: 42.2917,
  longitude: -85.5872,
  parcelId: null,
  waterSource: "municipal",
  basementPresent: null,
  waterSystemUserPwsid: null,
  waterSystemPwsidConfidence: null,
};

type FetchHandler = (url: string) => Response | Promise<Response>;

function fakeResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

/**
 * Build a global.fetch mock that routes by URL substring. Anything
 * unmatched throws — keeps the tests honest about which endpoints get
 * called.
 */
function installFetchMock(handlers: Record<string, FetchHandler>): {
  fetchSpy: ReturnType<typeof vi.fn>;
  callsTo(substring: string): number;
} {
  const fetchSpy = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    for (const [key, handler] of Object.entries(handlers)) {
      if (url.includes(key)) return handler(url);
    }
    throw new Error(`[fetch mock] unhandled URL: ${url}`);
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  return {
    fetchSpy,
    callsTo(substring: string) {
      return fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes(substring),
      ).length;
    },
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * Build a minimal but valid Envirofacts WATER_SYSTEM response for a
 * given PWSID — the Kalamazoo defaults are what real EPA returns.
 */
function kalamazooWaterSystemResponse(pwsid: string = "MI0003520") {
  return [
    {
      pwsid,
      pws_name: "KALAMAZOO",
      pws_activity_code: "A",
      pws_type_code: "CWS",
      gw_sw_code: "GW",
      population_served_count: 192992,
      service_connections_count: 41411,
      admin_name: "BAKER, JAMES",
      email_addr: "bakerj@kalamazoocity.org",
      phone_number: "269-337-8768",
    },
  ];
}

describe("WQA module check() — direct match (no fallback needed)", () => {
  it("does NOT call the buffered query when the direct lookup matches", async () => {
    const m = installFetchMock({
      // Direct CWS Service Areas point query — no distance param.
      "FeatureServer/0/query?": (url) => {
        // Distinguish direct vs buffered: buffered URL has distance=
        if (url.includes("distance=")) {
          throw new Error(
            "Buffered query should not run when direct lookup matched",
          );
        }
        return fakeResponse({
          features: [
            {
              attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" },
            },
          ],
        });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse([]),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("cws_no_ccr");
    expect(f.system_card?.pwsid).toBe("MI0003520");
    expect(f.system_card?.pwsid_confidence).toBe("verified");
    // The direct query ran exactly once; no buffered query.
    const directCalls = m.fetchSpy.mock.calls.filter(
      (c) =>
        String(c[0]).includes("FeatureServer/0/query?") &&
        !String(c[0]).includes("distance="),
    ).length;
    const bufferedCalls = m.callsTo("distance=");
    expect(directCalls).toBe(1);
    expect(bufferedCalls).toBe(0);
  });
});

/**
 * Realistic LCR payload that mirrors EPA's actual response shape for
 * MI0003520 (Kalamazoo): all PB90 (lead 90th-percentile), no copper,
 * no sampling dates. The most recent sample_id is MI381874 at 0.0053
 * mg/L — well below the 0.015 mg/L action level.
 */
function kalamazooLcrResponse() {
  const rows = [
    ["MI207485", 18387005, 0.004],
    ["MI257263", 19262918, 0.013],
    ["MI266401", 19454418, 0.015],
    ["MI287028", 19823966, 0.013],
    ["MI287029", 19823967, 0.015],
    ["MI287030", 19823968, 0.0077],
    ["MI287031", 19823969, 0.0045],
    ["MI293204", 20174608, 0.0079],
    ["MI303220", 20456661, 0.013],
    ["MI310696", 20637276, 0.0073],
    ["MI320570", 20824425, 0.0084],
    ["MI329505", 21034793, 0.0073],
    ["MI338908", 21257474, 0.0087],
    ["MI347586", 21480232, 0.0063],
    ["MI357717", 21991968, 0.009],
    ["MI370412", 22449700, 0.003],
    ["MI381874", 22828627, 0.0053],
  ];
  return rows.map(([sample_id, sar_id, sample_measure]) => ({
    pwsid: "MI0003520",
    sar_id,
    sample_id,
    epa_region: "05",
    sample_measure,
    unit_of_measure: "mg/L",
    contaminant_code: "PB90",
    result_sign_code: null,
    primacy_agency_code: "MI",
  }));
}

describe("WQA module check() — direct miss + single-nearby fallback", () => {
  it("recovers an inferred PWSID and runs SDWIS against it", async () => {
    const m = installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          // Buffered query — return polygons all belonging to MI0003520.
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
            ],
          });
        }
        // Direct query — no match (the canonical coverage-gap case).
        return fakeResponse({ features: [] });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse([]),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("cws_no_ccr");
    expect(f.system_card?.pwsid).toBe("MI0003520");
    expect(f.system_card?.pwsid_confidence).toBe("inferred");
    // Verify SDWIS endpoints were hit — fallback inferred PWSIDs
    // should NOT skip SDWIS.
    expect(m.callsTo("efservice/VIOLATION")).toBe(1);
    expect(m.callsTo("efservice/LCR_SAMPLE_RESULT")).toBe(1);
  });

  it("populates compliance_status_short from the SDWIS pulls", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]), // no violations
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse([]),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.system_card?.compliance_status_short).toBe("no_active_violations");
  });

  it("regression: real Kalamazoo LCR response (17 PB90 rows, no copper, no dates) produces caution severity (issue #188)", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse(kalamazooLcrResponse()),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    // Most recent lead is 0.0053 mg/L — well below the 0.015 action
    // level but a positive detection. Pre-#188 this produced
    // `favorable`; #188 escalates to `caution` because any lead
    // detection is worth surfacing (regulatory thresholds aren't
    // health-safety thresholds).
    expect(finding.severity).toBe("caution");
    expect(f.lead_copper_summary?.status).toBe("available");
    if (f.lead_copper_summary?.status === "available") {
      const lead =
        f.lead_copper_summary.most_recent_sampling_period.lead_90th_percentile;
      expect(lead?.value).toBe(0.0053);
      expect(lead?.sample_id).toBe("MI381874");
      expect(
        f.lead_copper_summary.most_recent_sampling_period
          .copper_90th_percentile,
      ).toBeNull();
      expect(f.lead_copper_summary.sampling_period_count).toBe(17);
    }
  });

  it("WQA-4: persists recommended_actions on the payload (pitcher_filter + free_testing both fire for Kalamazoo under #188)", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse(kalamazooLcrResponse()),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    // Kalamazoo has admin contact with phone → free_testing fires.
    // Under #188, any detected lead/copper also fires pitcher_filter
    // (Kalamazoo's recent lead is positive at ~35% of action level).
    expect(f.recommended_actions).toBeDefined();
    expect(f.recommended_actions?.map((a) => a.id)).toEqual([
      "pitcher_filter",
      "free_testing",
    ]);
    const filterCard = f.recommended_actions!.find(
      (a) => a.id === "pitcher_filter",
    )!;
    // WQA-5: the detected lead sample now flows through the remediation
    // matrix, so the card is contaminant-specific (under-sink carbon
    // block, NSF/ANSI 53, covers lead) and carries the matrix CTA —
    // even on cws_no_ccr where the only detection is the LCR lead value.
    expect(filterCard.icon).toBe("filter");
    expect(filterCard.headline).toBe(
      "Install a NSF/ANSI 53 certified under-sink filter",
    );
    expect(filterCard.supporting_line).toContain("Lead");
    expect(filterCard.supporting_line).toMatch(
      /whole-house filters can't help with lead/i,
    );
    expect(filterCard.matrix_cta).toBe("See your full remediation matrix");
    const testingCard = f.recommended_actions!.find(
      (a) => a.id === "free_testing",
    )!;
    expect(testingCard.supporting_line).toContain("269-337-8768");
    expect(testingCard.supporting_line).toContain(
      "Kalamazoo Public Water Supply",
    );
  });

  it("WQA-4: emits an activity log step for the recommended-actions compute", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse(kalamazooLcrResponse()),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const steps = finding.activityLog?.steps ?? [];
    const computeSteps = steps.filter((s) => s.kind === "compute");
    // Two compute steps: one for compliance summary, one for
    // recommended-actions (WQA-4). Under #188 Kalamazoo emits both
    // pitcher_filter and free_testing cards.
    const recommendationsStep = computeSteps.find((s) =>
      (s.detail ?? "").includes("actions: pitcher_filter, free_testing"),
    );
    expect(recommendationsStep).toBeDefined();
    expect(recommendationsStep?.result_summary).toMatch(
      /2 recommendations/i,
    );
  });
});

describe("WQA module check() — direct miss + multiple-competing fallback", () => {
  it("routes to cws_unmapped (even though user declared municipal)", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
              { attributes: { PWSID: "MI0007777", PWS_Name: "OTHER" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("cws_unmapped");
    expect(f.system_card).toBeUndefined();
    expect(f.branch_metadata.diagnostic_note).toMatch(/Multiple utilities/i);
  });

  it("routes to cws_unmapped when waterSource is null + multiple competing utilities nearby", async () => {
    installFetchMock({
      "FeatureServer/0/query?": (url) => {
        if (url.includes("distance=")) {
          return fakeResponse({
            features: [
              { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
              { attributes: { PWSID: "MI0007777", PWS_Name: "OTHER" } },
            ],
          });
        }
        return fakeResponse({ features: [] });
      },
    });

    const house: HouseContext = { ...KALAMAZOO_HOUSE, waterSource: null };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;
    // Without the override in index.ts, branch.ts would route this to
    // private_well. The override forces cws_unmapped because multiple
    // utilities within 500m is strong city-water signal.
    expect(f.branch).toBe("cws_unmapped");
  });
});

describe("WQA module check() — direct miss + no-match fallback", () => {
  it("routes to private_well when waterSource is null and no polygons nearby", async () => {
    installFetchMock({
      "FeatureServer/0/query?": () => fakeResponse({ features: [] }),
    });

    const house: HouseContext = { ...KALAMAZOO_HOUSE, waterSource: null };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("private_well");
  });

  it("routes to cws_unmapped when waterSource='municipal' but no polygons nearby", async () => {
    installFetchMock({
      "FeatureServer/0/query?": () => fakeResponse({ features: [] }),
    });

    const finding = await WqaModule.check(KALAMAZOO_HOUSE);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("cws_unmapped");
  });
});

describe("WQA module check() — issue #193 user-supplied PWSID override", () => {
  it("skips the EPA polygon lookup when waterSystemUserPwsid is set", async () => {
    const m = installFetchMock({
      "FeatureServer/0/query?": () => {
        throw new Error(
          "EPA polygon lookup should be skipped when the user supplied a PWSID",
        );
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse([]),
    });

    const house: HouseContext = {
      ...KALAMAZOO_HOUSE,
      waterSystemUserPwsid: "MI0003520",
      waterSystemPwsidConfidence: "user_confirmed",
    };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;

    // The persisted confidence mirrors the houses-row value.
    expect(f.system_card?.pwsid_confidence).toBe("user_confirmed");
    expect(f.system_card?.pwsid).toBe("MI0003520");
    expect(f.branch).toBe("cws_no_ccr");

    // No FeatureServer calls at all — the override path bypasses both
    // the direct point-in-polygon and the nearest-polygon fallback.
    const featureCalls = m.fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("FeatureServer"),
    );
    expect(featureCalls).toHaveLength(0);
  });

  it("persists user_corrected confidence when the houses row says so", async () => {
    installFetchMock({
      "FeatureServer/0/query?": () => {
        throw new Error("polygon lookup should not run");
      },
      "efservice/WATER_SYSTEM": () =>
        fakeResponse(kalamazooWaterSystemResponse()),
      "efservice/VIOLATION": () => fakeResponse([]),
      "efservice/LCR_SAMPLE_RESULT": () => fakeResponse([]),
    });

    const house: HouseContext = {
      ...KALAMAZOO_HOUSE,
      waterSystemUserPwsid: "MI0003520",
      waterSystemPwsidConfidence: "user_corrected",
    };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.system_card?.pwsid_confidence).toBe("user_corrected");
  });

  it("routes to 'stale' when the user-supplied PWSID returns no record from EPA", async () => {
    installFetchMock({
      "FeatureServer/0/query?": () => {
        throw new Error("polygon lookup should not run");
      },
      // EPA returns an empty array for unknown PWSIDs.
      "efservice/WATER_SYSTEM": () => fakeResponse([]),
    });

    const house: HouseContext = {
      ...KALAMAZOO_HOUSE,
      waterSystemUserPwsid: "ZZ9999999",
      waterSystemPwsidConfidence: "user_corrected",
    };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("stale");
  });
});

describe("WQA module check() — user-declared well short-circuits both lookups", () => {
  it("does NOT call ANY EPA endpoint when waterSource='well'", async () => {
    const m = installFetchMock({
      // Any FeatureServer call should fail — short-circuit means we
      // shouldn't even reach this.
      "FeatureServer/0/query?": () => {
        throw new Error("EPA call should not run on user-declared well");
      },
    });

    const house: HouseContext = { ...KALAMAZOO_HOUSE, waterSource: "well" };
    const finding = await WqaModule.check(house);
    const f = finding.findings as unknown as WqaFindings;
    expect(f.branch).toBe("private_well");
    expect(m.fetchSpy.mock.calls).toHaveLength(0);
  });
});
