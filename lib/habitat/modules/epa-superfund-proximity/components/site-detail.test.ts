import { describe, expect, it } from "vitest";
import { buildQuickFacts } from "./site-detail";
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
    ...overrides,
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
