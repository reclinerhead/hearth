import { describe, expect, it } from "vitest";
import { decideBranch } from "./branch";
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";

function kalamazoo(
  overrides: Partial<EnvirofactsWaterSystemRecord> = {},
): EnvirofactsWaterSystemRecord {
  return {
    pwsid: "MI0003520",
    pws_name: "KALAMAZOO",
    pws_activity_code: "A",
    pws_type_code: "CWS",
    gw_sw_code: "GW",
    primary_source_code: "GW",
    owner_type_code: "L",
    population_served_count: 192992,
    service_connections_count: 41411,
    org_name: "BAKER, JAMES",
    admin_name: "BAKER, JAMES",
    email_addr: "bakerj@kalamazoocity.org",
    phone_number: "269-337-8768",
    source_water_protection_code: "Y",
    source_protection_begin_date: "2004-03-12 00:00:00",
    ...overrides,
  };
}

describe("decideBranch", () => {
  it("returns private_well when no PWSID was resolved", () => {
    const r = decideBranch({ pwsidResolved: false, record: null });
    expect(r.branch).toBe("private_well");
    expect(r.diagnostic).toMatch(/private well/i);
  });

  it("returns stale when PWSID resolved but Envirofacts had no record", () => {
    const r = decideBranch({ pwsidResolved: true, record: null });
    expect(r.branch).toBe("stale");
    expect(r.diagnostic).toMatch(/no WATER_SYSTEM record/i);
  });

  it("returns stale when pws_activity_code is not A", () => {
    const r = decideBranch({
      pwsidResolved: true,
      record: kalamazoo({ pws_activity_code: "I" }),
    });
    expect(r.branch).toBe("stale");
    expect(r.diagnostic).toMatch(/pws_activity_code='I'/);
  });

  it("returns cws_no_ccr for an active CWS", () => {
    const r = decideBranch({ pwsidResolved: true, record: kalamazoo() });
    expect(r.branch).toBe("cws_no_ccr");
    expect(r.diagnostic).toBeUndefined();
  });

  it("returns non_community for an active TNCWS", () => {
    const r = decideBranch({
      pwsidResolved: true,
      record: kalamazoo({ pws_type_code: "TNCWS" }),
    });
    expect(r.branch).toBe("non_community");
  });

  it("returns non_community for an active NTNCWS", () => {
    const r = decideBranch({
      pwsidResolved: true,
      record: kalamazoo({ pws_type_code: "NTNCWS" }),
    });
    expect(r.branch).toBe("non_community");
  });

  it("returns stale with a diagnostic when the pws_type_code is unrecognized", () => {
    const r = decideBranch({
      pwsidResolved: true,
      record: kalamazoo({ pws_type_code: "ZZZ" }),
    });
    expect(r.branch).toBe("stale");
    expect(r.diagnostic).toMatch(/unrecognized.*pws_type_code='ZZZ'/);
  });
});
