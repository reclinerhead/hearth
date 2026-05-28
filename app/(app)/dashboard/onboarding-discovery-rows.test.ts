import { describe, expect, it } from "vitest";
import type { HabitatModule, HabitatSeverity } from "@/lib/habitat/types";
import {
  BRIEFING_SOURCE_LABEL,
  buildRowList,
  fallbackOnboardingMessage,
  type BriefingRowContent,
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

const BRIEFING: BriefingRowContent = {
  lead: "Home data found",
  secondary: "built in 1934, 2,210 sq ft",
};
const MODULE_LINES = {
  0: "Zone 1 radon — adding to your home's concerns",
  1: "Outside the FEMA flood plain — good news",
  2: "No Superfund sites nearby",
};
const MODULE_SEVERITIES: Record<number, HabitatSeverity> = {
  0: "concern",
  1: "favorable",
  2: "favorable",
};

function phasesToCheck(): Phase[] {
  return [
    { kind: "intro" },
    { kind: "briefing-checking" },
    { kind: "briefing-result" },
    { kind: "property-questions" },
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
      const rows = buildRowList(
        phase,
        MODULES,
        BRIEFING,
        MODULE_LINES,
        MODULE_SEVERITIES,
      );
      expect(rows, `phase ${JSON.stringify(phase)}`).toHaveLength(
        EXPECTED_LENGTH,
      );
    }
  });

  it("preserves row order (briefing first, then modules in registry order)", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(
        phase,
        MODULES,
        BRIEFING,
        MODULE_LINES,
        MODULE_SEVERITIES,
      );
      expect(rows.map((r) => r.id)).toEqual([
        "briefing",
        "radon",
        "flood",
        "superfund",
      ]);
    }
  });

  it("renders every row idle during intro so the surface locks at first paint", () => {
    const rows = buildRowList({ kind: "intro" }, MODULES, null, {}, {});
    expect(rows.every((r) => r.state === "idle")).toBe(true);
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "idle",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: "Checking public home records…",
    });
    expect(rows[1].lead).toBe("Checking radon zone…");
    expect(rows[2].lead).toBe("Checking fema flood zone…");
  });

  it("flips only the briefing row to checking during briefing-checking", () => {
    const rows = buildRowList(
      { kind: "briefing-checking" },
      MODULES,
      null,
      {},
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "checking",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: "Checking public home records…",
    });
    expect(rows.slice(1).every((r) => r.state === "idle")).toBe(true);
  });

  it("renders the briefing row with lead + secondary in briefing-result and keeps modules idle", () => {
    const rows = buildRowList(
      { kind: "briefing-result" },
      MODULES,
      BRIEFING,
      {},
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "done",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: BRIEFING.lead,
      secondary: BRIEFING.secondary,
    });
    expect(rows.slice(1).every((r) => r.state === "idle")).toBe(true);
  });

  it("omits the secondary line when the briefing has no concrete facts to surface", () => {
    const thin: BriefingRowContent = {
      lead: "Public records checked",
      secondary: null,
    };
    const rows = buildRowList(
      { kind: "briefing-result" },
      MODULES,
      thin,
      {},
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "done",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: "Public records checked",
    });
    expect(rows[0].secondary).toBeUndefined();
  });

  it("renders the same row state in property-questions as in briefing-result (briefing done, modules idle) — issue #142", () => {
    const rows = buildRowList(
      { kind: "property-questions" },
      MODULES,
      BRIEFING,
      {},
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "done",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: BRIEFING.lead,
      secondary: BRIEFING.secondary,
    });
    expect(rows.slice(1).every((r) => r.state === "idle")).toBe(true);
  });

  it("falls back to a single-line lead when the briefing content is null", () => {
    const rows = buildRowList(
      { kind: "briefing-result" },
      MODULES,
      null,
      {},
      {},
    );
    expect(rows[0]).toEqual({
      id: "briefing",
      state: "done",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: "Public records checked",
    });
  });

  it("marks the active module as checking and all later modules as idle (module-checking)", () => {
    const rows = buildRowList(
      { kind: "module-checking", index: 1 },
      MODULES,
      BRIEFING,
      { 0: MODULE_LINES[0] },
      { 0: "concern" },
    );
    expect(rows[0].state).toBe("done");
    expect(rows[1]).toEqual({
      id: "radon",
      state: "done",
      eyebrow: "RADON ZONE",
      lead: MODULE_LINES[0],
      severity: "concern",
    });
    expect(rows[2]).toEqual({
      id: "flood",
      state: "checking",
      eyebrow: "FEMA FLOOD ZONE",
      lead: "Checking fema flood zone…",
    });
    expect(rows[3]).toEqual({
      id: "superfund",
      state: "idle",
      eyebrow: "SUPERFUND PROXIMITY",
      lead: "Checking superfund proximity…",
    });
  });

  it("marks the active module as done in module-result while later modules stay idle", () => {
    const rows = buildRowList(
      { kind: "module-result", index: 1 },
      MODULES,
      BRIEFING,
      { 0: MODULE_LINES[0], 1: MODULE_LINES[1] },
      { 0: "concern", 1: "favorable" },
    );
    expect(rows[2]).toEqual({
      id: "flood",
      state: "done",
      eyebrow: "FEMA FLOOD ZONE",
      lead: MODULE_LINES[1],
      severity: "favorable",
    });
    expect(rows[3].state).toBe("idle");
  });

  it("marks every row as done in the done phase", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING,
      MODULE_LINES,
      MODULE_SEVERITIES,
    );
    expect(rows.every((r) => r.state === "done")).toBe(true);
    expect(rows[1].lead).toBe(MODULE_LINES[0]);
    expect(rows[2].lead).toBe(MODULE_LINES[1]);
    expect(rows[3].lead).toBe(MODULE_LINES[2]);
  });

  it("threads severity onto the done row for each module that has one", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING,
      MODULE_LINES,
      MODULE_SEVERITIES,
    );
    expect(rows[1].severity).toBe("concern");
    expect(rows[2].severity).toBe("favorable");
    expect(rows[3].severity).toBe("favorable");
    // Briefing row never carries severity.
    expect(rows[0].severity).toBeUndefined();
  });

  it("omits severity on done rows whose module has no severity entry", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING,
      MODULE_LINES,
      // Only index 0 has a severity — the others (e.g. 'failed' rows
      // that never produced one, or rows mid-write) get no severity.
      { 0: "concern" },
    );
    expect(rows[1].severity).toBe("concern");
    expect(rows[2].severity).toBeUndefined();
    expect(rows[3].severity).toBeUndefined();
  });

  it("falls back to the generic message for done modules that have no captured line", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING,
      // No moduleLines at all — covers the realtime-late-arrival edge case
      // where the modal jumps to done before every line was captured.
      {},
      {},
    );
    expect(rows[1].lead).toBe(fallbackOnboardingMessage(RADON));
    expect(rows[2].lead).toBe(fallbackOnboardingMessage(FLOOD));
    expect(rows[3].lead).toBe(fallbackOnboardingMessage(SUPERFUND));
  });

  it("treats moduleSeverities as optional (defaults to no severity on any row)", () => {
    const rows = buildRowList(
      { kind: "done" },
      MODULES,
      BRIEFING,
      MODULE_LINES,
    );
    for (const row of rows) {
      expect(row.severity).toBeUndefined();
    }
  });

  it("returns just the briefing row when no modules are applicable", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(phase, [], BRIEFING, {}, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("briefing");
    }
  });

  it("always carries an eyebrow on every row in every phase (issue: source-label discoverability)", () => {
    for (const phase of phasesToCheck()) {
      const rows = buildRowList(
        phase,
        MODULES,
        BRIEFING,
        MODULE_LINES,
        MODULE_SEVERITIES,
      );
      for (const row of rows) {
        expect(row.eyebrow, `phase ${JSON.stringify(phase)} row ${row.id}`).toBeTruthy();
      }
    }
  });

  it("prefers module.sourceLabel over the uppercased name fallback", () => {
    const withLabel: HabitatModule = {
      ...RADON,
      name: "Radon zone",
      sourceLabel: "EPA RADON CHECK",
    };
    const rows = buildRowList(
      { kind: "module-checking", index: 0 },
      [withLabel],
      BRIEFING,
      {},
      {},
    );
    expect(rows[1].eyebrow).toBe("EPA RADON CHECK");
  });
});
