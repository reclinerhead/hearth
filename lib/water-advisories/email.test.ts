import { describe, expect, it } from "vitest";
import { buildWatcherAlarmEmail, describeOutage, escapeHtml } from "./email";

const PLACE = { shortPlace: "Portage", placeName: "Portage, Michigan" };

describe("describeOutage (issue #349)", () => {
  it("reads in minutes under 90, hours above", () => {
    expect(describeOutage("2026-09-23T07:00:00Z", "2026-09-23T08:00:00Z")).toBe("about 60 minutes");
    expect(describeOutage("2026-09-23T07:00:00Z", "2026-09-23T07:01:00Z")).toBe("about 1 minute");
    expect(describeOutage("2026-09-23T06:00:00Z", "2026-09-23T08:30:00Z")).toBe("about 2.5 hours");
    expect(describeOutage("2026-09-23T06:00:00Z", "2026-09-23T07:59:00Z")).toBe("about 2 hours");
  });

  it("is null without a last good run or with a nonsensical span", () => {
    expect(describeOutage(null, "2026-09-23T08:00:00Z")).toBeNull();
    expect(describeOutage("2026-09-23T09:00:00Z", "2026-09-23T08:00:00Z")).toBeNull();
    expect(describeOutage("junk", "2026-09-23T08:00:00Z")).toBeNull();
  });
});

describe("buildWatcherAlarmEmail", () => {
  it("states the outage length and the last good run in Eastern time", () => {
    const m = buildWatcherAlarmEmail({
      place: PLACE,
      recovered: false,
      consecutiveFailures: 2,
      lastError: "GET https://x → fetch failed (Connect Timeout Error)",
      listUrl: "https://www.portagemi.gov/RSSFeed.aspx",
      lastOkAt: "2026-09-23T07:30:00Z",
      nowIso: "2026-09-23T08:30:00Z",
    });
    expect(m.subject).toBe("Water advisory watcher is blind — Portage");
    expect(m.text).toContain("failed 2 runs in a row — blind for about 60 minutes, since its last good run at Sep 23, 3:30 AM ET");
    expect(m.text).toContain("Last error: GET https://x → fetch failed (Connect Timeout Error)");
    expect(m.html).toContain(escapeHtml("Connect Timeout Error"));
  });

  it("the recovery note carries the same span", () => {
    const m = buildWatcherAlarmEmail({
      place: PLACE,
      recovered: true,
      consecutiveFailures: 3,
      lastError: null,
      listUrl: null,
      lastOkAt: "2026-09-23T06:00:00Z",
      nowIso: "2026-09-23T08:00:00Z",
    });
    expect(m.subject).toBe("Water advisory watcher recovered — Portage");
    expect(m.text).toContain("after 3 consecutive failure(s) — blind for about 2 hours, since Sep 23, 2:00 AM ET");
  });

  it("omits the span when there was never a good run", () => {
    const m = buildWatcherAlarmEmail({
      place: PLACE,
      recovered: false,
      consecutiveFailures: 2,
      lastError: null,
      listUrl: null,
      lastOkAt: null,
      nowIso: "2026-09-23T08:00:00Z",
    });
    expect(m.text).toContain("has failed 2 runs in a row. Until it recovers");
    expect(m.text).not.toContain("blind for");
  });
});
