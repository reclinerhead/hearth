import { describe, expect, it } from "vitest";
import {
  createActivityLogger,
  type ActivityStepKind,
} from "./activity-log";

describe("createActivityLogger", () => {
  it("assigns sequential 1-indexed step numbers", () => {
    const log = createActivityLogger();
    log.step({ kind: "fetch", narration: "first" });
    log.step({ kind: "compute", narration: "second" });
    log.step({ kind: "finding", narration: "third" });

    const finalized = log.finalize();
    expect(finalized.steps.map((s) => s.step)).toEqual([1, 2, 3]);
  });

  it("records narration, detail, result_summary, and source verbatim", () => {
    const log = createActivityLogger();
    log.step({
      kind: "rule",
      narration: "Applied the threshold.",
      detail: "threshold = 4.0 pCi/L",
      result_summary: "Zone 1",
      source: { label: "EPA", url: "https://example.test/epa" },
    });

    const [step] = log.finalize().steps;
    expect(step.kind).toBe("rule");
    expect(step.narration).toBe("Applied the threshold.");
    expect(step.detail).toBe("threshold = 4.0 pCi/L");
    expect(step.result_summary).toBe("Zone 1");
    expect(step.source).toEqual({
      label: "EPA",
      url: "https://example.test/epa",
    });
  });

  it("allows optional fields to be omitted", () => {
    const log = createActivityLogger();
    log.step({ kind: "compute", narration: "Just narration." });

    const [step] = log.finalize().steps;
    expect(step.narration).toBe("Just narration.");
    expect(step.detail).toBeUndefined();
    expect(step.result_summary).toBeUndefined();
    expect(step.source).toBeUndefined();
  });

  it("accepts every defined step kind", () => {
    const log = createActivityLogger();
    const kinds: ActivityStepKind[] = [
      "fetch",
      "rule",
      "compute",
      "decide",
      "finding",
      "error",
    ];
    for (const kind of kinds) {
      log.step({ kind, narration: kind });
    }
    const finalized = log.finalize();
    expect(finalized.steps.map((s) => s.kind)).toEqual(kinds);
  });

  it("emits monotonically non-decreasing at_ms values", () => {
    const log = createActivityLogger();
    for (let i = 0; i < 5; i++) {
      log.step({ kind: "compute", narration: `step ${i}` });
    }
    const { steps } = log.finalize();
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].at_ms).toBeGreaterThanOrEqual(steps[i - 1].at_ms);
    }
  });

  it("starts at_ms at 0 (or near 0) for the first step", () => {
    const log = createActivityLogger();
    log.step({ kind: "fetch", narration: "first" });
    const [step] = log.finalize().steps;
    // performance.now() resolves in fractions of a millisecond on most
    // platforms; the first step should round to 0 in the synchronous case.
    expect(step.at_ms).toBeGreaterThanOrEqual(0);
    expect(step.at_ms).toBeLessThan(50);
  });

  it("rounds at_ms and total_duration_ms to at most 1 decimal place", () => {
    // Persisting the raw performance.now() output as jsonb would store
    // float noise like 1.4000000000123. Round to 1 decimal place — enough
    // to distinguish sub-millisecond steps without polluting the column.
    const log = createActivityLogger();
    for (let i = 0; i < 20; i++) {
      log.step({ kind: "compute", narration: `step ${i}` });
    }
    const { steps, total_duration_ms } = log.finalize();
    for (const step of steps) {
      // Multiplying by 10 and asserting the result is an integer is a
      // direct check of "at most 1 decimal place" with no float math.
      expect(Number.isInteger(step.at_ms * 10)).toBe(true);
    }
    expect(Number.isInteger(total_duration_ms * 10)).toBe(true);
  });

  it("records started_at and completed_at as ISO timestamps", () => {
    const log = createActivityLogger();
    log.step({ kind: "fetch", narration: "first" });
    const finalized = log.finalize();
    expect(finalized.started_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(finalized.completed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("records total_duration_ms as a non-negative number", () => {
    const log = createActivityLogger();
    log.step({ kind: "fetch", narration: "first" });
    const finalized = log.finalize();
    expect(finalized.total_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("finalizes with an empty steps array when no steps were emitted", () => {
    const log = createActivityLogger();
    const finalized = log.finalize();
    expect(finalized.steps).toEqual([]);
  });

  it("throws when step() is called after finalize()", () => {
    const log = createActivityLogger();
    log.step({ kind: "fetch", narration: "first" });
    log.finalize();
    expect(() => log.step({ kind: "compute", narration: "too late" })).toThrow(
      /finalize/,
    );
  });

  it("returns the same shape on a logger that did real work", () => {
    const log = createActivityLogger();
    log.step({
      kind: "fetch",
      narration: "I looked up the dataset entry for your county.",
      detail: "RADON_ZONES_BY_STATE[MI][kalamazoo]",
      source: {
        label: "EPA Map of Radon Zones (June 2024)",
        url: "https://www.epa.gov/radon/epa-map-radon-zones-0",
      },
    });
    log.step({
      kind: "decide",
      narration: "Zone 1 maps to severity 'concern' in Hearth's classification.",
      result_summary: "Severity: concern",
    });
    log.step({
      kind: "finding",
      narration: "I assembled the finding for your dashboard.",
      result_summary: "EPA Radon Zone 1",
    });

    const finalized = log.finalize();
    expect(finalized.steps).toHaveLength(3);
    expect(finalized.steps[0].kind).toBe("fetch");
    expect(finalized.steps[2].kind).toBe("finding");
    expect(finalized.steps[2].step).toBe(3);
  });
});
