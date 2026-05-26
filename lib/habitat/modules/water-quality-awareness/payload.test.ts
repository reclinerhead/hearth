import { describe, expect, it } from "vitest";
import type { ComplianceSummary } from "./compliance";
import type { LeadCopperSummary } from "./lcr";
import {
  buildCwsSummary,
  buildCwsUnmappedPayload,
  buildDescription,
  buildPrivateWellPayload,
  buildStalePayload,
  buildSystemPayload,
  deriveSeverity,
  displaySystemName,
  formatAdminName,
  mapSourceType,
  titleCase,
  type SdwisEnrichment,
} from "./payload";
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";

function complianceClean(): ComplianceSummary {
  return {
    status: "no_active_violations",
    has_active_health_based: false,
    has_active_non_health_based: false,
    recent: {
      total_in_last_5_years: 0,
      health_based_in_last_5_years: 0,
      most_recent: null,
    },
  };
}

function complianceActiveHealth(): ComplianceSummary {
  return {
    status: "active_violations",
    has_active_health_based: true,
    has_active_non_health_based: false,
    recent: {
      total_in_last_5_years: 1,
      health_based_in_last_5_years: 1,
      most_recent: {
        contaminant_name: "Lead",
        contaminant_code: "5000",
        violation_type: "MCL",
        is_health_based: true,
        first_reported_date: "2025-01-01T00:00:00Z",
        returned_to_compliance_date: null,
      },
    },
  };
}

const lcrAvailableBelow: LeadCopperSummary = {
  status: "available",
  sampling_period_count: 1,
  most_recent_sampling_period: {
    sampling_end_date: "2024-06-30T00:00:00Z",
    lead_90th_percentile: { value: 0.003, unit: "MG/L", sign: "=" },
    copper_90th_percentile: { value: 0.2, unit: "MG/L", sign: "=" },
  },
};

const lcrAbove: LeadCopperSummary = {
  status: "available",
  sampling_period_count: 1,
  most_recent_sampling_period: {
    sampling_end_date: "2024-06-30T00:00:00Z",
    lead_90th_percentile: { value: 0.018, unit: "MG/L", sign: "=" },
    copper_90th_percentile: null,
  },
};

const lcrApproaching: LeadCopperSummary = {
  status: "available",
  sampling_period_count: 1,
  most_recent_sampling_period: {
    sampling_end_date: "2024-06-30T00:00:00Z",
    lead_90th_percentile: { value: 0.013, unit: "MG/L", sign: "=" },
    copper_90th_percentile: null,
  },
};

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

describe("deriveSeverity", () => {
  it("returns concern when there's an active health-based violation", () => {
    expect(
      deriveSeverity({
        compliance: complianceActiveHealth(),
        leadCopper: lcrAvailableBelow,
      }),
    ).toBe("concern");
  });

  it("returns concern when LCR shows a value above the action level", () => {
    expect(
      deriveSeverity({
        compliance: complianceClean(),
        leadCopper: lcrAbove,
      }),
    ).toBe("concern");
  });

  it("returns caution when only a non-health-based violation is active", () => {
    expect(
      deriveSeverity({
        compliance: {
          ...complianceClean(),
          has_active_non_health_based: true,
        },
        leadCopper: { status: "no_samples_on_file" },
      }),
    ).toBe("caution");
  });

  it("returns caution when an LCR measurement is approaching the action level", () => {
    expect(
      deriveSeverity({
        compliance: complianceClean(),
        leadCopper: lcrApproaching,
      }),
    ).toBe("caution");
  });

  it("returns favorable only when compliance is clean AND LCR is below action level", () => {
    expect(
      deriveSeverity({
        compliance: complianceClean(),
        leadCopper: lcrAvailableBelow,
      }),
    ).toBe("favorable");
  });

  it("returns neutral when LCR is unavailable / no_samples_on_file even with clean compliance", () => {
    expect(
      deriveSeverity({
        compliance: complianceClean(),
        leadCopper: { status: "no_samples_on_file" },
      }),
    ).toBe("neutral");
    expect(
      deriveSeverity({
        compliance: complianceClean(),
        leadCopper: { status: "unavailable" },
      }),
    ).toBe("neutral");
  });

  it("returns neutral when compliance is null (degraded run)", () => {
    expect(
      deriveSeverity({
        compliance: null,
        leadCopper: lcrAvailableBelow,
      }),
    ).toBe("neutral");
  });
});

