import { describe, expect, it, vi } from "vitest";
import {
  buildLcrSamplesUrl,
  fetchLcrSamples,
  normalizeLcrSample,
} from "./sdwis-lcr-samples";

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

describe("buildLcrSamplesUrl", () => {
  it("hits the Envirofacts LCR_SAMPLE_RESULT endpoint with an uppercase PWSID", () => {
    expect(buildLcrSamplesUrl("mi0003520")).toBe(
      "https://data.epa.gov/efservice/LCR_SAMPLE_RESULT/PWSID/MI0003520/JSON",
    );
  });
});

describe("normalizeLcrSample", () => {
  it("trims strings, nulls empties, and coerces sample_measure to number", () => {
    const out = normalizeLcrSample({
      pwsid: "mi0003520",
      sample_id: " S1 ",
      contaminant_code: "5000",
      sample_measure: "0.005",
      result_sign_code: "<",
      unit_of_measure: "  ",
    });
    expect(out.pwsid).toBe("MI0003520");
    expect(out.sample_id).toBe("S1");
    expect(out.sample_measure).toBe(0.005);
    expect(out.unit_of_measure).toBeNull();
  });
});

describe("fetchLcrSamples", () => {
  it("returns records on a normal response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([
        {
          pwsid: "MI0003520",
          sample_id: "S1",
          contaminant_code: "5000",
          sample_measure: 0.005,
          unit_of_measure: "MG/L",
          result_sign_code: "=",
          sampling_end_date: "2024-06-30 00:00:00",
        },
      ]),
    ) as unknown as typeof fetch;

    const r = await fetchLcrSamples("MI0003520", { fetchImpl });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].sample_id).toBe("S1");
    expect(r.records[0].sample_measure).toBe(0.005);
  });

  it("returns empty records on an empty array (rotating sampling schedule)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([]),
    ) as unknown as typeof fetch;
    const r = await fetchLcrSamples("MI0003520", { fetchImpl });
    expect(r.records).toEqual([]);
  });

  it("filters rows missing sample_id", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([{ pwsid: "MI0003520" }]),
    ) as unknown as typeof fetch;
    const r = await fetchLcrSamples("MI0003520", { fetchImpl });
    expect(r.records).toEqual([]);
  });

  it("throws on a non-array response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ x: 1 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchLcrSamples("MI0003520", { fetchImpl }),
    ).rejects.toThrow(/expected an array/);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([], { ok: false, status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchLcrSamples("MI0003520", { fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchLcrSamples("MI0003520", { fetchImpl, timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 200ms/);
  });
});
