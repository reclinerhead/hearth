import { describe, expect, it, vi } from "vitest";
import {
  buildWaterSystemUrl,
  fetchWaterSystem,
  normalizeRecord,
} from "./envirofacts";

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

describe("buildWaterSystemUrl", () => {
  it("hits the EPA Envirofacts WATER_SYSTEM endpoint with an uppercase PWSID", () => {
    expect(buildWaterSystemUrl("mi0003520")).toBe(
      "https://data.epa.gov/efservice/WATER_SYSTEM/PWSID/MI0003520/JSON",
    );
  });
  it("trims surrounding whitespace before encoding", () => {
    expect(buildWaterSystemUrl("  MI0003520  ")).toContain("MI0003520");
  });
});

describe("normalizeRecord", () => {
  it("trims string fields and turns empty strings into null", () => {
    const out = normalizeRecord({
      pwsid: "mi0003520",
      pws_name: "  KALAMAZOO  ",
      email_addr: "   ",
      phone_number: "269-337-8768",
      pws_activity_code: "A",
      pws_type_code: "CWS",
    });
    expect(out.pwsid).toBe("MI0003520");
    expect(out.pws_name).toBe("KALAMAZOO");
    expect(out.email_addr).toBeNull();
    expect(out.phone_number).toBe("269-337-8768");
  });

  it("preserves non-string values like numbers as-is", () => {
    const out = normalizeRecord({
      pwsid: "MI0003520",
      pws_name: "KALAMAZOO",
      pws_activity_code: "A",
      pws_type_code: "CWS",
      population_served_count: 192992,
    });
    expect(out.population_served_count).toBe(192992);
  });
});

describe("fetchWaterSystem", () => {
  function kalamazooBody() {
    return [
      {
        pwsid: "MI0003520",
        pws_name: "KALAMAZOO",
        pws_activity_code: "A",
        pws_type_code: "CWS",
        gw_sw_code: "GW",
        population_served_count: 192992,
        service_connections_count: 41411,
        email_addr: "bakerj@kalamazoocity.org",
        admin_name: "BAKER, JAMES",
      },
    ];
  }

  it("returns the normalized record and the raw payload on a normal response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(kalamazooBody()),
    ) as unknown as typeof fetch;

    const r = await fetchWaterSystem("MI0003520", { fetchImpl });
    expect(r.record?.pwsid).toBe("MI0003520");
    expect(r.record?.pws_name).toBe("KALAMAZOO");
    expect(r.record?.population_served_count).toBe(192992);
    expect(Array.isArray(r.rawPayload)).toBe(true);
    expect(r.sourceUrl).toContain("MI0003520");
  });

  it("returns a null record on an empty array (the 'no row' signal)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([]),
    ) as unknown as typeof fetch;
    const r = await fetchWaterSystem("MI9999999", { fetchImpl });
    expect(r.record).toBeNull();
    expect(r.sourceUrl).toContain("MI9999999");
  });

  it("throws on a non-array response (Envirofacts schema break)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ not: "an array" }),
    ) as unknown as typeof fetch;
    await expect(
      fetchWaterSystem("MI0003520", { fetchImpl }),
    ).rejects.toThrow(/expected an array/);
  });

  it("throws on a record missing pws_name", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([
        { pwsid: "MI0003520", pws_activity_code: "A", pws_type_code: "CWS" },
      ]),
    ) as unknown as typeof fetch;
    await expect(
      fetchWaterSystem("MI0003520", { fetchImpl }),
    ).rejects.toThrow(/missing one of the required fields/);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([], { ok: false, status: 502 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchWaterSystem("MI0003520", { fetchImpl }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchWaterSystem("MI0003520", { fetchImpl, timeoutMs: 250 }),
    ).rejects.toThrow(/timed out after 250ms/);
  });
});
