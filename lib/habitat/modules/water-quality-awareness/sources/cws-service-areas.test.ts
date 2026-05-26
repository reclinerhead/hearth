import { describe, expect, it, vi } from "vitest";
import {
  buildCwsServiceAreaQueryUrl,
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
