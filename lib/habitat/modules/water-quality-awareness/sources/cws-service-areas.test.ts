import { describe, expect, it, vi } from "vitest";
import {
  buildCwsServiceAreaQueryUrl,
  buildNearestPwsidQueryUrl,
  NEAREST_POLYGON_FALLBACK_RADIUS_M,
  resolveNearestPwsid,
  resolvePwsidAtPoint,
} from "./cws-service-areas";

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

describe("buildCwsServiceAreaQueryUrl", () => {
  it("uses the EPA CWS Service Areas FeatureServer/0 endpoint", () => {
    const url = buildCwsServiceAreaQueryUrl(42.262, -85.589);
    expect(url).toContain(
      "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query",
    );
  });

  it("encodes geometry as longitude,latitude in WGS84", () => {
    const url = buildCwsServiceAreaQueryUrl(42.262, -85.589);
    expect(url).toMatch(/geometry=-85\.589(%2C|,)42\.262/);
    expect(url).toContain("inSR=4326");
    expect(url).toContain("spatialRel=esriSpatialRelIntersects");
  });

  it("scopes outFields to PWSID and PWS_NAME", () => {
    const url = buildCwsServiceAreaQueryUrl(42.262, -85.589);
    expect(url).toMatch(/outFields=PWSID(%2C|,)PWS_NAME/);
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
  });
});

describe("resolvePwsidAtPoint", () => {
  it("returns the resolved match on a single-polygon response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: { PWSID: "MI0003520", PWS_NAME: "KALAMAZOO" } },
        ],
      }),
    ) as unknown as typeof fetch;

    const r = await resolvePwsidAtPoint(42.262, -85.589, { fetchImpl });
    expect(r.match?.pwsid).toBe("MI0003520");
    expect(r.match?.pwsName).toBe("KALAMAZOO");
    expect(r.totalFeatures).toBe(1);
  });

  it("uppercases a lower-case PWSID returned from the layer", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [{ attributes: { PWSID: "mi0003520", PWS_NAME: "K" } }],
      }),
    ) as unknown as typeof fetch;
    const r = await resolvePwsidAtPoint(42.262, -85.589, { fetchImpl });
    expect(r.match?.pwsid).toBe("MI0003520");
  });

  it("returns null match on an empty feature array (private-well signal)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ features: [] }),
    ) as unknown as typeof fetch;
    const r = await resolvePwsidAtPoint(46.0, -85.0, { fetchImpl });
    expect(r.match).toBeNull();
    expect(r.totalFeatures).toBe(0);
  });

  it("reports the overlap count when EPA returns multiple polygons", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: { PWSID: "MI0003520", PWS_NAME: "KALAMAZOO" } },
          { attributes: { PWSID: "MI0007777", PWS_NAME: "OTHER" } },
        ],
      }),
    ) as unknown as typeof fetch;
    const r = await resolvePwsidAtPoint(42.262, -85.589, { fetchImpl });
    expect(r.match?.pwsid).toBe("MI0003520");
    expect(r.totalFeatures).toBe(2);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      resolvePwsidAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws on a malformed response shape (missing features key)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ unrelated: true }),
    ) as unknown as typeof fetch;
    await expect(
      resolvePwsidAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when a feature is missing its PWSID attribute", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [{ attributes: { PWS_NAME: "no pwsid here" } }],
      }),
    ) as unknown as typeof fetch;
    await expect(
      resolvePwsidAtPoint(42.262, -85.589, { fetchImpl }),
    ).rejects.toThrow(/without a PWSID/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      resolvePwsidAtPoint(42.262, -85.589, { fetchImpl, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out after 100ms/);
  });
});

describe("buildNearestPwsidQueryUrl", () => {
  it("hits the same FeatureServer/0 endpoint as the direct query", () => {
    const url = buildNearestPwsidQueryUrl(42.26496, -85.57231);
    expect(url).toContain(
      "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query",
    );
  });

  it("includes the distance + units parameters with the default radius", () => {
    const url = buildNearestPwsidQueryUrl(42.26496, -85.57231);
    expect(url).toContain(`distance=${NEAREST_POLYGON_FALLBACK_RADIUS_M}`);
    expect(url).toContain("units=esriSRUnit_Meter");
  });

  it("uses the default radius constant", () => {
    expect(NEAREST_POLYGON_FALLBACK_RADIUS_M).toBe(500);
  });

  it("honors an explicit override radius", () => {
    const url = buildNearestPwsidQueryUrl(42.26496, -85.57231, 1000);
    expect(url).toContain("distance=1000");
  });

  it("encodes geometry as longitude,latitude in WGS84", () => {
    const url = buildNearestPwsidQueryUrl(42.26496, -85.57231);
    expect(url).toMatch(/geometry=-85\.57231(%2C|,)42\.26496/);
    expect(url).toContain("inSR=4326");
    expect(url).toContain("spatialRel=esriSpatialRelIntersects");
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
  });
});

