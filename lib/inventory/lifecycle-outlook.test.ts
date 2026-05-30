import { describe, expect, it } from "vitest";
import {
  buildLifecycleOutlook,
  type LifecycleOutlookItem,
} from "./lifecycle-outlook";

// Reference clock anchored at UTC midnight so the helper's
// normalizeToDateOnly is a no-op and the age assertions read cleanly.
const TODAY = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01

function item(
  id: string,
  name: string,
  installed_on: string | null,
  status: string | null = "active",
): LifecycleOutlookItem {
  return { id, name, installed_on, status };
}

describe("buildLifecycleOutlook", () => {
  it("returns empty entries and zero counts for empty input", () => {
    expect(buildLifecycleOutlook([], TODAY)).toEqual({
      entries: [],
      rankableCount: 0,
      bigTicketCount: 0,
    });
  });

  it("ranks by fraction-of-life descending and assigns signals", () => {
    const items = [
      item("furnace", "Carrier furnace", "2015-01-01"), // ~11/18 = on_track
      item("roof", "Asphalt shingle roof", "2000-01-01"), // ~26/22 = past
      item("wh", "Rheem water heater", "2016-01-01"), // ~10/11 = approaching
    ];
    const { entries } = buildLifecycleOutlook(items, TODAY);

    expect(entries.map((e) => e.id)).toEqual(["roof", "wh", "furnace"]);
    expect(entries.map((e) => e.signal)).toEqual([
      "past_life",
      "approaching",
      "on_track",
    ]);

    const roof = entries[0];
    expect(roof.label).toBe("Roof");
    expect(roof.typicalYears).toBe(22);
    expect(roof.installedYear).toBe(2000);
    expect(roof.ageYears).toBe(26);
    expect(roof.fractionOfLife).toBeGreaterThan(1);
  });

  it("breaks ties on equal fraction so the older absolute age wins", () => {
    // Water heater (typ 11) aged 4018 days and roof (typ 22) aged exactly
    // double that (8036 days) share the same fraction-of-life. Doubling is
    // exact in IEEE754 and preserves the division grid, so the two
    // fractions compare bit-equal and the tie-break path runs. The roof is
    // the older item (22 yr vs 11 yr), so it must surface first.
    const items = [
      item("wh", "Rheem water heater", "2015-01-01"), // age 4018 days
      item("roof", "Asphalt shingle roof", "2004-01-01"), // age 8036 days
    ];
    const { entries } = buildLifecycleOutlook(items, TODAY);
    expect(entries[0].fractionOfLife).toBe(entries[1].fractionOfLife);
    expect(entries.map((e) => e.id)).toEqual(["roof", "wh"]);
  });

  it("returns only the top three ranked entries", () => {
    const items = [
      item("roof", "Asphalt shingle roof", "2000-01-01"),
      item("wh", "Rheem water heater", "2016-01-01"),
      item("furnace", "Carrier furnace", "2015-01-01"),
      item("dryer", "Maytag dryer", "2024-01-01"), // youngest, lowest fraction
    ];
    const { entries, rankableCount } = buildLifecycleOutlook(items, TODAY);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.id)).not.toContain("dryer");
    expect(rankableCount).toBe(4);
  });

  it("excludes items missing or with a malformed install date but still counts them as big-ticket", () => {
    const items = [
      item("furnace", "Carrier furnace", null), // big-ticket, not rankable
      item("roof", "Asphalt shingle roof", "2010"), // malformed, not rankable
      item("dishwasher", "Bosch dishwasher", "2018-01-01"), // rankable
    ];
    const { entries, rankableCount, bigTicketCount } = buildLifecycleOutlook(
      items,
      TODAY,
    );
    expect(entries.map((e) => e.id)).toEqual(["dishwasher"]);
    expect(rankableCount).toBe(1);
    expect(bigTicketCount).toBe(3);
  });

  it("ignores non-active items entirely (not even counted as big-ticket)", () => {
    const items = [
      item("wh", "Rheem water heater", "2016-01-01", "archived"),
      item("roof", "Asphalt shingle roof", "2000-01-01", "active"),
    ];
    const { entries, rankableCount, bigTicketCount } = buildLifecycleOutlook(
      items,
      TODAY,
    );
    expect(entries.map((e) => e.id)).toEqual(["roof"]);
    expect(rankableCount).toBe(1);
    expect(bigTicketCount).toBe(1);
  });

  it("ignores items whose name matches no tracked category", () => {
    const items = [
      item("tv", "Sony television", "2016-01-01"),
      item("roof", "Asphalt shingle roof", "2000-01-01"),
    ];
    const { entries, bigTicketCount } = buildLifecycleOutlook(items, TODAY);
    expect(entries.map((e) => e.id)).toEqual(["roof"]);
    expect(bigTicketCount).toBe(1);
  });

  it("normalizes the reference date to UTC midnight so wall-clock time doesn't shift the result", () => {
    const items = [item("roof", "Asphalt shingle roof", "2000-01-01")];
    const atMidnight = buildLifecycleOutlook(items, TODAY);
    const justAfter = buildLifecycleOutlook(
      items,
      new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
    );
    expect(justAfter).toEqual(atMidnight);
  });

  it("classifies signal bands around the 0.75 / 1.0 boundaries", () => {
    const items = [
      item("dryer", "Maytag dryer", "2024-01-01"), // ~2/13 on_track
      item("wh", "Rheem water heater", "2017-01-01"), // ~9/11 approaching
      item("roof", "Asphalt shingle roof", "1990-01-01"), // ~36/22 past
    ];
    const byId = Object.fromEntries(
      buildLifecycleOutlook(items, TODAY).entries.map((e) => [e.id, e.signal]),
    );
    expect(byId.dryer).toBe("on_track");
    expect(byId.wh).toBe("approaching");
    expect(byId.roof).toBe("past_life");
  });
});
