import { describe, expect, it } from "vitest";
import { buildQuickFacts, computeDistinctFacts } from "./site-detail";
import type { NplCode } from "../severity";
import type { SiteEntry } from "../types";

function makeSite(overrides: Partial<SiteEntry["site"]> = {}): SiteEntry["site"] {
  return {
    epa_id: "MID000000001",
    sems_site_id: "0100185",
    name_display: "Allied Paper, Inc.",
    name_original: "ALLIED PAPER, INC.",
    address: {
      street: "320 East Alcott Street",
      city: "Kalamazoo",
      county: "Kalamazoo",
      state: "MI",
      zip: "49003",
    },
    npl_status: { code: "F", label: "Final NPL" },
    contaminants: [],
    federal_facility: false,
    archived: false,
    archived_date: null,
    epa_region_code: "05",
    profile_url: "https://example.invalid/profile",
    documents_url: "https://example.invalid/docs",
    ...overrides,
  };
}

/**
 * Build a full SiteEntry for the distinct-facts tests. The function
 * threads through site + context overrides and exposes the small set
 * of fields the distinct heuristic actually reads.
 */
function makeEntry(opts: {
  epaId: string;
  distanceMiles: number;
  nplCode?: NplCode;
  contaminants?: string[];
}): SiteEntry {
  return {
    site: makeSite({
      epa_id: opts.epaId,
      sems_site_id: opts.epaId,
      npl_status: { code: opts.nplCode ?? "F", label: "Final NPL" },
      contaminants: opts.contaminants ?? [],
    }),
    context: {
      distance_miles: opts.distanceMiles,
      bearing: "N",
      tier: opts.distanceMiles < 0.5 ? 1 : opts.distanceMiles < 2 ? 2 : 3,
      severity: "caution",
      label: "worth_knowing",
    },
  };
}

describe("buildQuickFacts", () => {
  it("renders the canonical active-site set (NPL listing, Site status, EPA Region)", () => {
    expect(buildQuickFacts(makeSite())).toEqual([
      { label: "NPL listing", value: "Final NPL" },
      { label: "Site status", value: "Active in EPA system" },
      { label: "EPA Region", value: "Region 5" },
    ]);
  });

  it("appends Federal facility only when federal_facility is true", () => {
    const facts = buildQuickFacts(makeSite({ federal_facility: true }));
    expect(facts).toContainEqual({ label: "Federal facility", value: "Yes" });
    const factsFalse = buildQuickFacts(makeSite({ federal_facility: false }));
    expect(factsFalse.find((f) => f.label === "Federal facility")).toBeUndefined();
  });

  it("renders 'Archived <Mon YYYY>' when the site is archived and a date is present", () => {
    const facts = buildQuickFacts(
      makeSite({ archived: true, archived_date: "2024-01-15" }),
    );
    expect(facts.find((f) => f.label === "Site status")?.value).toBe(
      "Archived Jan 2024",
    );
  });

  it("renders bare 'Archived' when archived but no date is on the row", () => {
    const facts = buildQuickFacts(
      makeSite({ archived: true, archived_date: null }),
    );
    expect(facts.find((f) => f.label === "Site status")?.value).toBe("Archived");
  });

  it("omits the EPA Region row entirely when the code is missing or unparseable", () => {
    const missing = buildQuickFacts(makeSite({ epa_region_code: null }));
    expect(missing.find((f) => f.label === "EPA Region")).toBeUndefined();
    const garbage = buildQuickFacts(makeSite({ epa_region_code: "xx" }));
    expect(garbage.find((f) => f.label === "EPA Region")).toBeUndefined();
  });

  it("always renders NPL listing using the row's label", () => {
    const facts = buildQuickFacts(
      makeSite({ npl_status: { code: "P", label: "Proposed NPL" } }),
    );
    expect(facts[0]).toEqual({ label: "NPL listing", value: "Proposed NPL" });
  });

  it("handles legacy rows without the new fields (backward-compat)", () => {
    // Simulate a row persisted before this PR — the new fields were not
    // written to JSON. The component must not throw, and must omit
    // EPA Region while still rendering Active / Archived for status.
    const legacy = makeSite();
    // @ts-expect-error — exercising defensive code path for legacy JSON.
    delete legacy.archived_date;
    // @ts-expect-error — exercising defensive code path for legacy JSON.
    delete legacy.epa_region_code;
    const facts = buildQuickFacts(legacy);
    expect(facts).toEqual([
      { label: "NPL listing", value: "Final NPL" },
      { label: "Site status", value: "Active in EPA system" },
    ]);
  });
});

