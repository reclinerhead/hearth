import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_RECENT_YEARS,
  countUnmappedContaminants,
  isActiveViolation,
  isHealthBased,
  summarizeCompliance,
  violationReportedAt,
} from "./compliance";
import type { SdwisViolationRecord } from "./sources/sdwis-violations";

const NOW = new Date("2026-05-26T00:00:00Z");

function violation(
  overrides: Partial<SdwisViolationRecord> = {},
): SdwisViolationRecord {
  return {
    pwsid: "MI0003520",
    violation_id: "VIO-1",
    violation_code: "20",
    violation_category_code: "MR",
    is_health_based_ind: "N",
    contaminant_code: "5000",
    viol_first_reported_date: "2024-01-01T00:00:00Z",
    rtc_date: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("isActiveViolation", () => {
  it("treats a missing rtc_date as active", () => {
    expect(isActiveViolation(violation({ rtc_date: null }), NOW)).toBe(true);
  });

  it("treats a past rtc_date as resolved (not active)", () => {
    expect(
      isActiveViolation(
        violation({ rtc_date: "2024-06-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("treats a future rtc_date as still active", () => {
    expect(
      isActiveViolation(
        violation({ rtc_date: "2027-06-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe(true);
  });

  it("treats an unparseable rtc_date as active (defensive)", () => {
    expect(
      isActiveViolation(violation({ rtc_date: "not-a-date" }), NOW),
    ).toBe(true);
  });
});

describe("isHealthBased", () => {
  it("returns true only for Y", () => {
    expect(isHealthBased(violation({ is_health_based_ind: "Y" }))).toBe(true);
    expect(isHealthBased(violation({ is_health_based_ind: "N" }))).toBe(false);
    expect(isHealthBased(violation({ is_health_based_ind: null }))).toBe(false);
  });
});

describe("violationReportedAt", () => {
  it("prefers viol_first_reported_date when present", () => {
    const d = violationReportedAt(
      violation({
        viol_first_reported_date: "2024-01-15T00:00:00Z",
        compl_per_begin_date: "2023-01-01T00:00:00Z",
      }),
    );
    expect(d?.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("falls back to compl_per_begin_date", () => {
    const d = violationReportedAt(
      violation({
        viol_first_reported_date: null,
        compl_per_begin_date: "2023-01-01T00:00:00Z",
      }),
    );
    expect(d?.toISOString()).toBe("2023-01-01T00:00:00.000Z");
  });

  it("returns null when both dates are missing", () => {
    expect(
      violationReportedAt(
        violation({
          viol_first_reported_date: null,
          compl_per_begin_date: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("summarizeCompliance", () => {
  it("returns no_active_violations for an empty list", () => {
    const s = summarizeCompliance([], NOW);
    expect(s.status).toBe("no_active_violations");
    expect(s.recent.total_in_last_5_years).toBe(0);
    expect(s.recent.most_recent).toBeNull();
  });

  it("returns active_violations when at least one health-based violation has no rtc_date", () => {
    const s = summarizeCompliance(
      [
        violation({
          violation_id: "V1",
          is_health_based_ind: "Y",
          rtc_date: null,
          viol_first_reported_date: "2025-08-01T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(s.status).toBe("active_violations");
    expect(s.has_active_health_based).toBe(true);
  });

  it("returns no_active_violations when only non-health-based active violations exist", () => {
    const s = summarizeCompliance(
      [
        violation({
          violation_id: "V1",
          is_health_based_ind: "N",
          rtc_date: null,
        }),
      ],
      NOW,
    );
    expect(s.status).toBe("no_active_violations");
    expect(s.has_active_non_health_based).toBe(true);
  });

  it("counts only violations in the last 5 years for the recent block", () => {
    const s = summarizeCompliance(
      [
        violation({
          violation_id: "OLD",
          viol_first_reported_date: "2015-01-01T00:00:00Z",
        }),
        violation({
          violation_id: "RECENT",
          viol_first_reported_date: "2024-01-01T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(s.recent.total_in_last_5_years).toBe(1);
  });

  it("uses 5 years as the recent window", () => {
    expect(COMPLIANCE_RECENT_YEARS).toBe(5);
  });

  it("picks the most recent violation for the recent block and surfaces its contaminant name", () => {
    const s = summarizeCompliance(
      [
        violation({
          violation_id: "V1",
          viol_first_reported_date: "2024-01-01T00:00:00Z",
          contaminant_code: "1005",
        }),
        violation({
          violation_id: "V2",
          viol_first_reported_date: "2025-08-15T00:00:00Z",
          contaminant_code: "5000",
        }),
      ],
      NOW,
    );
    expect(s.recent.most_recent?.contaminant_name).toBe("Lead");
    expect(s.recent.most_recent?.contaminant_code).toBe("5000");
  });

  it("renders an unmapped code as a stable fallback", () => {
    const s = summarizeCompliance(
      [
        violation({
          violation_id: "V1",
          viol_first_reported_date: "2025-01-01T00:00:00Z",
          contaminant_code: "9999",
        }),
      ],
      NOW,
    );
    expect(s.recent.most_recent?.contaminant_name).toBe("Contaminant code 9999");
  });
});

describe("countUnmappedContaminants", () => {
  it("counts distinct unmapped codes once", () => {
    expect(
      countUnmappedContaminants([
        violation({ violation_id: "V1", contaminant_code: "9999" }),
        violation({ violation_id: "V2", contaminant_code: "9999" }),
        violation({ violation_id: "V3", contaminant_code: "5000" }),
      ]),
    ).toBe(1);
  });
  it("returns 0 when every code is mapped", () => {
    expect(
      countUnmappedContaminants([
        violation({ violation_id: "V1", contaminant_code: "5000" }),
        violation({ violation_id: "V2", contaminant_code: "1022" }),
      ]),
    ).toBe(0);
  });
});
