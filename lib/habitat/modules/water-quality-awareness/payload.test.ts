import { describe, expect, it } from "vitest";
import {
  buildDescription,
  buildPrivateWellPayload,
  buildStalePayload,
  buildSystemPayload,
  displaySystemName,
  formatAdminName,
  mapSourceType,
  titleCase,
} from "./payload";
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
    population_served_count: 192992,
    service_connections_count: 41411,
    admin_name: "BAKER, JAMES",
    email_addr: "bakerj@kalamazoocity.org",
    phone_number: "269-337-8768",
    source_water_protection_code: "Y",
    source_protection_begin_date: "2004-03-12 00:00:00",
    ...overrides,
  };
}

describe("titleCase", () => {
  it("lowercases then capitalizes each word", () => {
    expect(titleCase("KALAMAZOO")).toBe("Kalamazoo");
    expect(titleCase("CITY OF KALAMAZOO")).toBe("City Of Kalamazoo");
  });
});

describe("formatAdminName", () => {
  it("flips 'LAST, FIRST' to 'First Last' with title case", () => {
    expect(formatAdminName("BAKER, JAMES")).toBe("James Baker");
  });
  it("trims surrounding whitespace and handles single-name input", () => {
    expect(formatAdminName("  SMITH  ")).toBe("Smith");
  });
  it("returns null for null, undefined, or empty input", () => {
    expect(formatAdminName(null)).toBeNull();
    expect(formatAdminName(undefined)).toBeNull();
    expect(formatAdminName("")).toBeNull();
    expect(formatAdminName("   ")).toBeNull();
  });
});

describe("mapSourceType", () => {
  it("maps GW to groundwater", () => {
    expect(mapSourceType("GW")).toBe("groundwater");
  });
  it("maps SW to surface", () => {
    expect(mapSourceType("SW")).toBe("surface");
  });
  it("maps GU to groundwater_under_surface", () => {
    expect(mapSourceType("GU")).toBe("groundwater_under_surface");
  });
  it("falls back to unknown for null or unrecognized codes", () => {
    expect(mapSourceType(null)).toBe("unknown");
    expect(mapSourceType("")).toBe("unknown");
    expect(mapSourceType("XX")).toBe("unknown");
  });
});

describe("displaySystemName", () => {
  it("suffixes 'Public Water Supply' when the EPA name lacks a utility word", () => {
    expect(displaySystemName(kalamazoo())).toBe("Kalamazoo Public Water Supply");
  });
  it("leaves the name alone when it already mentions Water/Authority/etc.", () => {
    expect(
      displaySystemName(
        kalamazoo({ pws_name: "KENTWOOD WATER DEPARTMENT" }),
      ),
    ).toBe("Kentwood Water Department");
  });
});

describe("buildDescription", () => {
  it("includes population, connections, and source-protection sentence when present", () => {
    const desc = buildDescription(kalamazoo());
    expect(desc).toMatch(/groundwater/i);
    expect(desc).toMatch(/192,992 people/);
    expect(desc).toMatch(/41,411 service connections/);
    expect(desc).toMatch(/source water protection program since 2004/i);
  });
  it("omits the source-protection sentence when the program code is not Y", () => {
    const desc = buildDescription(
      kalamazoo({ source_water_protection_code: "N" }),
    );
    expect(desc).not.toMatch(/protection program/i);
  });
  it("handles missing population gracefully", () => {
    const desc = buildDescription(
      kalamazoo({ population_served_count: null }),
    );
    expect(desc).toMatch(/41,411 service connections/);
    expect(desc).not.toMatch(/people/);
  });
});

describe("buildSystemPayload — cws_no_ccr", () => {
  it("returns a neutral severity finding with the system_card populated", () => {
    const p = buildSystemPayload("cws_no_ccr", kalamazoo());
    expect(p.severity).toBe("neutral");
    expect(p.findings.branch).toBe("cws_no_ccr");
    expect(p.findings.system_card?.pws_name).toBe(
      "Kalamazoo Public Water Supply",
    );
    expect(p.findings.system_card?.pwsid).toBe("MI0003520");
    expect(p.findings.system_card?.source_type).toBe("groundwater");
    expect(p.findings.system_card?.compliance_status_short).toBe("unknown");
    expect(p.findings.system_card?.latest_ccr_status).toBe("not_uploaded");
  });

  it("formats the admin contact with title case", () => {
    const p = buildSystemPayload("cws_no_ccr", kalamazoo());
    expect(p.findings.branch_metadata.admin_contact?.name).toBe("James Baker");
    expect(p.findings.branch_metadata.admin_contact?.email).toBe(
      "bakerj@kalamazoocity.org",
    );
  });

  it("uses the title-cased system name in the headline", () => {
    const p = buildSystemPayload("cws_no_ccr", kalamazoo());
    expect(p.headline).toBe(
      "Your water comes from Kalamazoo Public Water Supply",
    );
  });
});

describe("buildSystemPayload — non_community", () => {
  it("uses the non-community headline and notes the CCR is not required", () => {
    const p = buildSystemPayload(
      "non_community",
      kalamazoo({ pws_type_code: "TNCWS" }),
    );
    expect(p.findings.branch).toBe("non_community");
    expect(p.headline).toMatch(/served by/);
    expect(p.summary).toMatch(/non-community/i);
  });
});

describe("buildPrivateWellPayload", () => {
  it("returns a private_well branch payload with the diagnostic preserved", () => {
    const p = buildPrivateWellPayload("custom diagnostic");
    expect(p.findings.branch).toBe("private_well");
    expect(p.findings.branch_metadata.diagnostic_note).toBe("custom diagnostic");
    expect(p.findings.system_card).toBeUndefined();
    expect(p.headline).toMatch(/private well/i);
  });
});

describe("buildStalePayload", () => {
  it("returns a stale branch payload with the diagnostic preserved", () => {
    const p = buildStalePayload("EPA returned empty array");
    expect(p.findings.branch).toBe("stale");
    expect(p.findings.branch_metadata.diagnostic_note).toBe(
      "EPA returned empty array",
    );
    expect(p.findings.system_card).toBeUndefined();
  });
});
