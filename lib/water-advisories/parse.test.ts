import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanText,
  decodeEntities,
  DETAIL_LEAD_MAX,
  normalizeUrl,
  parseDetailLead,
  parseDetailTitle,
  parseEmergencyBanner,
  parseOpenCitiesList,
  parsePublishedOn,
} from "./parse";

// Committed snapshots of the City of Kalamazoo's OpenCities pages,
// captured 2026-09-22 during the district-wide E. coli advisory. They pin
// the markup the regex parser depends on: if the city changes its
// template these tests fail before production does.
const LIST_HTML = readFileSync(
  join(__dirname, "fixtures", "kalamazoo-list.html"),
  "utf8",
);
const DETAIL_HTML = readFileSync(
  join(__dirname, "fixtures", "kalamazoo-detail.html"),
  "utf8",
);

const BASE =
  "https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories";

describe("parseOpenCitiesList", () => {
  it("returns the four advisories in page order with clean titles and summaries", () => {
    const entries = parseOpenCitiesList(LIST_HTML);
    expect(entries.map((e) => e.title)).toEqual([
      "Boil Water Advisory: LOW and HIGH Pressure Districts",
      "Scheduled Boil Water Advisory: Baker St",
      "Scheduled Boil Water Advisory: Wheaton Ave, Axtell St, Merrill St",
      "Boil Water Advisory Lifted: Rose Arbour Dr",
    ]);
    expect(entries[0].href).toBe(
      `${BASE}/Boil-Water-Advisory-LOW-and-HIGH-Pressure-Districts-ONLY`,
    );
    expect(entries[0].summary).toBe(
      "E.coli bacteria were found in one sample on September 18, 2026. Municipal water customers within the affected area should not drink the water without boiling it first.",
    );
    expect(entries[3].summary).toBe("This advisory has been lifted.");
  });

  it("skips a block with no href", () => {
    const html = `<div class="list-item-container"><article><h2 class="list-item-title">Orphan</h2></article></div>`;
    expect(parseOpenCitiesList(html)).toEqual([]);
  });

  it("returns an empty list for a page without the list markup", () => {
    expect(parseOpenCitiesList("<html><body>Access Denied</body></html>")).toEqual([]);
  });
});

describe("parseEmergencyBanner", () => {
  it("reads every announcement with severity, title, summary, and link", () => {
    const banner = parseEmergencyBanner(LIST_HTML);
    expect(banner).toHaveLength(2);
    expect(banner[0]).toMatchObject({
      severity: 10,
      title: "Review and comment on the draft Strategic Vision!",
    });
    expect(banner[1]).toEqual({
      severity: 30,
      title: "Boil Water Advisory LIFTED for Water Customers (High & Low Districts)",
      summary:
        "The Boil Water Advisory for City of Kalamazoo water customers in the Low and High pressure districts has been lifted.",
      href: `${BASE}/Boil-Water-Advisory-LIFTED-LOW-and-HIGH-Pressure-Districts`,
    });
  });

  it("returns an empty list when the container is absent", () => {
    expect(parseEmergencyBanner("<html></html>")).toEqual([]);
  });
});

describe("parsePublishedOn", () => {
  it("reads the detail page's published date as an ISO calendar date", () => {
    expect(parsePublishedOn(DETAIL_HTML)).toBe("2026-09-19");
  });

  it("zero-pads single-digit days", () => {
    expect(parsePublishedOn('<p class="published-on">Published on March 4, 2027</p>')).toBe(
      "2027-03-04",
    );
  });

  it("returns null when absent or the month is unrecognized", () => {
    expect(parsePublishedOn("<p>nothing here</p>")).toBeNull();
    expect(parsePublishedOn("<p>Published on Smarch 4, 2027</p>")).toBeNull();
  });
});

describe("parseDetailTitle", () => {
  it("reads the page h1, which can differ from the list title", () => {
    expect(parseDetailTitle(DETAIL_HTML)).toBe(
      "Boil Water Advisory LIFTED: LOW and HIGH Pressure Districts",
    );
  });
});

describe("parseDetailLead (issue #355)", () => {
  it("reads the first two body blocks after the title, skipping the published-on line", () => {
    const lead = parseDetailLead(DETAIL_HTML);
    expect(lead).not.toBeNull();
    expect(lead!.startsWith("This advisory has been lifted. As of Monday, September 21, 2026")).toBe(true);
    expect(lead).not.toMatch(/Published on/);
    expect(lead!.length).toBeLessThanOrEqual(DETAIL_LEAD_MAX);
  });

  it("skips empty blocks and caps the length", () => {
    const long = "x".repeat(DETAIL_LEAD_MAX + 50);
    const html = `<h1 class='oc-page-title '>T</h1><p class="published-on small-text">Published on March 4, 2027</p><p>&nbsp;</p><h2>Update:</h2><p>${long}</p><p>never read</p>`;
    const lead = parseDetailLead(html);
    expect(lead!.startsWith("Update: xxx")).toBe(true);
    expect(lead!.length).toBe(DETAIL_LEAD_MAX);
    expect(lead).not.toMatch(/never read/);
  });

  it("returns null without a page title or without any body text", () => {
    expect(parseDetailLead("<p>no title here</p>")).toBeNull();
    expect(
      parseDetailLead(`<h1 class='oc-page-title '>T</h1><p class="published-on">Published on March 4, 2027</p>`),
    ).toBeNull();
  });
});

describe("text helpers", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("High &amp; Low &#8211; &#x2014; &ndash; &nbsp;x")).toBe(
      "High & Low – — –  x",
    );
  });

  it("strips tags and collapses whitespace, including before punctuation", () => {
    expect(cleanText("  <b>Boil</b>\n\t water   <br/>now ")).toBe("Boil water now");
    expect(cleanText("<p>Advisory for <b>Elm St</b>.</p>")).toBe("Advisory for Elm St.");
  });

  it("normalizes URLs for identity comparison", () => {
    expect(normalizeUrl("https://WWW.Example.org/A/B/#frag")).toBe(
      "https://www.example.org/A/B",
    );
    expect(normalizeUrl("https://www.example.org/")).toBe("https://www.example.org/");
    expect(normalizeUrl("not a url/")).toBe("not a url");
  });
});
