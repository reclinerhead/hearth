import { describe, expect, it } from "vitest";
import { decideBranch, shouldSkipEpaLookups } from "./branch";
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

describe("decideBranch — user-declared water source takes precedence", () => {
  it("returns private_well with a user-declared diagnostic when waterSource is 'well'", () => {
    const r = decideBranch({
      waterSource: "well",
      pwsidResolved: true, // even if EPA would have matched
      record: kalamazoo(),
    });
    expect(r.branch).toBe("private_well");
    expect(r.diagnostic).toMatch(/told us during onboarding.*private well/i);
  });

  it("returns private_well with a shared-system diagnostic when waterSource is 'shared'", () => {
    const r = decideBranch({
      waterSource: "shared",
      pwsidResolved: true,
      record: kalamazoo(),
    });
    expect(r.branch).toBe("private_well");
    expect(r.diagnostic).toMatch(/shared private water system/i);
  });

  it("returns cws_unmapped when waterSource='municipal' but no polygon match", () => {
    const r = decideBranch({
      waterSource: "municipal",
      pwsidResolved: false,
      record: null,
    });
    expect(r.branch).toBe("cws_unmapped");
    expect(r.diagnostic).toMatch(/national map.*doesn't cover/i);
  });

  it("falls through to standard CWS logic when waterSource='municipal' and EPA matched", () => {
    const r = decideBranch({
      waterSource: "municipal",
      pwsidResolved: true,
      record: kalamazoo(),
    });
    expect(r.branch).toBe("cws_no_ccr");
  });

  it("returns stale for waterSource='municipal' + matched PWSID but inactive system", () => {
    const r = decideBranch({
      waterSource: "municipal",
      pwsidResolved: true,
      record: kalamazoo({ pws_activity_code: "I" }),
    });
    expect(r.branch).toBe("stale");
  });

  it("returns stale for waterSource='municipal' + matched PWSID but Envirofacts had no row", () => {
    const r = decideBranch({
      waterSource: "municipal",
      pwsidResolved: true,
      record: null,
    });
    expect(r.branch).toBe("stale");
  });

  it("returns non_community for waterSource='municipal' + active TNCWS", () => {
    const r = decideBranch({
      waterSource: "municipal",
      pwsidResolved: true,
      record: kalamazoo({ pws_type_code: "TNCWS" }),
    });
    expect(r.branch).toBe("non_community");
  });
});

describe("decideBranch — waterSource unknown / null falls back to EPA-driven logic", () => {
  it("returns private_well (EPA-inferred) when waterSource=null and no polygon match", () => {
    const r = decideBranch({
      waterSource: null,
      pwsidResolved: false,
      record: null,
    });
    expect(r.branch).toBe("private_well");
    expect(r.diagnostic).toMatch(/couldn't tell from your onboarding answers/i);
  });

  it("returns private_well (EPA-inferred) when waterSource='unknown' and no polygon match", () => {
    const r = decideBranch({
      waterSource: "unknown",
      pwsidResolved: false,
      record: null,
    });
    expect(r.branch).toBe("private_well");
    expect(r.diagnostic).toMatch(/couldn't tell from your onboarding answers/i);
  });

  it("returns cws_no_ccr for waterSource=null + matched active CWS", () => {
    const r = decideBranch({
      waterSource: null,
      pwsidResolved: true,
      record: kalamazoo(),
    });
    expect(r.branch).toBe("cws_no_ccr");
  });

  it("returns stale for waterSource=null + matched PWSID but inactive", () => {
    const r = decideBranch({
      waterSource: null,
      pwsidResolved: true,
      record: kalamazoo({ pws_activity_code: "I" }),
    });
    expect(r.branch).toBe("stale");
  });

  it("returns stale with diagnostic for waterSource=null + unrecognized pws_type_code", () => {
    const r = decideBranch({
      waterSource: null,
      pwsidResolved: true,
      record: kalamazoo({ pws_type_code: "ZZZ" }),
    });
    expect(r.branch).toBe("stale");
    expect(r.diagnostic).toMatch(/unrecognized.*pws_type_code='ZZZ'/);
  });
});

describe("shouldSkipEpaLookups", () => {
  it("returns true for well and shared", () => {
    expect(shouldSkipEpaLookups("well")).toBe(true);
    expect(shouldSkipEpaLookups("shared")).toBe(true);
  });
  it("returns false for municipal, unknown, and null", () => {
    expect(shouldSkipEpaLookups("municipal")).toBe(false);
    expect(shouldSkipEpaLookups("unknown")).toBe(false);
    expect(shouldSkipEpaLookups(null)).toBe(false);
  });
});
