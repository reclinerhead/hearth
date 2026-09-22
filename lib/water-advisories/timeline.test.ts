import { describe, expect, it } from "vitest";
import {
  buildAdvisoryTimeline,
  describeAdvisorySource,
  formatAdvisoryDate,
  subjectTokens,
  type TimelineRow,
} from "./timeline";

const NOW = "2026-09-22T18:00:00.000Z";
const KZOO = "https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories";

function row(overrides: Partial<TimelineRow> & { source_url: string; title: string }): TimelineRow {
  return {
    summary: "",
    status: "active",
    scope: "system_wide",
    published_on: null,
    first_seen_at: "2026-09-22T16:23:10.000Z",
    ...overrides,
  };
}

// The real September 2026 rows, three ways the same event was published.
const CITY_ISSUED = row({
  source_url: `${KZOO}/Boil-Water-Advisory-LOW-and-HIGH-Pressure-Districts-ONLY`,
  title: "Boil Water Advisory: LOW and HIGH Pressure Districts",
  summary: "E.coli bacteria were found in one sample on September 18, 2026.",
  published_on: "2026-09-19",
});
const CITY_LIFTED_BANNER = row({
  source_url: `${KZOO}/Boil-Water-Advisory-LIFTED-LOW-and-HIGH-Pressure-Districts`,
  title: "Boil Water Advisory LIFTED for Water Customers (High & Low Districts)",
  status: "lifted",
  published_on: "2026-09-21",
  first_seen_at: "2026-09-22T16:23:11.000Z",
});
const WMUK_ISSUED = row({
  source_url: "https://www.wmuk.org/wmuk-news/2026-09-19/boil-water-advisory-issued-for-many-kalamazoo-customers",
  title: "Boil water advisory issued for many Kalamazoo customers",
  published_on: "2026-09-19",
});
const WMUK_LIFTED = row({
  source_url: "https://www.wmuk.org/wmuk-news/2026-09-21/boil-water-advisory-lifted-for-affected-kalamazoo-customers",
  title: "Boil water advisory lifted for affected Kalamazoo customers",
  status: "lifted",
  scope: "unknown",
  published_on: "2026-09-21",
});
const BAKER = row({
  source_url: `${KZOO}/Scheduled-Boil-Water-Advisory-Baker-St`,
  title: "Scheduled Boil Water Advisory: Baker St",
  status: "scheduled",
  scope: "localized",
  first_seen_at: "2026-09-22T16:23:12.000Z",
});
const ROSE_LIFTED = row({
  source_url: `${KZOO}/Boil-Water-Advisory-Lifted-Rose-Arbour-Dr`,
  title: "Boil Water Advisory Lifted: Rose Arbour Dr",
  status: "lifted",
  scope: "localized",
  first_seen_at: "2026-09-22T16:23:13.000Z",
});
const PORTAGE_LIFT = row({
  source_url: "https://www.portagemi.gov/CivicAlerts.aspx?aid=2089",
  title: "Boil Water Advisory Lifted Effective September 10, 2026",
  status: "lifted",
  scope: "unknown",
  published_on: "2026-09-10",
});

describe("buildAdvisoryTimeline — pairing", () => {
  it("pairs the WMUK lifted story with the issued story into one item with both dates", () => {
    const items = buildAdvisoryTimeline([WMUK_LIFTED, WMUK_ISSUED], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: WMUK_ISSUED.title,
      issuedOn: "2026-09-19",
      liftedOn: "2026-09-21",
      liftedSourceUrl: WMUK_LIFTED.source_url,
      open: false,
      key: WMUK_ISSUED.source_url,
    });
  });

  it("pairs the city's banner-only LIFTED page with the issued list entry", () => {
    const items = buildAdvisoryTimeline([CITY_ISSUED, CITY_LIFTED_BANNER], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ issuedOn: "2026-09-19", liftedOn: "2026-09-21", open: false });
  });

  it("an unknown-scope lift closes a district-wide issue", () => {
    const items = buildAdvisoryTimeline([CITY_ISSUED, { ...WMUK_LIFTED }], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].liftedOn).toBe("2026-09-21");
  });

  it("a localized lift does not close a different street's notice", () => {
    const items = buildAdvisoryTimeline([BAKER, ROSE_LIFTED], NOW);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: BAKER.title, liftedOn: null, open: true });
    expect(items[1]).toMatchObject({ title: ROSE_LIFTED.title, issuedOn: null, liftedOn: "2026-09-22", open: false });
  });

  it("a localized lift closes the same street's notice", () => {
    const baker = { ...BAKER, published_on: "2026-09-23" };
    const bakerLift = row({
      source_url: `${KZOO}/Boil-Water-Advisory-Lifted-Baker-St`,
      title: "Boil Water Advisory Lifted: Baker St",
      status: "lifted",
      scope: "localized",
      published_on: "2026-09-25",
    });
    const items = buildAdvisoryTimeline([baker, bakerLift], "2026-09-26T00:00:00Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ issuedOn: "2026-09-23", liftedOn: "2026-09-25", open: false });
  });

  it("a lift with nothing to close stands alone (Portage)", () => {
    const items = buildAdvisoryTimeline([PORTAGE_LIFT], NOW);
    expect(items).toEqual([
      expect.objectContaining({ issuedOn: null, liftedOn: "2026-09-10", status: "lifted", open: false }),
    ]);
  });

  it("a wide-class lift never closes a localized notice", () => {
    const items = buildAdvisoryTimeline([BAKER, WMUK_LIFTED], NOW);
    expect(items).toHaveLength(2);
    const baker = items.find((i) => i.title === BAKER.title)!;
    expect(baker).toMatchObject({ open: true, liftedOn: null });
  });
});

