import { describe, expect, it } from "vitest";
import type { ComplianceSummary } from "./compliance";
import type { LeadCopperSummary } from "./lcr";
import {
  buildRecommendedActions,
  shouldEmitFreeTesting,
  shouldEmitMaintenanceBridge,
  shouldEmitPitcherFilter,
  type RecommendedActionsInputs,
} from "./recommended-actions";
import type { WaterProperties } from "./water-properties";

function hardWaterWithIron(): WaterProperties {
  return {
    hardness: {
      mg_l_caco3: 140,
      grains_per_gallon: 8.2,
      classification: "hard",
      raw_label: "140 mg/L",
    },
    iron: { detected: true, mg_l: 0.4, raw_label: "0.4 mg/L" },
    manganese: null,
    affects_maintenance: true,
  };
}

function softWater(): WaterProperties {
  return {
    hardness: {
      mg_l_caco3: 40,
      grains_per_gallon: 2.3,
      classification: "soft",
      raw_label: "40 mg/L",
    },
    iron: null,
    manganese: null,
    affects_maintenance: false,
  };
}

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

function lcrBelowDetection(): LeadCopperSummary {
  return {
    status: "available",
    sampling_period_count: 1,
    most_recent_sampling_period: {
      sampling_end_date: null,
      lead_90th_percentile: {
        value: 0.001,
        unit: "mg/L",
        sign: "<",
        sample_id: "MI381874",
      },
      copper_90th_percentile: null,
    },
  };
}

function lcrDetected(): LeadCopperSummary {
  // Positive but below the 80% approaching threshold — Kalamazoo's
  // recent lead value (~35% of action level). Under #188 this drives
  // caution severity and emits the pitcher_filter recommendation.
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
    leadCopper: lcrBelowDetection(),
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

  it("returns true when LCR has any detected lead/copper below approaching (issue #188)", () => {
    // Any detection — not just approaching — emits the filter card.
    // Hearth's framing: EPA's action level is a regulatory threshold,
    // not a health-safety one.
    expect(
      shouldEmitPitcherFilter(inputs({ leadCopper: lcrDetected() })),
    ).toBe(true);
  });

  it("returns false when compliance is clean and every LCR sample is below detection", () => {
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
    // Sub-approaching detected: the #188 tier. Distinct copy that
    // explicitly frames "any presence is worth knowing about."
    const detected = buildRecommendedActions(
      inputs({ leadCopper: lcrDetected() }),
    );
    expect(detected[0].id).toBe("pitcher_filter");
    expect(detected[0].supporting_line).toMatch(/any presence is worth knowing/i);
    expect(detected[0].supporting_line).toMatch(/sub-regulatory/i);
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

  it("does not emit maintenance_bridge when no water properties are present", () => {
    const actions = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    );
    expect(actions.find((a) => a.id === "maintenance_bridge")).toBeUndefined();
  });

  it("free_testing carries a provenance line attributing the contact to EPA Envirofacts", () => {
    const actions = buildRecommendedActions(inputs());
    const ft = actions.find((a) => a.id === "free_testing")!;
    expect(ft.provenance).toBeDefined();
    expect(ft.provenance).toContain("James Baker");
    expect(ft.provenance).toContain("administrator of record");
    expect(ft.provenance).toContain("Envirofacts");
  });

  it("free_testing provenance degrades gracefully when admin name is null", () => {
    const actions = buildRecommendedActions(
      inputs({
        adminContact: { name: null, email: null, phone: "555-555-5555" },
      }),
    );
    const ft = actions.find((a) => a.id === "free_testing")!;
    expect(ft.provenance).toBeDefined();
    expect(ft.provenance).not.toContain("null");
    expect(ft.provenance).toContain("Envirofacts");
  });

  it("pitcher_filter does NOT carry a provenance line (no personal data to attribute)", () => {
    const actions = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    );
    const pf = actions.find((a) => a.id === "pitcher_filter")!;
    expect(pf.provenance).toBeUndefined();
  });

  it("uses 'phone' for the free_testing icon (must exist in components/icon.tsx)", () => {
    const ft = buildRecommendedActions(inputs()).find(
      (a) => a.id === "free_testing",
    )!;
    expect(ft.icon).toBe("phone");
  });

  it("uses 'droplet' for the pitcher_filter icon on the LCR-fallback path", () => {
    const pf = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    ).find((a) => a.id === "pitcher_filter")!;
    expect(pf.icon).toBe("droplet");
  });

  it("attaches the remediation-matrix CTA to the pitcher_filter card", () => {
    const pf = buildRecommendedActions(
      inputs({ compliance: complianceActiveHealth() }),
    ).find((a) => a.id === "pitcher_filter")!;
    expect(pf.matrix_cta).toBe("See your full remediation matrix");
    // The card no longer carries an external link — the matrix view
    // owns the NSF explainer + certified-product browse link.
    expect(pf.link).toBeUndefined();
  });
});

