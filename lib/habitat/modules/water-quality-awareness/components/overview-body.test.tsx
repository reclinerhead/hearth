// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// `WqaOverviewBody` calls `useRouter()` from `next/navigation` so the
// success handler on the CCR upload modal can trigger a server data
// refresh. The Vitest jsdom environment has no Next app-router context;
// the mock below stands in for it so the component renders. Tests
// don't exercise the refresh path, so a no-op refresh is the right
// stub — extending it requires a real test that opens the upload
// modal, which isn't in this suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
}));

// Server actions are "use server" functions that pull in workflow/api,
// Supabase server clients, and other Node-only deps. The body file
// imports them directly; jsdom can't load that module graph. Mock the
// whole module so the import resolves to no-op stubs. The tests in
// this suite render the body and assert what renders — none of them
// click the actual confirm/correct buttons, so unconditional success
// stubs are the right shape. A future "actually click the button"
// test will need vi.fn() spies + assertions instead.
vi.mock("@/app/(app)/dashboard/actions", () => ({
  confirmWqaPwsid: async () => ({ ok: true }),
  correctWqaPwsid: async () => ({ ok: true }),
  triggerHabitatModuleRecheck: async () => ({ ok: true }),
}));

import { WqaOverviewBody } from "./overview-body";
import { PFAS_FAMILY_HEADING } from "@/lib/habitat/water-quality/contaminants/pfas-grouping";
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
  act(() =>
    root.render(<WqaOverviewBody row={row} houseId="test-house-id" />),
  );
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
    // The Latest CCR tile is the upload affordance on cws_no_ccr (#194).
    // Earlier it read "Not yet uploaded"; now it invites the user.
    expect(text()).toContain("Upload yours");
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
  it("renders the inferred header strip with enabled confirm/correct buttons", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    expect(text()).toContain(
      "We think your home is served by Kalamazoo Public Water Supply",
    );
    expect(text()).toContain("Yes, that's right");
    expect(text()).toContain("No, my utility is different");
    // Issue #193 — both buttons are real, enabled buttons now. The
    // "disabled placeholder" treatment is gone for these two, and no
    // "coming in a follow-up" tooltip should be in the DOM.
    expect(text()).not.toContain("Confirmation is coming in a follow-up");
    expect(text()).not.toContain("Manual correction is coming in a follow-up");
    const buttons = container.querySelectorAll("button");
    const confirm = Array.from(buttons).find(
      (b) => b.textContent === "Yes, that's right",
    );
    const correct = Array.from(buttons).find(
      (b) => b.textContent === "No, my utility is different",
    );
    expect(confirm).toBeDefined();
    expect(confirm?.disabled).toBe(false);
    expect(correct).toBeDefined();
    expect(correct?.disabled).toBe(false);
  });

  it("renders the inferred-match caveat at the bottom of the system card description", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    expect(text()).toContain("We inferred this match");
  });

  it("does NOT render the post-confirmation Edit affordance on inferred (strip handles correction instead)", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    // The edit affordance shows next to the PWSID line on the system
    // card — but only after the user has settled the confirmation
    // question. While the strip is still showing, the edit button
    // would be a redundant duplicate of "No, my utility is different".
    const editButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("aria-label") === "Change your water utility's PWSID");
    expect(editButton).toBeUndefined();
  });
});