describe("buildAdvisoryTimeline — open rule", () => {
  it("an unpaired issue within the window is open", () => {
    const items = buildAdvisoryTimeline([CITY_ISSUED], "2026-09-25T00:00:00Z");
    expect(items[0].open).toBe(true);
  });

  it("an unpaired issue older than the window is not open and has no lift", () => {
    const items = buildAdvisoryTimeline([CITY_ISSUED], "2026-11-01T00:00:00Z");
    expect(items[0]).toMatchObject({ open: false, liftedOn: null });
  });

  it("the window is configurable", () => {
    expect(buildAdvisoryTimeline([CITY_ISSUED], "2026-09-25T00:00:00Z", { openWindowDays: 2 })[0].open).toBe(false);
  });

  it("uses first_seen_at's date when the source printed no published date", () => {
    const items = buildAdvisoryTimeline([BAKER], NOW);
    expect(items[0].issuedOn).toBe("2026-09-22");
  });
});

describe("buildAdvisoryTimeline — ordering and cap", () => {
  it("returns oldest first, newest at the bottom", () => {
    const items = buildAdvisoryTimeline([BAKER, PORTAGE_LIFT, WMUK_ISSUED, WMUK_LIFTED], NOW);
    expect(items.map((i) => i.liftedOn ?? i.issuedOn)).toEqual(["2026-09-10", "2026-09-21", "2026-09-22"]);
  });

  it("caps to the newest N items", () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) =>
      row({
        source_url: `https://x.example/${n}`,
        title: `Boil Water Advisory: Street ${n}`,
        scope: "localized",
        published_on: `2026-08-0${n}`,
      }),
    );
    const items = buildAdvisoryTimeline(many, "2026-09-22T00:00:00Z", { limit: 3 });
    expect(items.map((i) => i.issuedOn)).toEqual(["2026-08-04", "2026-08-05", "2026-08-06"]);
  });

  it("never drops an open item to the cap", () => {
    const old = [1, 2, 3, 4].map((n) =>
      row({
        source_url: `https://x.example/old-${n}`,
        title: `Boil Water Advisory Lifted: Street ${n}`,
        status: "lifted",
        scope: "localized",
        published_on: `2026-09-2${n}`,
      }),
    );
    const openOne = row({
      source_url: "https://x.example/open",
      title: "Boil Water Advisory: Whole City",
      published_on: "2026-09-20",
    });
    const items = buildAdvisoryTimeline([...old, openOne], "2026-09-25T00:00:00Z", { limit: 2 });
    expect(items.map((i) => i.key)).toEqual([
      "https://x.example/open",
      "https://x.example/old-3",
      "https://x.example/old-4",
    ]);
    expect(items[0].open).toBe(true);
  });
});

describe("helpers", () => {
  it("subjectTokens keeps street identity and drops boilerplate", () => {
    expect([...subjectTokens("Scheduled Boil Water Advisory: Baker St")]).toEqual(["baker"]);
    expect([...subjectTokens("Boil Water Advisory Lifted: Rose Arbour Dr")]).toEqual(["rose", "arbour"]);
    expect([...subjectTokens("Boil Water Advisory (6742 – 6852 Windemere Street)")]).toEqual(["6742", "6852", "windemere"]);
  });

  it("formatAdvisoryDate is UTC-stable", () => {
    expect(formatAdvisoryDate("2026-09-19")).toBe("Sep 19, 2026");
    expect(formatAdvisoryDate("junk")).toBe("junk");
  });

  it("describeAdvisorySource distinguishes the city page, a city feed, and a newsroom feed", () => {
    expect(describeAdvisorySource("opencities_list", { list_url: KZOO })).toMatch(/city's own advisory page/);
    expect(
      describeAdvisorySource("rss", { feed_url: "https://www.portagemi.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml" }),
    ).toMatch(/city's own news feed/);
    expect(describeAdvisorySource("rss", { feed_url: "https://www.wmuk.org/wmuk-news.rss" })).toBe(
      "Watching WMUK's news feed, which typically runs one to three hours behind the city.",
    );
    expect(describeAdvisorySource("rss", {})).toMatch(/public feed/);
  });
});