describe("buildRecommendedActions — contaminant-specific filter (WQA-5)", () => {
  const KALAMAZOO_DETECTED = [
    { name: "Lead", level_label: "9 ppb" },
    { name: "PFOA", level_label: "2.2 ng/L" },
    { name: "PFOS", level_label: "4.0 ng/L" },
    { name: "Total Trihalomethanes (TTHMs)", level_label: "28.5 ppb" },
    { name: "Haloacetic Acids (HAA5)", level_label: "16.2 ppb" },
    { name: "1,2-Dichloroethane", level_label: "trace" },
    { name: "cis-1,2-Dichloroethylene", level_label: "trace" },
    { name: "Fluoride", level_label: "0.68 ppm" },
  ];

  it("any CCR detection emits the pitcher_filter card even with clean compliance", () => {
    expect(
      shouldEmitPitcherFilter(
        inputs({ detectedContaminants: [{ name: "Fluoride" }] }),
      ),
    ).toBe(true);
  });

  it("names the under-sink carbon block + P473 and covers 5 of 6 for Kalamazoo", () => {
    const actions = buildRecommendedActions(
      inputs({ detectedContaminants: KALAMAZOO_DETECTED }),
    );
    const pf = actions.find((a) => a.id === "pitcher_filter")!;
    expect(pf.icon).toBe("filter");
    expect(pf.headline).toBe(
      "Install a NSF/ANSI 53 + NSF P473 certified under-sink filter",
    );
    expect(pf.supporting_line).toContain("5 of the 6 detected contaminants");
    expect(pf.supporting_line).toContain("Lead");
    expect(pf.supporting_line).toContain("PFAS (PFOA, PFOS)");
    // Lead caveat present because lead is in the covered set.
    expect(pf.supporting_line).toMatch(/whole-house filters can't help with lead/i);
    expect(pf.matrix_cta).toBe("See your full remediation matrix");
  });

  it("drops P473 from the headline when no PFAS is detected", () => {
    const actions = buildRecommendedActions(
      inputs({ detectedContaminants: [{ name: "Lead", level_label: "9 ppb" }] }),
    );
    const pf = actions.find((a) => a.id === "pitcher_filter")!;
    expect(pf.headline).toBe(
      "Install a NSF/ANSI 53 certified under-sink filter",
    );
    expect(pf.headline).not.toContain("P473");
    expect(pf.supporting_line).toContain("all of the detected contaminants");
  });

  it("falls back to LCR copy when detected contaminants don't map (copper-only)", () => {
    const actions = buildRecommendedActions(
      inputs({
        detectedContaminants: [{ name: "Copper", level_label: "0.1 mg/L" }],
        leadCopper: lcrDetected(),
      }),
    );
    const pf = actions.find((a) => a.id === "pitcher_filter")!;
    // No matrix row for copper → the contaminant-specific builder
    // returns null and we use the tier-tuned faucet/pitcher copy.
    expect(pf.icon).toBe("droplet");
    expect(pf.headline).toBe("Consider a faucet-mount or pitcher filter");
    expect(pf.matrix_cta).toBe("See your full remediation matrix");
  });
});

describe("buildRecommendedActions — maintenance bridge / AUTOMATIC card (WQA-6)", () => {
  it("shouldEmitMaintenanceBridge follows affects_maintenance", () => {
    expect(
      shouldEmitMaintenanceBridge(inputs({ waterProperties: hardWaterWithIron() })),
    ).toBe(true);
    expect(
      shouldEmitMaintenanceBridge(inputs({ waterProperties: softWater() })),
    ).toBe(false);
    expect(shouldEmitMaintenanceBridge(inputs({ waterProperties: null }))).toBe(
      false,
    );
    expect(shouldEmitMaintenanceBridge(inputs())).toBe(false);
  });

  it("emits an AUTOMATIC maintenance_bridge card naming the water properties", () => {
    const actions = buildRecommendedActions(
      inputs({ waterProperties: hardWaterWithIron() }),
    );
    const bridge = actions.find((a) => a.id === "maintenance_bridge")!;
    expect(bridge).toBeDefined();
    expect(bridge.automatic).toBe(true);
    expect(bridge.icon).toBe("tool");
    expect(bridge.supporting_line).toMatch(/hard water/i);
    expect(bridge.supporting_line).toMatch(/iron/i);
    expect(bridge.link).toEqual({
      label: "See your maintenance plan",
      url: "/maintenance",
    });
  });

  it("places the maintenance_bridge card last in the order", () => {
    const actions = buildRecommendedActions(
      inputs({
        compliance: complianceActiveHealth(),
        waterProperties: hardWaterWithIron(),
      }),
    );
    expect(actions.map((a) => a.id)).toEqual([
      "pitcher_filter",
      "free_testing",
      "maintenance_bridge",
    ]);
  });

  it("does not emit the card for soft water with no metals", () => {
    const actions = buildRecommendedActions(
      inputs({ waterProperties: softWater() }),
    );
    expect(actions.find((a) => a.id === "maintenance_bridge")).toBeUndefined();
  });
});
