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
  addressLine1: "604 Norton Drive",
  city: "Kalamazoo",
  state: "MI",
  county: "Kalamazoo",
  postalCode: "49001",
  latitude: 42.26496,
  longitude: -85.57231,
  parcelId: null,
  waterSource: "municipal",
  basementPresent: null,
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
        // Direct query — no match (the canonical 604 Norton case).
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
