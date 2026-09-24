import { describe, expect, it } from "vitest";
import { classify, classifyScope, classifyStatus } from "./classify";
import type { ParsedAdvisory } from "./types";

function parsed(
  title: string,
  summary = "",
  on_emergency_banner = false,
): ParsedAdvisory {
  return {
    source_url: `https://example.gov/${encodeURIComponent(title)}`,
    title,
    summary,
    published_on: null,
    on_emergency_banner,
    raw: {},
  };
}

// The four real Kalamazoo entries observed on 2026-09-22 (issue #331
// acceptance criteria), plus the banner's lifted notice.
const DISTRICT = parsed(
  "Boil Water Advisory: LOW and HIGH Pressure Districts",
  "E.coli bacteria were found in one sample on September 18, 2026. Municipal water customers within the affected area should not drink the water without boiling it first.",
);
const BAKER = parsed(
  "Scheduled Boil Water Advisory: Baker St",
  "A precautionary boil water advisory will be issued on Wednesday, September 23 at approximately 8 a.m. for 1405, 1419, and 1427 Baker Street due to scheduled water system repairs.",
);
const WHEATON = parsed(
  "Scheduled Boil Water Advisory: Wheaton Ave, Axtell St, Merrill St",
  "A precautionary boil water advisory will be issued for some customers on Monday, September 21, at approximately 8 a.m. due to water main work on Newton Ct.",
);
const ROSE = parsed(
  "Boil Water Advisory Lifted: Rose Arbour Dr",
  "This advisory has been lifted.",
);
const BANNER_LIFT = parsed(
  "Boil Water Advisory LIFTED for Water Customers (High & Low Districts)",
  "The Boil Water Advisory for City of Kalamazoo water customers in the Low and High pressure districts has been lifted.",
  true,
);

describe("classifyStatus", () => {
  it("classifies the observed titles", () => {
    expect(classifyStatus(DISTRICT.title, DISTRICT.summary)).toBe("active");
    expect(classifyStatus(BAKER.title, BAKER.summary)).toBe("scheduled");
    expect(classifyStatus(WHEATON.title, WHEATON.summary)).toBe("scheduled");
    expect(classifyStatus(ROSE.title, ROSE.summary)).toBe("lifted");
    expect(classifyStatus(BANNER_LIFT.title, BANNER_LIFT.summary)).toBe("lifted");
  });

  it("reads a lift from the summary when the title doesn't say so", () => {
    expect(classifyStatus("Boil Water Advisory: Elm St", "This advisory has been lifted.")).toBe(
      "lifted",
    );
  });

  it("lifted beats scheduled", () => {
    expect(classifyStatus("Scheduled Boil Water Advisory Lifted: Elm St", "")).toBe("lifted");
  });

  it("recognizes do-not-drink orders and falls back to unknown", () => {
    expect(classifyStatus("Do Not Drink Notice: Downtown", "")).toBe("active");
    expect(classifyStatus("Water Main Repair Update", "")).toBe("unknown");
  });
});

describe("classifyStatus — the advisory's own page (issue #355)", () => {
  // The LOW/HIGH row as seeded on 2026-09-24: the list entry never changed,
  // the page was edited in place on 2026-09-21.
  const LIFTED_PAGE = {
    title: "Boil Water Advisory LIFTED: LOW and HIGH Pressure Districts",
    lead: "This advisory has been lifted. As of Monday, September 21, 2026, at 7:00 am, the boil water advisory issued September 19, 2026, has been lifted by the City of Kalamazoo.",
  };

  it("reads a lift from the page heading when the list entry still says active", () => {
    expect(classifyStatus(DISTRICT.title, DISTRICT.summary, LIFTED_PAGE)).toBe("lifted");
    expect(classify({ ...DISTRICT, detail: LIFTED_PAGE })).toMatchObject({
      status: "lifted",
      scope: "system_wide",
    });
  });

  it("reads a lift from the lead alone when the heading was not retitled", () => {
    expect(
      classifyStatus(DISTRICT.title, DISTRICT.summary, { title: DISTRICT.title, lead: LIFTED_PAGE.lead }),
    ).toBe("lifted");
    expect(
      classifyStatus(DISTRICT.title, DISTRICT.summary, { title: null, lead: "The advisory was rescinded at noon." }),
    ).toBe("lifted");
  });

  it("without the page, the same list entry is still active (pre-#355 behavior)", () => {
    expect(classifyStatus(DISTRICT.title, DISTRICT.summary)).toBe("active");
    expect(classifyStatus(DISTRICT.title, DISTRICT.summary, { title: null, lead: null })).toBe("active");
  });

  it("a neutral page does not override a scheduled or active list title", () => {
    const neutral = {
      title: "Scheduled Boil Water Advisory: Baker St",
      lead: "A precautionary boil water advisory will be issued on Wednesday for 1405, 1419, and 1427 Baker Street.",
    };
    expect(classifyStatus(BAKER.title, BAKER.summary, neutral)).toBe("scheduled");
    expect(
      classifyStatus(DISTRICT.title, DISTRICT.summary, {
        title: DISTRICT.title,
        lead: "Sunday, September 20 Update: Samples analyzed this morning showed no detections of E. coli.",
      }),
    ).toBe("active");
  });
});

describe("classifyScope", () => {
  it("district-wide via the pressure-district phrase", () => {
    expect(classifyScope(DISTRICT)).toBe("system_wide");
  });

  it("localized via street tokens in the title subject", () => {
    expect(classifyScope(BAKER)).toBe("localized");
    expect(classifyScope(WHEATON)).toBe("localized");
    expect(classifyScope(ROSE)).toBe("localized");
  });

  it("localized via a house-number range or list", () => {
    expect(classifyScope(parsed("Boil Water Advisory: 6742 – 6852 Windemere"))).toBe(
      "localized",
    );
    expect(classifyScope(parsed("Boil Water Advisory: 1405, 1419, and 1427 Baker"))).toBe(
      "localized",
    );
  });

  it("the emergency banner forces district-wide regardless of wording", () => {
    expect(classifyScope(BANNER_LIFT)).toBe("system_wide");
    expect(classifyScope(parsed("Boil Water Advisory: Baker St", "", true))).toBe(
      "system_wide",
    );
  });

  it("source-specific phrases extend the generic list", () => {
    const a = parsed(
      "Boil Water Advisory",
      "City of Kalamazoo water customers should boil water.",
    );
    expect(classifyScope(a)).toBe("unknown");
    expect(
      classifyScope(a, { systemWidePhrases: ["City of Kalamazoo water customers"] }),
    ).toBe("system_wide");
  });

  it("phrase matching is case-insensitive and ignores blank phrases", () => {
    expect(classifyScope(parsed("BOIL WATER ADVISORY: ALL CUSTOMERS"))).toBe("system_wide");
    expect(classifyScope(parsed("Boil Water Advisory"), { systemWidePhrases: ["  "] })).toBe(
      "unknown",
    );
  });

  it("system-wide phrasing wins over a street token", () => {
    expect(
      classifyScope(parsed("Boil Water Advisory: all customers north of Main St")),
    ).toBe("system_wide");
  });

  it("falls back to unknown when nothing matches", () => {
    expect(classifyScope(parsed("Boil Water Advisory: Northside"))).toBe("unknown");
  });
});

describe("classify", () => {
  it("stamps status and scope onto the parsed advisory", () => {
    expect(classify(DISTRICT)).toMatchObject({ status: "active", scope: "system_wide" });
    expect(classify(ROSE)).toMatchObject({ status: "lifted", scope: "localized" });
  });
});
