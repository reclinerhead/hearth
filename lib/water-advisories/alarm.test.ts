import { describe, expect, it } from "vitest";
import { shouldSendAlarm } from "./alarm";

const NOW = "2026-09-24T02:00:00.000Z";
const base = { threshold: 6, cooldownHours: 24, nowIso: NOW, failureAlertedAt: null };

describe("shouldSendAlarm (issue #351)", () => {
  it("stays quiet below the threshold", () => {
    expect(shouldSendAlarm({ ...base, consecutiveFailures: 5 })).toBe(false);
  });

  it("fires at the threshold when the source has never alarmed", () => {
    expect(shouldSendAlarm({ ...base, consecutiveFailures: 6 })).toBe(true);
  });

  it("does not re-fire inside the cooldown, even after a recovery in between", () => {
    expect(
      shouldSendAlarm({ ...base, consecutiveFailures: 6, failureAlertedAt: "2026-09-23T21:00:00.000Z" }),
    ).toBe(false);
    expect(
      shouldSendAlarm({ ...base, consecutiveFailures: 12, failureAlertedAt: "2026-09-23T21:00:00.000Z" }),
    ).toBe(false);
  });

  it("fires again once the cooldown has passed", () => {
    expect(
      shouldSendAlarm({ ...base, consecutiveFailures: 6, failureAlertedAt: "2026-09-23T01:00:00.000Z" }),
    ).toBe(true);
  });

  it("treats an unparseable anchor as never-alarmed rather than muting forever", () => {
    expect(shouldSendAlarm({ ...base, consecutiveFailures: 6, failureAlertedAt: "junk" })).toBe(true);
  });
});
