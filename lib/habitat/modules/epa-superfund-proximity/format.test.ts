import { describe, expect, it } from "vitest";
import {
  bearingWord,
  formatArchivedDate,
  formatContaminantName,
  formatContaminants,
  formatEpaRegion,
  roundMiles,
  titleCase,
} from "./format";

describe("titleCase", () => {
  it("title-cases a simple ALL-CAPS phrase", () => {
    expect(titleCase("ALLIED PAPER")).toBe("Allied Paper");
  });

  it("renders INC as 'Inc' (with the source's trailing period preserved)", () => {
    expect(titleCase("YANKEE ELECTRONIC SERVICES, INC.")).toBe(
      "Yankee Electronic Services, Inc.",
    );
  });

  it("keeps LLC all-caps as an initialism", () => {
    expect(titleCase("ACME WIDGETS, LLC")).toBe("Acme Widgets, LLC");
  });

  it("keeps DOT all-caps as an initialism", () => {
    expect(titleCase("DOT FACILITY")).toBe("DOT Facility");
  });

  it("keeps USN all-caps as an initialism", () => {
    expect(titleCase("USN BASE NORFOLK")).toBe("USN Base Norfolk");
  });

  it("title-cases street addresses with numbers", () => {
    expect(titleCase("143 GRASSY PLAIN")).toBe("143 Grassy Plain");
  });

  it("handles slash-joined compound names", () => {
    expect(titleCase("ALLIED PAPER INC./PORTAGE CREEK/KALAMAZOO RIVER")).toBe(
      "Allied Paper Inc./Portage Creek/Kalamazoo River",
    );
  });

  it("preserves trailing punctuation on the last word", () => {
    expect(titleCase("ABC CORP.")).toBe("Abc Corp.");
  });

  it("keeps PCB all-caps as a contaminant abbreviation", () => {
    expect(titleCase("PCB CONTAMINATION")).toBe("PCB Contamination");
  });

  it("lowercases internal minor words like 'of' and 'the'", () => {
    expect(titleCase("DEPARTMENT OF THE NAVY")).toBe("Department of the Navy");
  });

  it("capitalizes the leading minor word", () => {
    expect(titleCase("THE OLD MILL")).toBe("The Old Mill");
  });

  it("returns empty string for null or undefined", () => {
    expect(titleCase(null)).toBe("");
    expect(titleCase(undefined)).toBe("");
    expect(titleCase("")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(titleCase("  ALLIED PAPER  ")).toBe("Allied Paper");
  });

  it("handles roman-numeral plant designations", () => {
    expect(titleCase("REFINERY UNIT III")).toBe("Refinery Unit III");
  });

  it("renders an already-joined hyphenated company name without spaces", () => {
    expect(titleCase("GEORGIA-PACIFIC CORPORATION")).toBe(
      "Georgia-Pacific Corporation",
    );
  });

  it("collapses ' - ' to '-' in EPA's spaced-hyphen form", () => {
    // EPA's source data for Georgia-Pacific actually has " - " with
    // surrounding spaces. The fix normalizes that to a bare hyphen so
    // the rendered output matches the way a person would write the name.
    expect(titleCase("GEORGIA - PACIFIC CORPORATION")).toBe(
      "Georgia-Pacific Corporation",
    );
  });

  it("renders Coca-Cola without dropping the hyphen", () => {
    expect(titleCase("COCA-COLA BOTTLING CO.")).toBe(
      "Coca-Cola Bottling Co.",
    );
  });

  it("does not collapse a multi-space dash, leaving the source untouched", () => {
    // Triple-spaced or em-dashed phrases are not part of EPA's
    // typographic conventions; we only normalize the specific " - "
    // and " – " patterns observed in SEMS data.
    expect(titleCase("PHASE I  -  PHASE II")).toBe("Phase I  -  Phase II");
  });
});

describe("formatContaminantName", () => {
  it("formats benzo(b)fluoranthene with the lowercase IUPAC letter intact", () => {
    expect(formatContaminantName("BENZO(B)FLUORANTHENE")).toBe(
      "Benzo(b)fluoranthene",
    );
  });

  it("preserves TCDD and TEQ acronyms inside a longer name", () => {
    expect(
      formatContaminantName(
        "2,3,7,8-TETRACHLORODIBENZO-P-DIOXIN (TCDD) TOXICITY EQUIVALENTS (TEQ)",
      ),
    ).toBe(
      "2,3,7,8-tetrachlorodibenzo-p-dioxin (TCDD) toxicity equivalents (TEQ)",
    );
  });

  it("preserves PCBs and PAHs with the lowercase plural s", () => {
    expect(formatContaminantName("POLYCHLORINATED BIPHENYLS (PCBS)")).toBe(
      "Polychlorinated biphenyls (PCBs)",
    );
    expect(formatContaminantName("POLYCYCLIC AROMATIC HYDROCARBONS (PAHS)")).toBe(
      "Polycyclic aromatic hydrocarbons (PAHs)",
    );
  });

  it("preserves Roman numerals for oxidation states", () => {
    expect(formatContaminantName("CHROMIUM(VI)")).toBe("Chromium(VI)");
    expect(formatContaminantName("CHROMIUM(III) CHLORIDE")).toBe(
      "Chromium(III) chloride",
    );
  });

  it("uppercases a letter directly following a leading digit (9H-fluorene)", () => {
    expect(formatContaminantName("9H-FLUORENE")).toBe("9H-fluorene");
    expect(formatContaminantName("1H-INDOLE")).toBe("1H-indole");
  });

  it("keeps lowercase IUPAC letters inside parenthesized locant pairs", () => {
    expect(formatContaminantName("INDENO(1,2,3-CD)PYRENE")).toBe(
      "Indeno(1,2,3-cd)pyrene",
    );
  });

  it("lowercases parenthesized alkyl groups (bis(2-ethylhexyl) prefix)", () => {
    expect(formatContaminantName("BIS(2-ETHYLHEXYL)PHTHALATE")).toBe(
      "Bis(2-ethylhexyl)phthalate",
    );
  });

  it("handles simple metal names", () => {
    expect(formatContaminantName("MERCURY")).toBe("Mercury");
    expect(formatContaminantName("LEAD")).toBe("Lead");
  });

  it("handles an already-correct-looking input idempotently", () => {
    expect(formatContaminantName("Mercury")).toBe("Mercury");
    expect(formatContaminantName("Benzo(b)fluoranthene")).toBe(
      "Benzo(b)fluoranthene",
    );
  });

  it("does NOT capitalize the first alpha after a locant prefix", () => {
    // The 't' in 2,3,7,8-tetra... stays lowercase. The previous title-case
    // path would have given "2,3,7,8-Tetrachlorodibenzo-P-Dioxin", which
    // is wrong chemistry.
    expect(formatContaminantName("2,3,7,8-TETRACHLORODIBENZENE")).toBe(
      "2,3,7,8-tetrachlorodibenzene",
    );
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(formatContaminantName(null)).toBe("");
    expect(formatContaminantName(undefined)).toBe("");
    expect(formatContaminantName("")).toBe("");
    expect(formatContaminantName("   ")).toBe("");
  });

  it("does not match acronyms inside larger words (no \"vi\" in \"vinyl\")", () => {
    expect(formatContaminantName("VINYL CHLORIDE")).toBe("Vinyl chloride");
  });
});

describe("formatContaminants", () => {
  it("normalizes each contaminant name through the chemistry formatter", () => {
    expect(formatContaminants(["LEAD", "POLYCHLORINATED BIPHENYLS"])).toEqual([
      "Lead",
      "Polychlorinated biphenyls",
    ]);
  });

  it("drops null and empty entries", () => {
    expect(formatContaminants(["LEAD", null, "", undefined, "PCB"])).toEqual([
      "Lead",
      "PCB",
    ]);
  });

  it("deduplicates case-insensitively while preserving order", () => {
    expect(formatContaminants(["LEAD", "Lead", "PCB", "pcb"])).toEqual([
      "Lead",
      "PCB",
    ]);
  });
});

describe("roundMiles", () => {
  it("rounds to 1 decimal place", () => {
    expect(roundMiles(1.04)).toBe(1.0);
    expect(roundMiles(1.05)).toBe(1.1);
    expect(roundMiles(0.97532)).toBe(1.0);
    expect(roundMiles(2.349)).toBe(2.3);
  });
});

describe("bearingWord", () => {
  it("maps cardinal directions to lowercase words", () => {
    expect(bearingWord("N")).toBe("north");
    expect(bearingWord("E")).toBe("east");
    expect(bearingWord("S")).toBe("south");
    expect(bearingWord("W")).toBe("west");
  });

  it("maps intercardinal directions", () => {
    expect(bearingWord("NE")).toBe("northeast");
    expect(bearingWord("SW")).toBe("southwest");
  });

  it("maps 16-point bearings to hyphenated words", () => {
    expect(bearingWord("NNE")).toBe("north-northeast");
    expect(bearingWord("WSW")).toBe("west-southwest");
  });
});

describe("formatArchivedDate", () => {
  it("renders an ISO date as short-month + year", () => {
    expect(formatArchivedDate("2024-01-15")).toBe("Jan 2024");
    expect(formatArchivedDate("1995-12-01")).toBe("Dec 1995");
  });

  it("accepts a full ISO timestamp (parses by YYYY-MM prefix)", () => {
    expect(formatArchivedDate("2024-07-15T00:00:00Z")).toBe("Jul 2024");
  });

  it("returns null for null, empty, or unparseable input", () => {
    expect(formatArchivedDate(null)).toBeNull();
    expect(formatArchivedDate(undefined)).toBeNull();
    expect(formatArchivedDate("")).toBeNull();
    expect(formatArchivedDate("   ")).toBeNull();
    expect(formatArchivedDate("not a date")).toBeNull();
  });

  it("returns null for an out-of-range month", () => {
    expect(formatArchivedDate("2024-00-01")).toBeNull();
    expect(formatArchivedDate("2024-13-01")).toBeNull();
  });
});

describe("formatEpaRegion", () => {
  it("strips the zero-padding from a region code", () => {
    expect(formatEpaRegion("01")).toBe("Region 1");
    expect(formatEpaRegion("05")).toBe("Region 5");
    expect(formatEpaRegion("10")).toBe("Region 10");
  });

  it("returns null for null, empty, or unparseable input", () => {
    expect(formatEpaRegion(null)).toBeNull();
    expect(formatEpaRegion(undefined)).toBeNull();
    expect(formatEpaRegion("")).toBeNull();
    expect(formatEpaRegion("  ")).toBeNull();
    expect(formatEpaRegion("abc")).toBeNull();
  });

  it("returns null for zero or negative codes (defensive against bad data)", () => {
    expect(formatEpaRegion("00")).toBeNull();
    expect(formatEpaRegion("-1")).toBeNull();
  });
});