describe("buildSystemPayload — with SDWIS enrichment", () => {
  it("surfaces compliance_status_short and recent_violations on the system_card when compliance is populated", () => {
    const enrichment: SdwisEnrichment = {
      compliance: complianceClean(),
      leadCopper: lcrAvailableBelow,
    };
    const p = buildSystemPayload("cws_no_ccr", kalamazoo(), enrichment);
    expect(p.findings.system_card?.compliance_status_short).toBe(
      "no_active_violations",
    );
    expect(p.findings.system_card?.recent_violations).toBeDefined();
    expect(p.findings.system_card?.recent_violations?.total_in_last_5_years).toBe(0);
  });

  it("attaches the lead_copper_summary onto the findings payload", () => {
    const enrichment: SdwisEnrichment = {
      compliance: complianceClean(),
      leadCopper: lcrAvailableBelow,
    };
    const p = buildSystemPayload("cws_no_ccr", kalamazoo(), enrichment);
    expect(p.findings.lead_copper_summary?.status).toBe("available");
  });

  it("leaves compliance_status_short as unknown when compliance is null (degraded)", () => {
    const enrichment: SdwisEnrichment = {
      compliance: null,
      leadCopper: { status: "unavailable" },
    };
    const p = buildSystemPayload("cws_no_ccr", kalamazoo(), enrichment);
    expect(p.findings.system_card?.compliance_status_short).toBe("unknown");
    expect(p.findings.system_card?.recent_violations).toBeUndefined();
    expect(p.findings.lead_copper_summary?.status).toBe("unavailable");
  });

  it("computes a favorable severity for clean compliance + below-action LCR", () => {
    const enrichment: SdwisEnrichment = {
      compliance: complianceClean(),
      leadCopper: lcrAvailableBelow,
    };
    const p = buildSystemPayload("cws_no_ccr", kalamazoo(), enrichment);
    expect(p.severity).toBe("favorable");
  });

  it("computes a concern severity when LCR shows above the action level", () => {
    const enrichment: SdwisEnrichment = {
      compliance: complianceClean(),
      leadCopper: lcrAbove,
    };
    const p = buildSystemPayload("cws_no_ccr", kalamazoo(), enrichment);
    expect(p.severity).toBe("concern");
  });
});

describe("buildCwsSummary", () => {
  it("mentions clean compliance and below-action LCR values when both are present", () => {
    const summary = buildCwsSummary("Kalamazoo Public Water Supply", {
      compliance: complianceClean(),
      leadCopper: lcrAvailableBelow,
    });
    expect(summary).toMatch(/no violations/i);
    expect(summary).toMatch(/lead below the federal action level/i);
  });

  it("mentions active health-based violation when compliance is dirty", () => {
    const summary = buildCwsSummary("Kalamazoo Public Water Supply", {
      compliance: complianceActiveHealth(),
      leadCopper: { status: "no_samples_on_file" },
    });
    expect(summary).toMatch(/active health-based violation/i);
  });

  it("falls back to a still-working line when compliance is null", () => {
    const summary = buildCwsSummary("Kalamazoo Public Water Supply", {
      compliance: null,
      leadCopper: { status: "unavailable" },
    });
    expect(summary).toMatch(/still working on reading EPA/i);
  });

  it("notes when EPA has no LCR samples on file", () => {
    const summary = buildCwsSummary("Kalamazoo Public Water Supply", {
      compliance: complianceClean(),
      leadCopper: { status: "no_samples_on_file" },
    });
    expect(summary).toMatch(/doesn't have lead-and-copper sample results on file/i);
  });
});

describe("buildPrivateWellPayload", () => {
  it("returns a private_well branch payload with the diagnostic preserved (epa-inferred default)", () => {
    const p = buildPrivateWellPayload("custom diagnostic");
    expect(p.findings.branch).toBe("private_well");
    expect(p.findings.branch_metadata.diagnostic_note).toBe("custom diagnostic");
    expect(p.findings.system_card).toBeUndefined();
    expect(p.headline).toMatch(/private well/i);
  });

  it("uses confident copy when source='user-declared'", () => {
    const p = buildPrivateWellPayload("custom diagnostic", "user-declared");
    expect(p.headline).toBe("Your home is on a private water system");
    expect(p.summary).toMatch(/Based on what you told us during onboarding/i);
    expect(p.summary).not.toMatch(/usually means/i);
  });

  it("uses probabilistic copy when source='epa-inferred'", () => {
    const p = buildPrivateWellPayload("custom diagnostic", "epa-inferred");
    expect(p.headline).toBe("You're likely on a private well");
    expect(p.summary).toMatch(/usually means you're on a private well/i);
  });
});

describe("buildCwsUnmappedPayload", () => {
  it("returns a cws_unmapped branch payload with the diagnostic preserved", () => {
    const p = buildCwsUnmappedPayload("EPA polygon coverage gap diagnostic");
    expect(p.findings.branch).toBe("cws_unmapped");
    expect(p.findings.branch_metadata.diagnostic_note).toBe(
      "EPA polygon coverage gap diagnostic",
    );
    expect(p.findings.branch_metadata.is_active).toBe(true);
    expect(p.findings.system_card).toBeUndefined();
    expect(p.severity).toBe("neutral");
    expect(p.headline).toMatch(/couldn't pinpoint your water utility/i);
    expect(p.summary).toMatch(/you're on city water/i);
    expect(p.summary).toMatch(/Water Quality Report/i);
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
