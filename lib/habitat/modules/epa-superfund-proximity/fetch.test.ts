import { describe, expect, it } from "vitest";
import { buildNplSitesUrl, mergeContaminants, siteProfileUrl } from "./fetch";

describe("buildNplSitesUrl", () => {
  it("includes the state code uppercased and the F,P,A,D filter", () => {
    const url = buildNplSitesUrl("mi");
    expect(url).toContain("fk_ref_state_code/equals/MI/");
    expect(url).toContain("npl_status_code/in/F,P,A,D/");
    expect(url).toContain("left/sems.envirofacts_contaminants/site_id/equals/fk_site_id/");
    expect(url.endsWith("/JSON")).toBe(true);
  });
});

describe("siteProfileUrl", () => {
  it("strips leading zeros from the SEMS site_id", () => {
    expect(siteProfileUrl("0502325")).toBe(
      "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=502325",
    );
  });

  it("falls back to the original site_id if stripping zeros leaves an empty string", () => {
    expect(siteProfileUrl("0000000")).toBe(
      "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0000000",
    );
  });
});

describe("mergeContaminants", () => {
  it("reads the contaminant from preferred_contaminant_name (EPA's actual column)", () => {
    const merged = mergeContaminants([
      {
        site_id: "0502325",
        name: "ALLIED PAPER, INC./PORTAGE CREEK/KALAMAZOO RIVER",
        preferred_contaminant_name: "POLYCHLORINATED BIPHENYLS",
      },
      {
        site_id: "0502325",
        name: "ALLIED PAPER, INC./PORTAGE CREEK/KALAMAZOO RIVER",
        preferred_contaminant_name: "LEAD",
      },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].contaminants).toEqual([
      "POLYCHLORINATED BIPHENYLS",
      "LEAD",
    ]);
  });

  it("never reads the site's name field as a contaminant (regression for the v1 bug)", () => {
    // The site's own `name` rides along with each joined row. An earlier
    // version of the picker fell back to it and reported the site's name
    // as its contaminant. This test pins the fix.
    const merged = mergeContaminants([
      {
        site_id: "0502325",
        name: "ALLIED PAPER, INC./PORTAGE CREEK/KALAMAZOO RIVER",
        // No preferred_contaminant_name or contaminant_name on this row.
      },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].contaminants).toEqual([]);
  });

  it("falls back to contaminant_name when preferred_contaminant_name is absent", () => {
    // Defensive — if EPA renames the column in a future schema rev, this
    // path keeps the module producing real contaminants instead of nulls.
    const merged = mergeContaminants([
      {
        site_id: "1234567",
        name: "EXAMPLE SITE",
        contaminant_name: "MERCURY",
      },
    ]);
    expect(merged[0].contaminants).toEqual(["MERCURY"]);
  });

  it("deduplicates contaminants within a single site", () => {
    const merged = mergeContaminants([
      {
        site_id: "1",
        name: "SITE",
        preferred_contaminant_name: "LEAD",
      },
      {
        site_id: "1",
        name: "SITE",
        preferred_contaminant_name: "LEAD",
      },
    ]);
    expect(merged[0].contaminants).toEqual(["LEAD"]);
  });

  it("ignores rows missing site_id", () => {
    const merged = mergeContaminants([
      { preferred_contaminant_name: "LEAD" },
      { site_id: "1", name: "REAL SITE", preferred_contaminant_name: "MERCURY" },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].site_id).toBe("1");
  });
});
