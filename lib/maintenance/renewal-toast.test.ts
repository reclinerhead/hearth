import { describe, expect, it } from "vitest";
import {
  buildRenewalToastMessage,
  type RenewalToastInfo,
} from "./renewal-toast";

function info(partial: Partial<RenewalToastInfo>): RenewalToastInfo {
  return {
    created_task_id: null,
    closed_task_id: null,
    created_task_title: null,
    created_task_next_due_at: null,
    ...partial,
  };
}

describe("buildRenewalToastMessage", () => {
  it("returns null when no renewal task was created", () => {
    expect(buildRenewalToastMessage(info({}))).toBeNull();
    // Even with a closed prior (insert-failed-after-close), no created
    // task means no affirmation — we never claim a reminder was set.
    expect(
      buildRenewalToastMessage(info({ closed_task_id: "task-prior" })),
    ).toBeNull();
  });

  it("confirms a first-time renewal with the lowercased title and due month", () => {
    const msg = buildRenewalToastMessage(
      info({
        created_task_id: "task-new",
        created_task_title: "Vehicle registration renewal",
        created_task_next_due_at: "2026-01-03",
      }),
    );
    expect(msg).toBe(
      "Saved — we'll remind you about your vehicle registration renewal before it's due in January 2026.",
    );
  });

  it("uses renewed-copy when a prior task was closed and chained", () => {
    const msg = buildRenewalToastMessage(
      info({
        created_task_id: "task-new",
        closed_task_id: "task-prior",
        created_task_title: "Auto insurance renewal",
        created_task_next_due_at: "2026-06-01",
      }),
    );
    expect(msg).toBe(
      "Updated — we marked your previous auto insurance renewal done and set the next reminder for June 2026.",
    );
  });

  it("falls back gracefully when the due date is missing or malformed", () => {
    expect(
      buildRenewalToastMessage(
        info({
          created_task_id: "task-new",
          created_task_title: "Warranty renewal",
          created_task_next_due_at: null,
        }),
      ),
    ).toBe("Saved — we'll remind you about your warranty renewal.");

    expect(
      buildRenewalToastMessage(
        info({
          created_task_id: "task-new",
          created_task_title: "Warranty renewal",
          created_task_next_due_at: "not-a-date",
        }),
      ),
    ).toBe("Saved — we'll remind you about your warranty renewal.");
  });

  it("falls back to a generic subject when the title is missing", () => {
    expect(
      buildRenewalToastMessage(
        info({
          created_task_id: "task-new",
          created_task_title: null,
          created_task_next_due_at: "2026-01-03",
        }),
      ),
    ).toBe("Saved — we'll remind you about your renewal before it's due in January 2026.");
  });

  it("anchors the due month in UTC so a calendar date never slips", () => {
    // 2025-12-31 must read December, not January, regardless of the host
    // timezone the test runs in.
    const msg = buildRenewalToastMessage(
      info({
        created_task_id: "task-new",
        created_task_title: "Permit renewal",
        created_task_next_due_at: "2025-12-31",
      }),
    );
    expect(msg).toContain("December 2025");
  });
});
