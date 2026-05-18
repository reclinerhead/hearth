import { describe, expect, it, vi } from "vitest";
import {
  buildNfhlQueryUrl,
  coerceFemaNullSentinel,
  fetchFloodZonesAtPoint,
  normalizeFloodZone,
  type NfhlFloodZoneAttributes,
} from "./fetch";

describe("buildNfhlQueryUrl", () => {
  it("uses the FEMA NFHL MapServer/28 endpoint", () => {
    const url = buildNfhlQueryUrl(42.262, -85.589);
    expect(url).toContain(
      "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
    );
  });

  it("encodes geometry as longitude,latitude (Esri order)", () => {
    const url = buildNfhlQueryUrl(42.262, -85.589);
    // URLSearchParams encodes the comma. Match either the encoded or
    // raw form so the test is robust to URL encoding choices.
    expect(url).toMatch(/geometry=-85\.589(%2C|,)42\.262/);
  });

  it("requests JSON with WGS84 inSR and intersect spatial relation", () => {
    const url = buildNfhlQueryUrl(42.262, -85.589);
    expect(url).toContain("geometryType=esriGeometryPoint");
    expect(url).toContain("inSR=4326");
    expect(url).toContain("spatialRel=esriSpatialRelIntersects");
    // URLSearchParams leaves "*" unescaped (it's an unreserved character),
    // so the URL contains it literally — match either form for robustness.
    expect(url).toMatch(/outFields=(\*|%2A)/);
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
  });
});

describe("coerceFemaNullSentinel", () => {
  it("returns null for -9999", () => {
    expect(coerceFemaNullSentinel(-9999)).toBeNull();
  });

  it("returns null for -9999.0", () => {
    expect(coerceFemaNullSentinel(-9999.0)).toBeNull();
  });

  it("passes a real numeric value through unchanged", () => {
    expect(coerceFemaNullSentinel(0)).toBe(0);
    expect(coerceFemaNullSentinel(645.5)).toBe(645.5);
    expect(coerceFemaNullSentinel(-15.2)).toBe(-15.2);
  });

  it("does not treat -999 or -9998 as null", () => {
    expect(coerceFemaNullSentinel(-999)).toBe(-999);
    expect(coerceFemaNullSentinel(-9998)).toBe(-9998);
  });
});

