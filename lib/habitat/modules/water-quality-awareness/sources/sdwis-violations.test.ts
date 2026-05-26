import { describe, expect, it, vi } from "vitest";
import {
  buildViolationsUrl,
  fetchViolations,
  normalizeViolation,
} from "./sdwis-violations";

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

describe("buildViolationsUrl", () => {
  it("hits the Envirofacts VIOLATION endpoint with an uppercase PWSID", () => {
    expect(buildViolationsUrl("mi0003520")).toBe(
      "https://data.epa.gov/efservice/VIOLATION/PWSID/MI0003520/JSON",
    );
  });
  it("trims surrounding whitespace before encoding", () => {
    expect(buildViolationsUrl("  MI0003520  ")).toContain("MI0003520");
  });
});

describe("normalizeViolation", () => {
  it("trims string fields and turns empty strings into null", () => {
    const out = normalizeViolation({
      pwsid: "mi0003520",
      violation_id: " V1 ",
      violation_code: "  ",
      is_health_based_ind: "Y",
    });
    expect(out.pwsid).toBe("MI0003520");
    expect(out.violation_id).toBe("V1");
    expect(out.violation_code).toBeNull();
    expect(out.is_health_based_ind).toBe("Y");
  });

  it("coerces a numeric-looking viol_measure string to a number", () => {
    const out = normalizeViolation({
      pwsid: "MI0003520",
      violation_id: "V1",
      viol_measure: "0.012",
    });
    expect(out.viol_measure).toBe(0.012);
  });

  it("preserves a viol_measure number as-is", () => {
    const out = normalizeViolation({
      pwsid: "MI0003520",
      violation_id: "V1",
      viol_measure: 0.012,
    });
    expect(out.viol_measure).toBe(0.012);
  });

  it("nulls a viol_measure that doesn't parse", () => {
    const out = normalizeViolation({
      pwsid: "MI0003520",
      violation_id: "V1",
      viol_measure: "n/a",
    });
    expect(out.viol_measure).toBeNull();
  });
});

describe("fetchViolations", () => {
  it("returns normalized records and the raw payload on a normal response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([
        {
          pwsid: "MI0003520",
          violation_id: "V1",
          is_health_based_ind: "Y",
          contaminant_code: "5000",
          viol_first_reported_date: "2024-01-15 00:00:00",
        },
      ]),
    ) as unknown as typeof fetch;

    const r = await fetchViolations("MI0003520", { fetchImpl });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].pwsid).toBe("MI0003520");
    expect(r.records[0].is_health_based_ind).toBe("Y");
    expect(Array.isArray(r.rawPayload)).toBe(true);
    expect(r.sourceUrl).toContain("MI0003520");
  });

  it("returns an empty records array on an empty Envirofacts response (no violations on file)", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([]),
    ) as unknown as typeof fetch;
    const r = await fetchViolations("MI0003520", { fetchImpl });
    expect(r.records).toEqual([]);
  });

  it("filters rows missing a violation_id", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([
        { pwsid: "MI0003520" }, // missing violation_id
        { pwsid: "MI0003520", violation_id: "V1" },
      ]),
    ) as unknown as typeof fetch;
    const r = await fetchViolations("MI0003520", { fetchImpl });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].violation_id).toBe("V1");
  });

  it("throws on a non-array Envirofacts response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ unrelated: true }),
    ) as unknown as typeof fetch;
    await expect(fetchViolations("MI0003520", { fetchImpl })).rejects.toThrow(
      /expected an array/,
    );
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse([], { ok: false, status: 502 }),
    ) as unknown as typeof fetch;
    await expect(fetchViolations("MI0003520", { fetchImpl })).rejects.toThrow(
      /HTTP 502/,
    );
  });

  it("turns AbortError into a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchViolations("MI0003520", { fetchImpl, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out after 100ms/);
  });
});
