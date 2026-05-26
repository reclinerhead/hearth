// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WqaOverviewBody } from "./overview-body";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import type { WqaFindings } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(findings: WqaFindings) {
  const row: HabitatFindingRow = {
    module_key: "water_quality_awareness",
    status: "completed",
    severity: "neutral",
    headline: "",
    summary: "",
    findings: findings as unknown as Record<string, unknown>,
    source_url: null,
    error: null,
    actions: null,
    activity_log: null,
    checked_at: "2026-05-26T00:00:00Z",
  };
  act(() => root.render(<WqaOverviewBody row={row} />));
}

function text(): string {
  return container.textContent ?? "";
}

/* -------- shared fixtures -------- */

function cwsNoCcrFindings(overrides: Partial<WqaFindings> = {}): WqaFindings {
  return {
    branch: "cws_no_ccr",
    system_card: {
      pws_name: "Kalamazoo Public Water Supply",
      pwsid: "MI0003520",
      description: "Groundwater system on file with EPA.",
      source_type: "groundwater",
      compliance_status_short: "no_active_violations",
      pwsid_confidence: "verified",
      latest_ccr_status: "not_uploaded",
      source_water_protection_since: null,
      recent_violations: {
        total_in_last_5_years: 6,
        health_based_in_last_5_years: 0,
        most_recent: null,
      },
    },
    lead_copper_summary: {
      status: "available",
      sampling_period_count: 17,
      most_recent_sampling_period: {
        sampling_end_date: null,
        lead_90th_percentile: {
          value: 0.0053,
          unit: "mg/L",
          sign: "=",
          sample_id: "MI381874",
        },
        copper_90th_percentile: null,
      },
    },
    recommended_actions: [
      {
        id: "free_testing",
        icon: "phone",
        headline: "Ask your utility about free residential testing",
        supporting_line:
          "Call James Baker at 269-337-8768 to ask if Kalamazoo PWS offers free testing.",
      },
    ],
    branch_metadata: {
      branch: "cws_no_ccr",
      is_active: true,
      system_type: "CWS",
      admin_contact: {
        name: "James Baker",
        email: "bakerj@kalamazoocity.org",
        phone: "269-337-8768",
      },
    },
    ...overrides,
  };
}

/* -------- tests -------- */

describe("WqaOverviewBody — cws_no_ccr verified (Kalamazoo happy path)", () => {
  it("renders the system card with PWSID and 3-stat grid", () => {
    render(cwsNoCcrFindings());
    expect(text()).toContain("Kalamazoo Public Water Supply");
    expect(text()).toContain("MI0003520");
    expect(text()).toContain("No active violations");
    expect(text()).toContain("Not yet uploaded");
    expect(text()).toContain("Groundwater");
  });

  it("renders the recommended-actions section with the action headline", () => {
    render(cwsNoCcrFindings());
    expect(text()).toContain("Recommended for your situation");
    expect(text()).toContain(
      "Ask your utility about free residential testing",
    );
  });

  it("renders the provenance line below the supporting_line when present", () => {
    const findings = cwsNoCcrFindings();
    findings.recommended_actions = [
      {
        id: "free_testing",
        icon: "phone",
        headline: "Ask your utility about free residential testing",
        supporting_line: "Call James Baker at 269-337-8768.",
        provenance:
          "James Baker is listed as Kalamazoo PWS's administrator of record on EPA's Envirofacts WATER_SYSTEM file.",
      },
    ];
    render(findings);
    expect(text()).toContain("administrator of record");
    expect(text()).toContain("Envirofacts");
  });

  it("does NOT render provenance when the field is absent (e.g. pitcher_filter)", () => {
    const findings = cwsNoCcrFindings();
    findings.recommended_actions = [
      {
        id: "pitcher_filter",
        icon: "droplet",
        headline: "Consider a faucet-mount or pitcher filter",
        supporting_line: "Whatever supporting copy.",
      },
    ];
    render(findings);
    expect(text()).not.toContain("administrator of record");
  });

  it("renders Detected in your water with the lead row and a Context tier badge", () => {
    render(cwsNoCcrFindings());
    expect(text()).toContain("Detected in your water");
    expect(text()).toContain("Lead");
    // 0.0053 < 80% of 0.015 (= 0.012) → Context tier
    expect(text()).toContain("Context");
    expect(text()).toContain("0.0053");
    expect(text()).toContain("MI381874");
  });

  it("renders the sources block with EPA pills", () => {
    render(cwsNoCcrFindings());
    expect(text()).toContain("Sources");
    expect(text()).toContain("EPA Envirofacts (WATER_SYSTEM)");
    expect(text()).toContain("EPA SDWIS Violations");
    expect(text()).toContain("EPA SDWIS Lead and Copper Samples");
    expect(text()).toContain("Consumer Confidence Report");
  });

  it("does NOT render the inferred-PWSID caveat for verified confidence", () => {
    render(cwsNoCcrFindings());
    expect(text()).not.toContain("We inferred this match");
  });
});