describe("computeDistinctFacts (issue #146)", () => {
  it("returns [] when the portfolio is a single site (nothing to compare against)", () => {
    const only = makeEntry({ epaId: "ONLY", distanceMiles: 0.5 });
    expect(computeDistinctFacts(only, [only])).toEqual([]);
  });

  it("returns [] when the portfolio is empty", () => {
    const e = makeEntry({ epaId: "X", distanceMiles: 1 });
    expect(computeDistinctFacts(e, [])).toEqual([]);
  });

  it("emits the 'closest of the nearby sites' fact for the strict-minimum-distance entry", () => {
    const close = makeEntry({ epaId: "CLOSE", distanceMiles: 0.4 });
    const middle = makeEntry({ epaId: "MID", distanceMiles: 1.2 });
    const far = makeEntry({ epaId: "FAR", distanceMiles: 2.8 });
    const facts = computeDistinctFacts(close, [close, middle, far]);
    expect(facts).toContain(
      "This is the closest of the nearby sites to your home.",
    );
  });

  it("does not emit the closest fact when another site shares the minimum distance", () => {
    const tieA = makeEntry({ epaId: "A", distanceMiles: 0.4 });
    const tieB = makeEntry({ epaId: "B", distanceMiles: 0.4 });
    const far = makeEntry({ epaId: "C", distanceMiles: 2.0 });
    const facts = computeDistinctFacts(tieA, [tieA, tieB, far]);
    expect(facts).not.toContain(
      "This is the closest of the nearby sites to your home.",
    );
  });

  it("emits the 'only active cleanup' fact when no other site is Final or Proposed NPL", () => {
    const activeSite = makeEntry({
      epaId: "ACTIVE",
      distanceMiles: 1.0,
      nplCode: "F",
    });
    const partOf = makeEntry({
      epaId: "PARTOF",
      distanceMiles: 0.3,
      nplCode: "A",
    });
    const deleted = makeEntry({
      epaId: "DELETED",
      distanceMiles: 1.5,
      nplCode: "D",
    });
    const facts = computeDistinctFacts(activeSite, [activeSite, partOf, deleted]);
    expect(facts).toContain(
      "This is the only nearby site currently in active EPA cleanup.",
    );
  });

  it("emits the 'only with high-concern category' fact when this site has a category absent from the rest of the portfolio", () => {
    // PCBs (pcbs_dioxins category, high concern) on the target site;
    // peers carry only Arsenic (heavy_metal, high concern). The
    // pcbs_dioxins category is distinct to the target.
    const targetWithPcbs = makeEntry({
      epaId: "PCBSITE",
      distanceMiles: 1.0,
      contaminants: ["Polychlorinated biphenyls"],
    });
    const peerArsenic = makeEntry({
      epaId: "PEER1",
      distanceMiles: 1.2,
      contaminants: ["Arsenic"],
    });
    const peerArsenic2 = makeEntry({
      epaId: "PEER2",
      distanceMiles: 1.4,
      contaminants: ["Arsenic"],
    });
    const facts = computeDistinctFacts(targetWithPcbs, [
      targetWithPcbs,
      peerArsenic,
      peerArsenic2,
    ]);
    expect(
      facts.some((f) => f.includes("PCB and dioxin")),
    ).toBe(true);
  });

  it("does not emit the high-concern fact when peers share every category present on this site", () => {
    const a = makeEntry({
      epaId: "A",
      distanceMiles: 1.0,
      contaminants: ["Arsenic"],
    });
    const b = makeEntry({
      epaId: "B",
      distanceMiles: 1.2,
      contaminants: ["Lead"], // Both heavy_metal — shared category.
    });
    const facts = computeDistinctFacts(a, [a, b]);
    expect(
      facts.some((f) => f.includes("heavy metal")),
    ).toBe(false);
  });

  it("caps the returned facts at three", () => {
    // Build a fixture where every heuristic could fire: closest,
    // only-active, and unique-category. Three is the cap.
    const target = makeEntry({
      epaId: "TARGET",
      distanceMiles: 0.3,
      nplCode: "F",
      contaminants: ["Polychlorinated biphenyls"],
    });
    const peerA = makeEntry({
      epaId: "PEER_A",
      distanceMiles: 1.5,
      nplCode: "D",
      contaminants: ["Arsenic"],
    });
    const peerB = makeEntry({
      epaId: "PEER_B",
      distanceMiles: 2.5,
      nplCode: "A",
      contaminants: ["Lead"],
    });
    const facts = computeDistinctFacts(target, [target, peerA, peerB]);
    expect(facts.length).toBeLessThanOrEqual(3);
  });
});
