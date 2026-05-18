import { describe, expect, it } from "vitest";
import {
  classifyFloodZone,
  pickMostSevere,
  SEVERITY_WEIGHT,
} from "./classify";
import type { NormalizedFloodZone } from "./fetch";

/**
 * Build a minimal NormalizedFloodZone for classifier tests. Only the
 * fields the classifier reads (`fldZone`, `zoneSubty`) are interesting
 * to override; the rest get sensible defaults.
 */
function makeZone(overrides: Partial<NormalizedFloodZone> = {}): NormalizedFloodZone {
  return {
    objectId: 1,
    dfirmId: "26077C",
    fldArId: "26077C_3766",
    studyType: "NP",
    fldZone: "X",
    zoneSubty: null,
    isSfha: false,
    staticBfe: null,
    vDatum: null,
    depth: null,
    lenUnit: null,
    velocity: null,
    velUnit: null,
    floodway: false,
    sourceCitation: "26077C_STUDY2",
    ...overrides,
  };
}

describe("classifyFloodZone — Zone X variants", () => {
  it("classifies Zone X with 'minimal hazard' subtype as favorable", () => {
    const result = classifyFloodZone(
      makeZone({ fldZone: "X", zoneSubty: "AREA OF MINIMAL FLOOD HAZARD" }),
    );
    expect(result.severity).toBe("favorable");
    expect(result.kind).toBe("minimal_x");
  });

  it("classifies Zone X with null subtype as favorable", () => {
    const result = classifyFloodZone(
      makeZone({ fldZone: "X", zoneSubty: null }),
    );
    expect(result.severity).toBe("favorable");
    expect(result.kind).toBe("minimal_x");
  });

  it("classifies Zone X with '0.2 PCT' subtype as neutral (500-year floodplain)", () => {
    const result = classifyFloodZone(
      makeZone({
        fldZone: "X",
        zoneSubty: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
      }),
    );
    expect(result.severity).toBe("neutral");
    expect(result.kind).toBe("shaded_x");
  });
});

describe("classifyFloodZone — Zone D", () => {
  it("classifies Zone D as caution regardless of subtype", () => {
    expect(classifyFloodZone(makeZone({ fldZone: "D" })).severity).toBe(
      "caution",
    );
    expect(
      classifyFloodZone(makeZone({ fldZone: "D", zoneSubty: "ANYTHING" }))
        .severity,
    ).toBe("caution");
  });
});

describe("classifyFloodZone — SFHA inland (A/AE/AH/AO/AR)", () => {
  it.each(["A", "AE", "AH", "AO", "AR"])(
    "classifies Zone %s as concern (100-year floodplain)",
    (code) => {
      const result = classifyFloodZone(makeZone({ fldZone: code }));
      expect(result.severity).toBe("concern");
      expect(result.kind).toBe("sfha_inland");
    },
  );
});

describe("classifyFloodZone — floodway (A/AE + FLOODWAY subtype)", () => {
  it("classifies Zone AE + FLOODWAY as critical", () => {
    const result = classifyFloodZone(
      makeZone({ fldZone: "AE", zoneSubty: "FLOODWAY" }),
    );
    expect(result.severity).toBe("critical");
    expect(result.kind).toBe("floodway");
  });

  it("classifies Zone A + FLOODWAY as critical", () => {
    const result = classifyFloodZone(
      makeZone({ fldZone: "A", zoneSubty: "FLOODWAY" }),
    );
    expect(result.severity).toBe("critical");
    expect(result.kind).toBe("floodway");
  });

  it("matches FLOODWAY case-insensitively", () => {
    expect(
      classifyFloodZone(makeZone({ fldZone: "AE", zoneSubty: "Floodway" }))
        .kind,
    ).toBe("floodway");
    expect(
      classifyFloodZone(makeZone({ fldZone: "AE", zoneSubty: "floodway" }))
        .kind,
    ).toBe("floodway");
  });

  it("Zone AE without FLOODWAY subtype is concern, not critical", () => {
    expect(
      classifyFloodZone(makeZone({ fldZone: "AE", zoneSubty: "AE" })).severity,
    ).toBe("concern");
    expect(
      classifyFloodZone(makeZone({ fldZone: "AE", zoneSubty: null })).severity,
    ).toBe("concern");
  });
});