describe("normalizeFloodZone", () => {
  /**
   * Sample 1 from the issue — Zone X minimal hazard (Kalamazoo, MI).
   */
  function sample1(): NfhlFloodZoneAttributes {
    return {
      OBJECTID: 20000682,
      DFIRM_ID: "26077C",
      FLD_AR_ID: "26077C_3766",
      STUDY_TYP: "NP",
      FLD_ZONE: "X",
      ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
      SFHA_TF: "F",
      STATIC_BFE: -9999.0,
      V_DATUM: null,
      DEPTH: -9999.0,
      LEN_UNIT: null,
      VELOCITY: -9999.0,
      VEL_UNIT: null,
      BFE_REVERT: -9999.0,
      DEP_REVERT: -9999.0,
      DUAL_ZONE: null,
      SOURCE_CIT: "26077C_STUDY2",
    };
  }

  it("coerces all -9999 numeric sentinels to null on sample 1", () => {
    const z = normalizeFloodZone(sample1());
    expect(z.staticBfe).toBeNull();
    expect(z.depth).toBeNull();
    expect(z.velocity).toBeNull();
  });

  it("preserves the FLD_ZONE and ZONE_SUBTY strings on sample 1", () => {
    const z = normalizeFloodZone(sample1());
    expect(z.fldZone).toBe("X");
    expect(z.zoneSubty).toBe("AREA OF MINIMAL FLOOD HAZARD");
  });

  it("derives isSfha from SFHA_TF=F as false", () => {
    expect(normalizeFloodZone(sample1()).isSfha).toBe(false);
  });

  it("derives isSfha from SFHA_TF=T as true", () => {
    const attrs = { ...sample1(), SFHA_TF: "T" };
    expect(normalizeFloodZone(attrs).isSfha).toBe(true);
  });

  it("derives floodway=true from ZONE_SUBTY=FLOODWAY", () => {
    const attrs = { ...sample1(), FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY" };
    expect(normalizeFloodZone(attrs).floodway).toBe(true);
  });

  it("derives floodway=false from any other subtype", () => {
    const attrs = { ...sample1(), ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" };
    expect(normalizeFloodZone(attrs).floodway).toBe(false);
  });

  it("normalizes empty-string ZONE_SUBTY to null", () => {
    const attrs = { ...sample1(), ZONE_SUBTY: "  " };
    expect(normalizeFloodZone(attrs).zoneSubty).toBeNull();
  });

  it("preserves real STATIC_BFE when present and propagates V_DATUM", () => {
    const attrs = {
      ...sample1(),
      FLD_ZONE: "AE",
      ZONE_SUBTY: null,
      SFHA_TF: "T",
      STATIC_BFE: 645.5,
      V_DATUM: "NAVD88",
      LEN_UNIT: "Feet",
    };
    const z = normalizeFloodZone(attrs);
    expect(z.staticBfe).toBe(645.5);
    expect(z.vDatum).toBe("NAVD88");
    expect(z.lenUnit).toBe("Feet");
  });
});

/**
 * Build a fake Response object good enough for fetchFloodZonesAtPoint:
 * Response.ok, Response.status, Response.json().
 */
function fakeResponse(
  body: unknown,
  { ok = true, status = 200 } = {},
): Response {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

describe("fetchFloodZonesAtPoint", () => {
  it("returns a normalized array on a single-feature response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          {
            attributes: {
              OBJECTID: 1,
              DFIRM_ID: "26077C",
              FLD_AR_ID: "26077C_3766",
              STUDY_TYP: "NP",
              FLD_ZONE: "X",
              ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
              SFHA_TF: "F",
              STATIC_BFE: -9999.0,
              V_DATUM: null,
              DEPTH: -9999.0,
              LEN_UNIT: null,
              VELOCITY: -9999.0,
              VEL_UNIT: null,
              BFE_REVERT: -9999.0,
              DEP_REVERT: -9999.0,
              DUAL_ZONE: null,
              SOURCE_CIT: "26077C_STUDY2",
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl });
    expect(zones).toHaveLength(1);
    expect(zones[0].fldZone).toBe("X");
    expect(zones[0].staticBfe).toBeNull();
  });

  it("returns an empty array on a no-coverage response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ features: [] }),
    ) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(35.0, -90.0, { fetchImpl });
    expect(zones).toEqual([]);
  });

  it("throws on non-200 response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws on missing features key", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ displayFieldName: "FLD_ZONE" }),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws on non-object response body", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse("not an object"),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out after 100ms/);
  });

  it("propagates non-AbortError network errors verbatim", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND hazards.fema.gov");
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/ENOTFOUND/);
  });

  it("filters out features missing attributes", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: null },
          {},
          {
            attributes: {
              OBJECTID: 1,
              DFIRM_ID: "26077C",
              FLD_AR_ID: "26077C_3766",
              STUDY_TYP: "NP",
              FLD_ZONE: "AE",
              ZONE_SUBTY: null,
              SFHA_TF: "T",
              STATIC_BFE: 645.5,
              V_DATUM: "NAVD88",
              DEPTH: -9999.0,
              LEN_UNIT: "Feet",
              VELOCITY: -9999.0,
              VEL_UNIT: null,
              BFE_REVERT: -9999.0,
              DEP_REVERT: -9999.0,
              DUAL_ZONE: null,
              SOURCE_CIT: "26077C_STUDY99",
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, { fetchImpl });
    expect(zones).toHaveLength(1);
    expect(zones[0].fldZone).toBe("AE");
    expect(zones[0].staticBfe).toBe(645.5);
  });
});
