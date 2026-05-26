import { describe, expect, it } from "vitest";
import type { ComplianceSummary } from "./compliance";
import type { LeadCopperSummary } from "./lcr";
import {
  buildRecommendedActions,
  shouldEmitFreeTesting,
  shouldEmitPitcherFilter,
  type RecommendedActionsInputs,
} from "./recommended-actions";

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

function lcrBelow(): LeadCopperSummary {
  return {
    status: "available",
    sampling_period_count: 1,
    most_recent_sampling_period: {
      sampling_end_date: null,
      lead_90th_percentile: {
        value: 0.005,
        unit: "mg/L",
        sign: "=",
        sample_id: "MI381874",
      },
      copper_90th_percentile: null,
    },
  };
}

function lcrApproaching(): LeadCopperSummary {
  return {
    status: "available",
    sampling_period_count: 1,
    most_recent_sampling_period: {
      sampling_end_date: null,
      lead_90th_percentile: {
        value: 0.013,
        unit: "mg/L",
        sign: "=",
        sample_id: "MI390000",
      },
      copper_90th_percentile: null,
    },
  };
}

function lcrAbove(): LeadCopperSummary {
  return {
    status: "available",
    sampling_period_count: 1,
    most_recent_sampling_period: {
      sampling_end_date: null,
      lead_90th_percentile: {
        value: 0.018,
        unit: "mg/L",
        sign: "=",
        sample_id: "MI400000",
      },
      copper_90th_percentile: null,
    },
  };
}

function inputs(
  overrides: Partial<RecommendedActionsInputs> = {},
): RecommendedActionsInputs {
  return {
    compliance: complianceClean(),
    leadCopper: lcrBelow(),
    adminContact: {
      name: "James Baker",
      email: "bakerj@kalamazoocity.org",
      phone: "269-337-8768",
    },
    systemName: "Kalamazoo Public Water Supply",
    ...overrides,
  };
}

describe("shouldEmitPitcherFilter", () => {
  it("returns true on an active health-based violation", () => {
    expect(
      shouldEmitPitcherFilter(inputs({ compliance: complianceActiveHealth() })),
    ).toBe(true);
  });

  it("returns true when LCR shows a value at/above the action level", () => {
    expect(shouldEmitPitcherFilter(inputs({ leadCopper: lcrAbove() }))).toBe(true);
  });

  it("returns true when LCR shows a value approaching (>=80% of) action", () => {
    expect(
      shouldEmitPitcherFilter(inputs({ leadCopper: lcrApproaching() })),
    ).toBe(true);
  });

  it("returns false when compliance is clean and LCR is below approaching", () => {
    expect(shouldEmitPitcherFilter(inputs())).toBe(false);
  });

  it("returns false when LCR is no_samples_on_file and compliance is clean", () => {
    expect(
      shouldEmitPitcherFilter(
        inputs({ leadCopper: { status: "no_samples_on_file" } }),
      ),
    ).toBe(false);
  });
});

describe("shouldEmitFreeTesting", () => {
  it("returns true when admin contact has a phone number", () => {
    expect(shouldEmitFreeTesting(inputs())).toBe(true);
  });

  it("returns false when admin contact is null", () => {
    expect(shouldEmitFreeTesting(inputs({ adminContact: null }))).toBe(false);
  });

  it("returns false when phone is missing or empty", () => {
    expect(
      shouldEmitFreeTesting(
        inputs({
          adminContact: { name: "X", email: null, phone: null },
        }),
      ),
    ).toBe(false);
  });
});

describe("buildRecommendedActions", () => {
  it("emits nothing for a Kalamazoo-like clean profile without admin phone", () => {
    const actions = buildRecommendedActions(
      inputs({ adminContact: null }),
    );
    expect(actions).toEqual([]);
  });

  it("emits just free_testing for a clean utility with admin phone (Kalamazoo today)", () => {
    const actions = buildRecommendedActions(inputs());
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("free_testing");
    expect(actions[0].supporting_line).toContain("James Baker");
    expect(actions[0].supporting_line).toContain("269-337-8768");
    expect(actions[0].supporting_line).toContain(
      "Kalamazoo Public Water Supply",
    );
  });

  it("emits both pitcher_filter and free_testing on active violations", () => {
    const actions = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    );
    expect(actions.map((a) => a.id)).toEqual([
      "pitcher_filter",
      "free_testing",
    ]);
    expect(actions[0].supporting_line).toMatch(
      /active health-based violation/i,
    );
  });

  it("tunes the pitcher_filter copy to the dominant signal", () => {
    const above = buildRecommendedActions(inputs({ leadCopper: lcrAbove() }));
    expect(above[0].supporting_line).toMatch(/at or above the federal/i);
    const approaching = buildRecommendedActions(
      inputs({ leadCopper: lcrApproaching() }),
    );
    expect(approaching[0].supporting_line).toMatch(/inexpensive insurance/i);
  });

  it("omits the admin name from free_testing copy when it's null", () => {
    const actions = buildRecommendedActions(
      inputs({
        adminContact: { name: null, email: null, phone: "555-555-5555" },
      }),
    );
    const ft = actions.find((a) => a.id === "free_testing")!;
    expect(ft.supporting_line).toContain("555-555-5555");
    expect(ft.supporting_line).not.toContain("undefined");
    expect(ft.supporting_line).not.toContain("null");
  });

  it("never emits maintenance_bridge in v1 (deferred to WQA-6)", () => {
    const actions = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    );
    expect(actions.find((a) => a.id === "maintenance_bridge")).toBeUndefined();
  });
});