describe("resolveNearestPwsid", () => {
  it("returns single-nearby when all polygons share one PWSID", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
        ],
      }),
    ) as unknown as typeof fetch;

    const r = await resolveNearestPwsid(42.26496, -85.57231, { fetchImpl });
    expect(r.kind).toBe("single-nearby");
    if (r.kind === "single-nearby") {
      expect(r.pwsid).toBe("MI0003520");
      expect(r.pwsName).toBe("KALAMAZOO");
      expect(r.candidateCount).toBe(3);
    }
  });

  it("reads the canonical PWS_Name field (mixed case) returned by EPA", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
        ],
      }),
    ) as unknown as typeof fetch;
    const r = await resolveNearestPwsid(42.26496, -85.57231, { fetchImpl });
    if (r.kind === "single-nearby") {
      expect(r.pwsName).toBe("KALAMAZOO");
    }
  });

  it("returns multiple-competing when polygons span multiple PWSIDs, sorted by count desc", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
          { attributes: { PWSID: "MI0007777", PWS_Name: "PORTAGE" } },
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
          { attributes: { PWSID: "MI0007777", PWS_Name: "PORTAGE" } },
          { attributes: { PWSID: "MI0007777", PWS_Name: "PORTAGE" } },
        ],
      }),
    ) as unknown as typeof fetch;

    const r = await resolveNearestPwsid(42.26496, -85.57231, { fetchImpl });
    expect(r.kind).toBe("multiple-competing");
    if (r.kind === "multiple-competing") {
      expect(r.candidates).toHaveLength(2);
      // Highest count first
      expect(r.candidates[0].pwsid).toBe("MI0007777");
      expect(r.candidates[0].count).toBe(3);
      expect(r.candidates[1].pwsid).toBe("MI0003520");
      expect(r.candidates[1].count).toBe(2);
    }
  });

  it("returns no-match on an empty features array", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ features: [] }),
    ) as unknown as typeof fetch;
    const r = await resolveNearestPwsid(46.0, -85.0, { fetchImpl });
    expect(r.kind).toBe("no-match");
  });

  it("returns no-match when every feature is malformed (defensive)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: null },
          { attributes: { PWSID: "" } },
          { attributes: {} },
        ],
      }),
    ) as unknown as typeof fetch;
    const r = await resolveNearestPwsid(42.26496, -85.57231, { fetchImpl });
    expect(r.kind).toBe("no-match");
  });

  it("skips a single malformed feature but keeps the good ones", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        features: [
          { attributes: null },
          { attributes: { PWSID: "MI0003520", PWS_Name: "KALAMAZOO" } },
        ],
      }),
    ) as unknown as typeof fetch;
    const r = await resolveNearestPwsid(42.26496, -85.57231, { fetchImpl });
    expect(r.kind).toBe("single-nearby");
    if (r.kind === "single-nearby") {
      expect(r.candidateCount).toBe(1);
    }
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      resolveNearestPwsid(42.26496, -85.57231, { fetchImpl }),
    ).rejects.toThrow(/nearest-polygon request failed with HTTP 503/);
  });

  it("throws on a malformed response shape (missing features key)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ unrelated: true }),
    ) as unknown as typeof fetch;
    await expect(
      resolveNearestPwsid(42.26496, -85.57231, { fetchImpl }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      resolveNearestPwsid(42.26496, -85.57231, { fetchImpl, timeoutMs: 100 }),
    ).rejects.toThrow(/nearest-polygon request timed out after 100ms/);
  });

  it("honors a custom radius via options.radiusMeters", async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(typeof url).toBe("string");
      expect(String(url)).toContain("distance=1500");
      return fakeResponse({ features: [] });
    }) as unknown as typeof fetch;
    await resolveNearestPwsid(42.26496, -85.57231, {
      fetchImpl,
      radiusMeters: 1500,
    });
  });
});