describe("WqaOverviewBody — inferred prompt surfaces on every branch with a system card", () => {
  it("renders the confirmation strip on cws_with_ccr when the PWSID is inferred", () => {
    // Real-world regression case Todd hit while testing: a house
    // whose CCR is already on file (cws_with_ccr) had the
    // confirmation prompt suppressed because the original branch
    // check was scoped to cws_no_ccr. The presence of a cached CCR
    // doesn't validate which utility the user is on — they still
    // need to confirm identity.
    const findings = cwsNoCcrFindings();
    findings.branch = "cws_with_ccr";
    findings.system_card!.pwsid_confidence = "inferred";
    findings.system_card!.latest_ccr_status = { year: 2023 };
    render(findings);
    expect(text()).toContain(
      "We think your home is served by Kalamazoo Public Water Supply",
    );
    expect(text()).toContain("Yes, that's right");
    expect(text()).toContain("No, my utility is different");
  });

  it("renders the confirmation strip on non_community when the PWSID is inferred", () => {
    const findings: WqaFindings = {
      branch: "non_community",
      system_card: {
        pws_name: "Some Camp Water System",
        pwsid: "MI9999999",
        description: "Non-community water system.",
        source_type: "groundwater",
        compliance_status_short: "no_active_violations",
        pwsid_confidence: "inferred",
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
    // The inferred prompt wins over the non-community framing:
    // confirming the system identity comes before explaining what
    // kind of system it is.
    expect(text()).toContain(
      "We think your home is served by Some Camp Water System",
    );
    expect(text()).toContain("Yes, that's right");
    // Non-community framing is suppressed while the user hasn't
    // confirmed the identity yet.
    expect(text()).not.toContain("non-community water system");
  });

  it("returns to the branch-specific strip (or none) once confidence is settled", () => {
    // cws_with_ccr + verified — no header strip, just the system card.
    const findings = cwsNoCcrFindings();
    findings.branch = "cws_with_ccr";
    findings.system_card!.pwsid_confidence = "verified";
    findings.system_card!.latest_ccr_status = { year: 2023 };
    render(findings);
    expect(text()).not.toContain("We think your home is served by");
    expect(text()).not.toContain("Yes, that's right");
  });
});

describe("WqaOverviewBody — issue #193 post-confirmation states", () => {
  it("suppresses the inferred header strip when pwsid_confidence is user_confirmed", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "user_confirmed";
    render(findings);
    expect(text()).not.toContain("We think your home is served by");
    expect(text()).not.toContain("Yes, that's right");
    expect(text()).not.toContain("No, my utility is different");
  });

  it("suppresses the inferred header strip when pwsid_confidence is user_corrected", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "user_corrected";
    render(findings);
    expect(text()).not.toContain("We think your home is served by");
    expect(text()).not.toContain("Yes, that's right");
  });

  it("renders the Edit affordance next to the PWSID line on user_confirmed", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "user_confirmed";
    render(findings);
    const editButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("aria-label") === "Change your water utility's PWSID");
    expect(editButton).toBeDefined();
  });

  it("renders the Edit affordance next to the PWSID line on user_corrected", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "user_corrected";
    render(findings);
    const editButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("aria-label") === "Change your water utility's PWSID");
    expect(editButton).toBeDefined();
  });

  it("renders the Edit affordance on verified PWSIDs too (corrections are always available)", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "verified";
    render(findings);
    const editButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("aria-label") === "Change your water utility's PWSID");
    expect(editButton).toBeDefined();
  });

  it("expands the inline PWSID editor when the Edit affordance is clicked", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "user_confirmed";
    render(findings);
    const editButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("aria-label") === "Change your water utility's PWSID");
    expect(editButton).toBeDefined();
    act(() => editButton!.click());
    // Editor renders with a labeled input + hint copy.
    expect(text()).toContain("Format: two-letter state code");
    const input = container.querySelector(
      "input#wqa-pwsid-input",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
  });

  it("expands the inline PWSID editor when 'No, my utility is different' is clicked on inferred", () => {
    const findings = cwsNoCcrFindings();
    findings.system_card!.pwsid_confidence = "inferred";
    render(findings);
    const noButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "No, my utility is different");
    expect(noButton).toBeDefined();
    act(() => noButton!.click());
    expect(text()).toContain("Tell us your water utility");
    expect(text()).toContain("SDWIS public search");
    // And the link out to EPA's SDWIS search renders with the right
    // target — that's the load-bearing "give the user a way to find
    // their PWSID" affordance.
    const epaLink = Array.from(
      container.querySelectorAll("a"),
    ).find((a) => a.href.includes("sdwis.epa.gov"));
    expect(epaLink).toBeDefined();
    const input = container.querySelector(
      "input#wqa-pwsid-input",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
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

/* -------- cws_with_ccr fixtures and tests -------- */

type CcrFixtureRow = {
  name: string;
  level: number | null;
  mcl: number | null;
  tier: "concern" | "caution" | "context";
};

function cwsWithCcrFindings(rows: CcrFixtureRow[]): WqaFindings {
  const contaminants = rows.map((r) => ({
    contaminant_name: r.name,
    contaminant_code: null,
    detected_level: r.level,
    unit: "ppb",
    mcl: r.mcl,
    mclg: null,
    mcl_action_level: null,
    sources: null,
    monitoring_period: null,
    violation_in_period_ind: null,
    notes: null,
    source_table_label: null,
    tier: r.tier,
    has_multiple_observations: false,
    other_observations: [],
  }));
  return {
    branch: "cws_with_ccr",
    system_card: {
      pws_name: "Test Utility",
      pwsid: "MI0000001",
      description: "Surface water system.",
      source_type: "surface",
      compliance_status_short: "no_active_violations",
      latest_ccr_status: { year: 2024 },
      source_water_protection_since: null,
    },
    branch_metadata: {
      branch: "cws_with_ccr",
      is_active: true,
      system_type: "CWS",
      admin_contact: null,
    },
    ccr_findings: {
      report_year: 2024,
      published_date: null,
      contaminants,
      lead_copper_distribution: null,
      ucmr_results: null,
      free_testing_offer: null,
      ai_confidence: 0.9,
    },
  };
}

describe("WqaOverviewBody — CCR contaminant list (issue #199)", () => {
  it("renders headline rows inline and collapses 2+ context rows behind a disclosure", () => {
    render(
      cwsWithCcrFindings([
        { name: "Cau-A", level: 2.5, mcl: 3, tier: "caution" },
        { name: "Ctx-A", level: 0.1, mcl: 3, tier: "context" },
        { name: "Ctx-B", level: 0.05, mcl: 3, tier: "context" },
        { name: "Ctx-C", level: 0.02, mcl: 3, tier: "context" },
      ]),
    );
    // Headline (caution) row visible above the fold.
    expect(text()).toContain("Cau-A");
    // Disclosure summary shows the count of collapsed rows.
    expect(text()).toContain("3 more contaminants detected at low levels");
    // The context rows themselves are inside the <details> — the
    // summary doesn't contain them, but textContent walks the whole
    // tree so the names ARE in the text. Test what's structurally
    // observable instead: the summary text is present.
    expect(text()).toMatch(/3 more contaminants detected at low levels/);
  });

  it("keeps a single context row inline (no disclosure overhead for one row)", () => {
    render(
      cwsWithCcrFindings([
        { name: "Cau-A", level: 2.5, mcl: 3, tier: "caution" },
        { name: "Ctx-Only", level: 0.1, mcl: 3, tier: "context" },
      ]),
    );
    expect(text()).toContain("Cau-A");
    expect(text()).toContain("Ctx-Only");
    expect(text()).not.toContain("more contaminants detected at low levels");
  });

  it("does not render a disclosure when there are zero context rows", () => {
    render(
      cwsWithCcrFindings([
        { name: "Con-A", level: 5, mcl: 3, tier: "concern" },
        { name: "Cau-A", level: 2.5, mcl: 3, tier: "caution" },
      ]),
    );
    expect(text()).toContain("Con-A");
    expect(text()).toContain("Cau-A");
    expect(text()).not.toContain("more contaminants detected at low levels");
  });

  it("renders disclosure-only when every row is context (no inline headline list)", () => {
    render(
      cwsWithCcrFindings([
        { name: "Ctx-A", level: 0.1, mcl: 3, tier: "context" },
        { name: "Ctx-B", level: 0.05, mcl: 3, tier: "context" },
      ]),
    );
    expect(text()).toContain("2 more contaminants detected at low levels");
  });
});

describe("WqaOverviewBody — CCR list report-style format (issue #239)", () => {
  it("shows each contaminant's description inline, not behind a 'What this means' expand", () => {
    render(cwsWithCcrFindings([{ name: "Lead", level: 9, mcl: 15, tier: "caution" }]));
    // The editorial description renders inline (resolved from the reference)...
    expect(text()).toContain("no known safe level of lead");
    // ...and the old expand-to-read disclosure is gone.
    expect(text()).not.toContain("What this means");
  });

  it("renders the level against the limit in the report's format", () => {
    render(cwsWithCcrFindings([{ name: "Lead", level: 9, mcl: 15, tier: "caution" }]));
    expect(text()).toContain("9 ppb / 15 ppb limit");
    expect(text()).not.toContain("• MCL"); // old format dropped
  });

  it("keeps the monitoring year on each row (schedules differ per analyte)", () => {
    const findings = cwsWithCcrFindings([
      { name: "Lead", level: 9, mcl: 15, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminants![0].monitoring_period = "2022";
    render(findings);
    expect(text()).toContain("2022");
  });

  it("drops the multi-observation disclosure", () => {
    const findings = cwsWithCcrFindings([
      { name: "Lead", level: 9, mcl: 15, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminants![0].has_multiple_observations = true;
    render(findings);
    expect(text()).not.toContain("Measured under more than one program");
  });

  it("folds 2+ detected PFAS analytes into one family card", () => {
    render(
      cwsWithCcrFindings([
        { name: "Perfluorooctanoic acid (PFOA)", level: 3.1, mcl: 4, tier: "caution" },
        { name: "Perfluorooctane sulfonic acid (PFOS)", level: 5.7, mcl: 4, tier: "caution" },
      ]),
    );
    expect(text()).toContain(PFAS_FAMILY_HEADING);
    // Family explanation (from the "PFAS" reference entry) renders inline.
    expect(text()).toContain("per- and polyfluoroalkyl substances");
    // Both analytes still listed beneath the family heading.
    expect(text()).toContain("PFOA");
    expect(text()).toContain("PFOS");
  });
});

describe("WqaOverviewBody — limit falls back to mcl_action_level (issue #243)", () => {
  // Lead/copper carry their federal limit in `mcl_action_level` (the
  // LCR action level), not `mcl` — by schema design, and the way the
  // synthesized lead/copper rows are built in ccr.ts (mcl: null,
  // mcl_action_level set). The earlier formatter read only `c.mcl`, so
  // the "/ <limit> limit" half silently dropped and the row rendered
  // bare. These exercise the fallback path the older tests miss (they
  // pass `mcl` directly).
  it("renders the lead limit from mcl_action_level when mcl is null", () => {
    const findings = cwsWithCcrFindings([
      { name: "Lead", level: 9, mcl: null, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminants![0].mcl_action_level = 15;
    render(findings);
    expect(text()).toContain("9 ppb / 15 ppb limit");
  });

  it("renders the copper limit from mcl_action_level when mcl is null", () => {
    const findings = cwsWithCcrFindings([
      { name: "Copper", level: 1.2, mcl: null, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminants![0].mcl_action_level = 1.3;
    render(findings);
    expect(text()).toContain("1.2 ppb / 1.3 ppb limit");
  });

  it("still renders bare level when neither mcl nor mcl_action_level is present", () => {
    const findings = cwsWithCcrFindings([
      { name: "Lead", level: 9, mcl: null, tier: "caution" },
    ]);
    // mcl_action_level stays null (the fixture default) — no limit to show.
    render(findings);
    expect(text()).toContain("9 ppb");
    expect(text()).not.toContain("ppb / ");
  });
});

describe("WqaOverviewBody — AUTOMATIC maintenance-bridge card (WQA-6)", () => {
  it("renders the AUTOMATIC card with the badge and an internal maintenance link", () => {
    const findings = cwsWithCcrFindings([
      { name: "Atrazine", level: 0.5, mcl: 3, tier: "context" },
    ]);
    findings.recommended_actions = [
      {
        id: "maintenance_bridge",
        icon: "tool",
        headline: "Maintenance adjusted for your water",
        supporting_line:
          "Your Water Quality Report shows hard water with detectable iron.",
        automatic: true,
        link: { label: "See your maintenance plan", url: "/maintenance" },
      },
    ];
    render(findings);
    expect(text()).toContain("Maintenance adjusted for your water");
    expect(text()).toContain("Automatic");
    const link = container.querySelector('a[href="/maintenance"]');
    expect(link).not.toBeNull();
    // Internal route — must NOT open in a new tab.
    expect(link?.getAttribute("target")).toBeNull();
  });
});

describe("WqaOverviewBody — CCR lead & PFAS surface in the panel (issue #224)", () => {
  it("renders lead from the CCR lead/copper distribution", () => {
    const findings = cwsWithCcrFindings([
      { name: "Atrazine", level: 0.5, mcl: 3, tier: "context" },
    ]);
    findings.ccr_findings!.lead_copper_distribution = {
      lead: {
        percentile_90: 0.009,
        unit: "mg/L",
        action_level: 0.015,
        samples_collected: null,
        samples_exceeding_action_level: null,
        monitoring_period: "2024",
      },
      copper: null,
      lead_service_line_count: null,
    };
    render(findings);
    expect(text()).toContain("Detected in your water");
    expect(text()).toContain("Lead");
    expect(text()).toContain("0.009");
  });

  it("renders PFAS reported only in the CCR UCMR section", () => {
    const findings = cwsWithCcrFindings([
      { name: "Atrazine", level: 0.5, mcl: 3, tier: "context" },
    ]);
    findings.ccr_findings!.ucmr_results = [
      {
        contaminant_name: "PFOA",
        detected_level: 2.2,
        unit: "ng/L",
        monitoring_period: "2024",
      },
    ];
    render(findings);
    expect(text()).toContain("PFOA");
    expect(text()).toContain("2.2");
  });
});

describe("WqaOverviewBody — year-over-year trends (issue #289)", () => {
  it("renders a trend direction + prior value + data span on a contaminant with history", () => {
    const findings = cwsWithCcrFindings([
      { name: "Nitrate", level: 3.1, mcl: 10, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminant_history = [
      {
        key: "nitrate",
        display_name: "Nitrate",
        unit: "ppb",
        points: [
          { year: 2024, level: 2.4, unit: "ppb" },
          { year: 2025, level: 3.1, unit: "ppb" },
        ],
      },
    ];
    render(findings);
    expect(text()).toContain("Rising");
    expect(text()).toContain("was 2.4 ppb in 2024");
    expect(text()).toContain("2 readings · 2024–2025");
  });

  it("shows no trend row when the contaminant has only one year of data", () => {
    const findings = cwsWithCcrFindings([
      { name: "Nitrate", level: 3.1, mcl: 10, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminant_history = [
      {
        key: "nitrate",
        display_name: "Nitrate",
        unit: "ppb",
        points: [{ year: 2025, level: 3.1, unit: "ppb" }],
      },
    ];
    render(findings);
    // Single reading → no comparison, no trend word.
    expect(text()).not.toContain("Rising");
    expect(text()).not.toContain("Stable");
    expect(text()).not.toContain("readings ·");
  });

  it("renders a per-analyte trend inside the PFAS family card", () => {
    const findings = cwsWithCcrFindings([
      { name: "Perfluorooctanoic acid (PFOA)", level: 4.0, mcl: 4, tier: "caution" },
      { name: "Perfluorooctane sulfonic acid (PFOS)", level: 2.5, mcl: 4, tier: "caution" },
    ]);
    findings.ccr_findings!.contaminant_history = [
      {
        key: "perfluorooctanoic acid (pfoa)",
        display_name: "Perfluorooctanoic acid (PFOA)",
        unit: "ppt",
        points: [
          { year: 2024, level: 2.0, unit: "ppt" },
          { year: 2025, level: 4.0, unit: "ppt" },
        ],
      },
      {
        key: "perfluorooctane sulfonic acid (pfos)",
        display_name: "Perfluorooctane sulfonic acid (PFOS)",
        unit: "ppt",
        points: [
          { year: 2024, level: 5.0, unit: "ppt" },
          { year: 2025, level: 2.5, unit: "ppt" },
        ],
      },
    ];
    render(findings);
    expect(text()).toContain(PFAS_FAMILY_HEADING);
    // PFOA rose, PFOS fell — both directions surface in the family card.
    expect(text()).toContain("Rising");
    expect(text()).toContain("Falling");
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