describe("classifyFloodZone — coastal high hazard (V/VE)", () => {
  it("classifies Zone V as critical", () => {
    const result = classifyFloodZone(makeZone({ fldZone: "V" }));
    expect(result.severity).toBe("critical");
    expect(result.kind).toBe("coastal_high_hazard");
  });

  it("classifies Zone VE as critical", () => {
    const result = classifyFloodZone(makeZone({ fldZone: "VE" }));
    expect(result.severity).toBe("critical");
    expect(result.kind).toBe("coastal_high_hazard");
  });
});

describe("classifyFloodZone — unknown zone fallback", () => {
  it("falls through to caution for an unrecognized code", () => {
    const result = classifyFloodZone(makeZone({ fldZone: "Q" }));
    expect(result.severity).toBe("caution");
    expect(result.kind).toBe("unknown");
    expect(result.plainEnglish).toContain('"Q"');
  });
});

describe("classifyFloodZone — defensive normalization", () => {
  it("treats empty-string subtype the same as null", () => {
    const result = classifyFloodZone(makeZone({ fldZone: "X", zoneSubty: "" }));
    // empty string falls through to default minimal — but since fetch.ts
    // normalizes empty → null, classify should also handle it gracefully.
    expect(result.kind).toBe("minimal_x");
  });

  it("matches FLD_ZONE case-insensitively", () => {
    // FEMA returns upper-case but normalize defensively.
    expect(classifyFloodZone(makeZone({ fldZone: "ae" })).kind).toBe(
      "sfha_inland",
    );
    expect(classifyFloodZone(makeZone({ fldZone: "x" })).kind).toBe(
      "minimal_x",
    );
  });
});

describe("SEVERITY_WEIGHT", () => {
  it("orders critical highest down to beneficial lowest", () => {
    expect(SEVERITY_WEIGHT.critical).toBeGreaterThan(SEVERITY_WEIGHT.concern);
    expect(SEVERITY_WEIGHT.concern).toBeGreaterThan(SEVERITY_WEIGHT.caution);
    expect(SEVERITY_WEIGHT.caution).toBeGreaterThan(SEVERITY_WEIGHT.neutral);
    expect(SEVERITY_WEIGHT.neutral).toBeGreaterThan(SEVERITY_WEIGHT.favorable);
    expect(SEVERITY_WEIGHT.favorable).toBeGreaterThan(
      SEVERITY_WEIGHT.beneficial,
    );
  });
});

describe("pickMostSevere", () => {
  it("returns the only zone for a single-element array", () => {
    const z = makeZone({ fldZone: "X" });
    const result = pickMostSevere([z]);
    expect(result.zone).toBe(z);
    expect(result.classification.severity).toBe("favorable");
  });

  it("picks the more severe of two overlapping zones", () => {
    const x = makeZone({ fldZone: "X", zoneSubty: "AREA OF MINIMAL FLOOD HAZARD" });
    const ae = makeZone({ fldZone: "AE" });
    const result = pickMostSevere([x, ae]);
    expect(result.zone).toBe(ae);
    expect(result.classification.severity).toBe("concern");
  });

  it("picks the floodway when overlapping with a regular AE", () => {
    const ae = makeZone({ fldZone: "AE" });
    const floodway = makeZone({ fldZone: "AE", zoneSubty: "FLOODWAY" });
    const result = pickMostSevere([ae, floodway]);
    expect(result.zone).toBe(floodway);
    expect(result.classification.severity).toBe("critical");
  });

  it("throws on an empty array", () => {
    expect(() => pickMostSevere([])).toThrow();
  });
});