describe("WqaOverviewBody — cws_no_ccr inferred (the 604 Norton case)", () => {
  it("renders the inferred header strip with disabled confirm/correct buttons", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    expect(text()).toContain(
      "We think your home is served by Kalamazoo Public Water Supply",
    );
    expect(text()).toContain("Yes, that’s right");
    expect(text()).toContain("No, my utility is different");
  });

  it("renders the inferred-match caveat at the bottom of the system card description", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    expect(text()).toContain("We inferred this match");
  });
});

describe("WqaOverviewBody — cws_no_ccr with active health violation", () => {
  it("Compliance stat reads 'Active violation: Lead' when recent_violations names it", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.compliance_status_short = "active_violations";
    findings.system_card!.recent_violations = {
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
    };
    render(findings);
    expect(text()).toContain("Active violation: Lead");
  });
});

describe("WqaOverviewBody — cws_no_ccr with above-action LCR", () => {
  it("renders the Worth acting on tier badge", () => {
    const findings = cwsNoCcrFindings();
    findings.lead_copper_summary = {
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
    render(findings);
    expect(text()).toContain("Worth acting on");
  });
});

describe("WqaOverviewBody — cws_no_ccr with approaching LCR", () => {
  it("renders the Worth knowing tier badge", () => {
    const findings = cwsNoCcrFindings();
    findings.lead_copper_summary = {
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
    render(findings);
    expect(text()).toContain("Worth knowing");
  });
});

describe("WqaOverviewBody — LCR empty states", () => {
  it("renders the no-samples-on-file copy when status is no_samples_on_file", () => {
    const findings = cwsNoCcrFindings();
    findings.lead_copper_summary = { status: "no_samples_on_file" };
    render(findings);
    expect(text()).toContain(
      "EPA doesn't have lead-and-copper sample results on file",
    );
  });

  it("renders the unavailable copy when LCR fetch failed", () => {
    const findings = cwsNoCcrFindings();
    findings.lead_copper_summary = { status: "unavailable" };
    render(findings);
    expect(text()).toContain(
      "couldn't read your utility's lead-and-copper samples",
    );
  });
});

describe("WqaOverviewBody — cws_unmapped", () => {
  it("renders the unmapped header strip with disabled CCR upload affordance", () => {
    const findings: WqaFindings = {
      branch: "cws_unmapped",
      branch_metadata: {
        branch: "cws_unmapped",
        is_active: true,
        system_type: null,
        admin_contact: null,
        diagnostic_note: "test diagnostic",
      },
    };
    render(findings);
    expect(text()).toContain(
      "We couldn't pinpoint your utility on EPA's map",
    );
    expect(text()).toContain("Upload your Water Quality Report");
  });

  it("does NOT render the system card or sources block on cws_unmapped", () => {
    const findings: WqaFindings = {
      branch: "cws_unmapped",
      branch_metadata: {
        branch: "cws_unmapped",
        is_active: true,
        system_type: null,
        admin_contact: null,
      },
    };
    render(findings);
    expect(text()).not.toContain("Your water system");
    expect(text()).not.toContain("Sources");
    expect(text()).not.toContain("Detected in your water");
  });
});

describe("WqaOverviewBody — private_well", () => {
  it("renders the private-water-system framing with testing-cadence callout", () => {
    const findings: WqaFindings = {
      branch: "private_well",
      branch_metadata: {
        branch: "private_well",
        is_active: false,
        system_type: null,
        admin_contact: null,
      },
    };
    render(findings);
    expect(text()).toContain("Your home is on a private water system");
    expect(text()).toContain("testing is your responsibility");
    expect(text()).not.toContain("Your water system");
    expect(text()).not.toContain("Sources");
  });
});

describe("WqaOverviewBody — non_community", () => {
  it("renders the non-community framing in the header strip", () => {
    const findings: WqaFindings = {
      branch: "non_community",
      system_card: {
        pws_name: "Some Camp Water System",
        pwsid: "MI9999999",
        description: "Non-community water system.",
        source_type: "groundwater",
        compliance_status_short: "no_active_violations",
        pwsid_confidence: "verified",
        latest_ccr_status: "not_uploaded",
        source_water_protection_since: null,
      },
      branch_metadata: {
        branch: "non_community",
        is_active: true,
        system_type: "TNCWS",
        admin_contact: null,
      },
    };
    render(findings);
    expect(text()).toContain("non-community water system");
    expect(text()).toContain("Some Camp Water System");
  });
});

describe("WqaOverviewBody — stale", () => {
  it("renders the try-again-later framing with the diagnostic detail", () => {
    const findings: WqaFindings = {
      branch: "stale",
      branch_metadata: {
        branch: "stale",
        is_active: false,
        system_type: null,
        admin_contact: null,
        diagnostic_note: "pws_activity_code='I'",
      },
    };
    render(findings);
    expect(text()).toContain("We had trouble reading your utility");
    expect(text()).toContain("pws_activity_code='I'");
  });
});
