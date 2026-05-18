import { describe, expect, it } from "vitest";
import {
  bearingWord,
  formatContaminants,
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
});

describe("formatContaminants", () => {
  it("title-cases each contaminant name", () => {
    expect(formatContaminants(["LEAD", "POLYCHLORINATED BIPHENYLS"])).toEqual([
      "Lead",
      "Polychlorinated Biphenyls",
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
