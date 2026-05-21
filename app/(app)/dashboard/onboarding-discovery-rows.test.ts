import { describe, expect, it } from "vitest";
import type { HabitatModule } from "@/lib/habitat/types";
import {
  buildRowList,
  fallbackOnboardingMessage,
  type Phase,
} from "./onboarding-discovery-rows";

/**
 * Minimal HabitatModule stubs — buildRowList only reads `key` and `name`,
 * so check()/isApplicable() etc. can be no-ops. Names are deliberately
 * mixed-case so the lowercasing in "Checking <name>…" is exercised.
 */
function mod(key: string, name: string): HabitatModule {
  return {
    key,
    name,
    description: "",
    category: "environmental",
    cadence: "once",
    isApplicable: () => true,
    check: async () => {
      throw new Error("not implemented in test");
    },
  };
}

const RADON = mod("radon", "Radon zone");
const FLOOD = mod("flood", "FEMA flood zone");
const SUPERFUND = mod("superfund", "Superfund proximity");
const MODULES: HabitatModule[] = [RADON, FLOOD, SUPERFUND];
const EXPECTED_LENGTH = 1 + MODULES.length;

const BRIEFING_LINE = "Found your home data — built in 1934, 2,210 sq ft";
const MODULE_LINES = {
  0: "Zone 1 radon — adding to your home's concerns",
  1: "Outside the FEMA flood plain — good news",
  2: "No Superfund sites nearby",
};

function phasesToCheck(): Phase[] {
  return [
    { kind: "intro" },
    { kind: "briefing-checking" },
    { kind: "briefing-result" },
    { kind: "module-checking", index: 0 },
    { kind: "module-result", index: 0 },
    { kind: "module-checking", index: 1 },
    { kind: "module-result", index: 1 },
    { kind: "module-checking", index: 2 },
    { kind: "module-result", index: 2 },
    { kind: "done" },
  ];
}

describe("buildRowList", () => {
  it("returns 1 briefing row + 1 row per module in every phase (issue #108)", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(phase, MODULES, BRIEFING_LINE, MODULE_LINES);
      expect(rows, `phase ${JSON.stringify(phase)}`).toHaveLength(
        EXPECTED_LENGTH,
      );
    }
  });

  it("preserves row order (briefing first, then modules in registry order)", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(phase, MODULES, BRIEFING_LINE, MODULE_LINES);
      expect(rows.map((r) => r.id)).toEqual([
        "briefing",
        "radon",
        "flood",
        "superfund",
      ]);
    }
  });

  it("renders every row idle during intro so the surface locks at first paint", () => {
    const rows = buildRowList({ kind: "intro" }, MODULES, null, {});
    expect(rows.every((r) => r.state === "idle")).toBe(true);
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "idle",
      text: "Checking public home records…",
    });
    expect(rows[1].text).toBe("Checking radon zone…");
    expect(rows[2].text).toBe("Checking fema flood zone…");
  });

  it("flips only the briefing row to checking during briefing-checking", () => {
    const rows = buildRowList(
      { kind: "briefing-checking" },
      MODULES,
      null,
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "checking",
      text: "Checking public home records…",
    });
    expect(rows.slice(1).every((r) => r.state === "idle")).toBe(true);
  });

  it("shows the captured briefing line in briefing-result and keeps modules idle", () => {
    const rows = buildRowList(
      { kind: "briefing-result" },
      MODULES,
      BRIEFING_LINE,
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "done",
      text: BRIEFING_LINE,
    });
    expect(rows.slice(1).every((r) => r.state === "idle")).toBe(true);
  });

  it("falls back when the briefing line is null", () => {
    const rows = buildRowList(
      { kind: "briefing-result" },
      MODULES,
      null,
      {},
    );
    expect(rows[0].text).toBe("Looked up your home's public records");
  });

  it("marks the active module as checking and all later modules as idle (module-checking)", () => {
    const rows = buildRowList(
      { kind: "module-checking", index: 1 },
      MODULES,
      BRIEFING_LINE,
      { 0: MODULE_LINES[0] },
    );
    expect(rows[0].state).toBe("done");
    expect(rows[1]).toEqual({
      id: "radon",
      state: "done",
      text: MODULE_LINES[0],
    });
    expect(rows[2]).toEqual({
      id: "flood",
      state: "checking",
      text: "Checking fema flood zone…",
    });
    expect(rows[3]).toEqual({
      id: "superfund",
      state: "idle",
      text: "Checking superfund proximity…",
    });
  });

  it("marks the active module as done in module-result while later modules stay idle", () => {
    const rows = buildRowList(
      { kind: "module-result", index: 1 },
      MODULES,
      BRIEFING_LINE,
      { 0: MODULE_LINES[0], 1: MODULE_LINES[1] },
    );
    expect(rows[2]).toEqual({
      id: "flood",
      state: "done",
      text: MODULE_LINES[1],
    });
    expect(rows[3].state).toBe("idle");
  });

  it("marks every row as done in the done phase", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING_LINE,
      MODULE_LINES,
    );
    expect(rows.every((r) => r.state === "done")).toBe(true);
    expect(rows[1].text).toBe(MODULE_LINES[0]);
    expect(rows[2].text).toBe(MODULE_LINES[1]);
    expect(rows[3].text).toBe(MODULE_LINES[2]);
  });

  it("falls back to the generic message for done modules that have no captured line", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING_LINE,
      // No moduleLines at all — covers the realtime-late-arrival edge case
      // where the modal jumps to done before every line was captured.
      {},
    );
    expect(rows[1].text).toBe(fallbackOnboardingMessage(RADON));
    expect(rows[2].text).toBe(fallbackOnboardingMessage(FLOOD));
    expect(rows[3].text).toBe(fallbackOnboardingMessage(SUPERFUND));
  });

  it("returns just the briefing row when no modules are applicable", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(phase, [], BRIEFING_LINE, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("briefing");
    }
  });
});
