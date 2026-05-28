import { describe, expect, it, vi } from "vitest";
import {
  buildNfhlQueryUrl,
  coerceFemaNullSentinel,
  computeBackoffDelayMs,
  DEFAULT_RETRY_POLICY,
  fetchFloodZonesAtPoint,
  NfhlFetchError,
  normalizeFloodZone,
  type FetchFloodZonesOptions,
  type NfhlFloodZoneAttributes,
  type RetryPolicy,
} from "./fetch";

/**
 * Single-attempt retry policy used by every test that's exercising
 * non-retry behavior. Keeps the historical 1-shot semantics so
 * pre-retry tests don't accidentally probe FEMA three times.
 */
const SINGLE_SHOT: RetryPolicy = {
  attempts: 1,
  baseDelayMs: 0,
  factor: 1,
  jitter: 0,
};

/** No-op sleep so retry tests don't actually wait 300ms+ between attempts. */
const NO_SLEEP: FetchFloodZonesOptions["sleepImpl"] = async () => {};

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

describe("fetchFloodZonesAtPoint (single-attempt behavior)", () => {
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

    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      retryPolicy: SINGLE_SHOT,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].fldZone).toBe("X");
    expect(zones[0].staticBfe).toBeNull();
  });

  it("returns an empty array on a no-coverage response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ features: [] }),
    ) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(35.0, -90.0, {
      fetchImpl,
      retryPolicy: SINGLE_SHOT,
    });
    expect(zones).toEqual([]);
  });

  it("throws on non-200 response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        retryPolicy: SINGLE_SHOT,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws on missing features key", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ displayFieldName: "FLD_ZONE" }),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        retryPolicy: SINGLE_SHOT,
      }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws on non-object response body", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse("not an object"),
    ) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        retryPolicy: SINGLE_SHOT,
      }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        timeoutMs: 100,
        retryPolicy: SINGLE_SHOT,
      }),
    ).rejects.toThrow(/timed out after 100ms/);
  });

  it("propagates non-AbortError network errors verbatim", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND hazards.fema.gov");
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        retryPolicy: SINGLE_SHOT,
      }),
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
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      retryPolicy: SINGLE_SHOT,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].fldZone).toBe("AE");
    expect(zones[0].staticBfe).toBe(645.5);
  });
});

describe("DEFAULT_RETRY_POLICY", () => {
  it("attempts the initial fetch plus 2 retries", () => {
    expect(DEFAULT_RETRY_POLICY.attempts).toBe(3);
  });

  it("uses a short exponential schedule (300ms base)", () => {
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(300);
    expect(DEFAULT_RETRY_POLICY.factor).toBe(3);
  });
});

describe("computeBackoffDelayMs", () => {
  it("returns ~baseDelayMs on attempt 1 with zero-jitter random", () => {
    // random=0.5 → 2*0.5-1 = 0 → no jitter contribution
    expect(
      computeBackoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 0.5),
    ).toBe(300);
  });

  it("grows by `factor` each attempt", () => {
    expect(
      computeBackoffDelayMs(2, DEFAULT_RETRY_POLICY, () => 0.5),
    ).toBe(900);
  });

  it("applies upper jitter bound when random=1", () => {
    // random=1 → 2*1-1 = +1 → +jitter (20%) → 300 * 1.2 = 360
    expect(
      computeBackoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 1),
    ).toBe(360);
  });

  it("applies lower jitter bound when random=0", () => {
    // random=0 → 2*0-1 = -1 → -jitter (20%) → 300 * 0.8 = 240
    expect(
      computeBackoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 0),
    ).toBe(240);
  });

  it("never returns a negative value", () => {
    const policy: RetryPolicy = {
      attempts: 3,
      baseDelayMs: 1,
      factor: 1,
      jitter: 5,
    };
    expect(
      computeBackoffDelayMs(1, policy, () => 0),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchFloodZonesAtPoint — retry behavior", () => {
  it("retries on 503 and succeeds on the second attempt", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return fakeResponse({}, { ok: false, status: 503 });
      return fakeResponse({ features: [] });
    }) as unknown as typeof fetch;
    const onAttempt = vi.fn();
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      sleepImpl: NO_SLEEP,
      onAttempt,
    });
    expect(zones).toEqual([]);
    expect(call).toBe(2);
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      outcome: "retryable-error",
    });
    expect(onAttempt).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      outcome: "success",
    });
  });

  it("retries on 429 (rate-limit)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return fakeResponse({}, { ok: false, status: 429 });
      return fakeResponse({ features: [] });
    }) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });
    expect(zones).toEqual([]);
    expect(call).toBe(2);
  });

  it("retries on network errors", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error("ECONNRESET");
      return fakeResponse({ features: [] });
    }) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });
    expect(zones).toEqual([]);
    expect(call).toBe(2);
  });

  it("retries on AbortError (timeout)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      return fakeResponse({ features: [] });
    }) as unknown as typeof fetch;
    const zones = await fetchFloodZonesAtPoint(42.262, -85.589, {
      fetchImpl,
      timeoutMs: 100,
      sleepImpl: NO_SLEEP,
    });
    expect(zones).toEqual([]);
    expect(call).toBe(2);
  });

  it("does NOT retry on 404 (deterministic client error)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return fakeResponse({}, { ok: false, status: 404 });
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        sleepImpl: NO_SLEEP,
      }),
    ).rejects.toThrow(/HTTP 404/);
    expect(call).toBe(1);
  });

  it("does NOT retry on unexpected response shape", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return fakeResponse({ displayFieldName: "FLD_ZONE" });
    }) as unknown as typeof fetch;
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        sleepImpl: NO_SLEEP,
      }),
    ).rejects.toThrow(/unexpected response shape/);
    expect(call).toBe(1);
  });

  it("gives up after 3 attempts when every retry fails (5xx)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return fakeResponse({}, { ok: false, status: 502 });
    }) as unknown as typeof fetch;
    const onAttempt = vi.fn();
    await expect(
      fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        sleepImpl: NO_SLEEP,
        onAttempt,
      }),
    ).rejects.toThrow(NfhlFetchError);
    expect(call).toBe(3);
    expect(onAttempt).toHaveBeenLastCalledWith({
      attempt: 3,
      outcome: "fatal-error",
    });
  });

  it("throws NfhlFetchError carrying the final attempt number and status", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 502 }),
    ) as unknown as typeof fetch;
    try {
      await fetchFloodZonesAtPoint(42.262, -85.589, {
        fetchImpl,
        sleepImpl: NO_SLEEP,
      });
      expect.fail("expected NfhlFetchError");
    } catch (err) {
      expect(err).toBeInstanceOf(NfhlFetchError);
      const e = err as NfhlFetchError;
      expect(e.attempt).toBe(3);
      expect(e.status).toBe(502);
      expect(e.retryable).toBe(true);
    }
  });
});
