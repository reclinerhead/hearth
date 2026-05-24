import { describe, expect, it } from "vitest";
import {
  computePortfolioLabel,
  computeSiteLabel,
  labelWeight,
  LABEL_WORD,
  LABEL_COLOR,
} from "./label";

describe("computeSiteLabel", () => {
  it("returns worth_acting_on for Tier 1 + Final NPL + a high-concern contaminant", () => {
    expect(
      computeSiteLabel({ tier: 1, nplCode: "F", contaminants: ["Lead"] }),
    ).toBe("worth_acting_on");
    expect(
      computeSiteLabel({
        tier: 1,
        nplCode: "P",
        contaminants: ["Arsenic", "Mercury"],
      }),
    ).toBe("worth_acting_on");
  });

  it("returns worth_knowing for Tier 1 + Final NPL + only unknown chemistry (no enrichments match)", () => {
    expect(
      computeSiteLabel({
        tier: 1,
        nplCode: "F",
        contaminants: ["Some industrial residue"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for any Tier 1 site — including 'A' (part-of-NPL) and 'D' (deleted)", () => {
    expect(
      computeSiteLabel({ tier: 1, nplCode: "A", contaminants: [] }),
    ).toBe("worth_knowing");
    expect(
      computeSiteLabel({ tier: 1, nplCode: "D", contaminants: [] }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for Tier 2 + active cleanup (F or P)", () => {
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Trichloroethylene"],
      }),
    ).toBe("worth_knowing");
    expect(
      computeSiteLabel({ tier: 2, nplCode: "P", contaminants: [] }),
    ).toBe("worth_knowing");
  });

  it("promotes any tier with a high-concern contaminant to worth_knowing", () => {
    expect(
      computeSiteLabel({
        tier: 3,
        nplCode: "F",
        contaminants: ["Lead"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns worth_knowing for Tier 2 with a moderate-concern contaminant", () => {
    // Toluene lands at concern_level='moderate' in the canonical
    // contaminants table — a realistic VOC for an inactive site.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "A",
        contaminants: ["Toluene"],
      }),
    ).toBe("worth_knowing");
  });

  it("returns informational for Tier 3 + Final NPL + only unknown chemistry", () => {
    expect(
      computeSiteLabel({
        tier: 3,
        nplCode: "F",
        contaminants: ["Some industrial residue"],
      }),
    ).toBe("informational");
  });

  it("suppresses (null) for Tier 3 + no contaminants published", () => {
    expect(
      computeSiteLabel({ tier: 3, nplCode: "F", contaminants: [] }),
    ).toBeNull();
  });
});

describe("computeSiteLabel — issue #149 pathway-aligned escalations", () => {
  it("flips Tier 2 active cleanup with chlorinated solvents from worth_knowing to worth_acting_on for a well user (AC #1)", () => {
    // Trichloroethylene is high concern with a groundwater pathway.
    // Without water source context, this lands as worth_knowing per
    // the v1 middle-ground rule (tier 2 + active). With well water,
    // pathway alignment fires the #149 escalation.
    const baseInputs = {
      tier: 2 as const,
      nplCode: "F" as const,
      contaminants: ["Trichloroethylene"],
    };
    expect(computeSiteLabel({ ...baseInputs, waterSource: null })).toBe(
      "worth_knowing",
    );
    expect(computeSiteLabel({ ...baseInputs, waterSource: "well" })).toBe(
      "worth_acting_on",
    );
    expect(computeSiteLabel({ ...baseInputs, waterSource: "shared" })).toBe(
      "worth_acting_on",
    );
  });

  it("keeps Tier 1 active cleanup with PCBs at worth_acting_on regardless of water source (AC #2)", () => {
    // PCBs are high concern; v1 rule already escalates Tier 1 + F/P +
    // high-concern to worth_acting_on — pathway alignment doesn't
    // change the framing for persistent organics that travel through
    // multiple media.
    for (const waterSource of [
      null,
      "well" as const,
      "municipal" as const,
      "shared" as const,
      "unknown" as const,
    ]) {
      expect(
        computeSiteLabel({
          tier: 1,
          nplCode: "F",
          contaminants: ["Polychlorinated biphenyls"],
          waterSource,
        }),
      ).toBe("worth_acting_on");
    }
  });

  it("does not inflate labels when waterSource=unknown and basementPresent=null (AC #3)", () => {
    // Tier 2 + Final + chlorinated solvent — the pathway-aligned
    // escalation requires explicit well/shared water source. Unknown
    // skipped the question, and null is the legacy / absent state.
    // Both leave the label at the v1 worth_knowing instead of
    // inflating to worth_acting_on.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Trichloroethylene"],
        waterSource: "unknown",
        basementPresent: null,
      }),
    ).toBe("worth_knowing");
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Trichloroethylene"],
        waterSource: null,
        basementPresent: null,
      }),
    ).toBe("worth_knowing");
  });

  it("escalates Tier 1 active cleanup with a vapor-intrusion contaminant to worth_acting_on for a basement user", () => {
    // TCE has both groundwater AND vapor_intrusion pathways. At
    // Tier 1 the v1 rule already escalates (high concern + active +
    // close). Pick a chemistry that's high-concern but VI-only so we
    // exercise the basement branch in isolation — Vinyl chloride is
    // high concern with both vocs / groundwater + vapor_intrusion
    // pathways, so basement+VI clearly fires. Without basement we
    // fall to the v1 rule which also gives worth_acting_on (it's
    // high-concern + Tier 1 + F). To exercise the basement-only
    // branch without the v1 path covering for us, use a Tier 2 setup
    // ... but the basement escalation requires Tier 1 (half-mile
    // gate). Instead assert: when v1 rule would NOT fire (Tier 2
    // basement+VI is not an escalation), label is unchanged; when
    // Tier 1 basement+VI fires, label is worth_acting_on.
    const tier1InputsWithoutBasement = {
      tier: 1 as const,
      nplCode: "F" as const,
      contaminants: ["Vinyl chloride"],
      waterSource: "municipal" as const,
      basementPresent: false,
    };
    // V1 rule fires (Tier 1 + active + high concern) regardless of basement.
    expect(computeSiteLabel(tier1InputsWithoutBasement)).toBe(
      "worth_acting_on",
    );
    // Same result with basement; this confirms the basement gate doesn't
    // downgrade something that already qualified under v1.
    expect(
      computeSiteLabel({
        ...tier1InputsWithoutBasement,
        basementPresent: true,
      }),
    ).toBe("worth_acting_on");
  });

  it("does not escalate Tier 2 basement+VI sites — the basement gate requires the half-mile (Tier 1) precautionary radius", () => {
    // Vinyl chloride is high-concern with vapor_intrusion. At Tier 2
    // the basement escalation rule doesn't fire because the
    // half-mile precautionary radius corresponds to Tier 1. The
    // groundwater escalation also doesn't fire because the user is
    // on municipal water. Label falls to the v1 middle-ground rule.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Vinyl chloride"],
        waterSource: "municipal",
        basementPresent: true,
      }),
    ).toBe("worth_knowing");
  });

  it("does not escalate municipal-water users from groundwater pathway alone", () => {
    // Trichloroethylene has groundwater + vapor_intrusion pathways.
    // Municipal water shields the user from groundwater concerns
    // (their utility handles treatment). No basement means VI doesn't
    // apply either. Label stays at v1 worth_knowing.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Trichloroethylene"],
        waterSource: "municipal",
        basementPresent: false,
      }),
    ).toBe("worth_knowing");
  });

  it("does not fire the well-water escalation when contaminants are only soil-exposure (no groundwater pathway)", () => {
    // Asbestos is high concern with airborne_particulate only — no
    // groundwater pathway. Well user doesn't escalate.
    expect(
      computeSiteLabel({
        tier: 2,
        nplCode: "F",
        contaminants: ["Asbestos"],
        waterSource: "well",
        basementPresent: false,
      }),
    ).toBe("worth_knowing");
  });
});

describe("computePortfolioLabel", () => {
  it("returns the max non-null label across sites (n=1 / n=3 / n=5)", () => {
    // n=1
    expect(computePortfolioLabel(["worth_knowing"])).toBe("worth_knowing");
    // n=3
    expect(
      computePortfolioLabel([
        "informational",
        "worth_knowing",
        "informational",
      ]),
    ).toBe("worth_knowing");
    // n=5 with a worth_acting_on entry
    expect(
      computePortfolioLabel([
        "informational",
        "worth_knowing",
        "worth_acting_on",
        "worth_knowing",
        "informational",
      ]),
    ).toBe("worth_acting_on");
  });

  it("ignores null entries when finding the max", () => {
    expect(computePortfolioLabel([null, "informational", null])).toBe(
      "informational",
    );
    expect(computePortfolioLabel([null, "worth_knowing", null, null])).toBe(
      "worth_knowing",
    );
  });

  it("returns null when every per-site label is suppressed", () => {
    expect(computePortfolioLabel([null, null])).toBeNull();
    expect(computePortfolioLabel([null])).toBeNull();
  });

  it("returns null for an empty input (no qualifying sites)", () => {
    expect(computePortfolioLabel([])).toBeNull();
  });
});

describe("labelWeight", () => {
  it("treats null as the lowest weight so suppressed sites sort last", () => {
    expect(labelWeight(null)).toBe(0);
    expect(labelWeight("informational")).toBeGreaterThan(0);
    expect(labelWeight("worth_knowing")).toBeGreaterThan(
      labelWeight("informational"),
    );
    expect(labelWeight("worth_acting_on")).toBeGreaterThan(
      labelWeight("worth_knowing"),
    );
  });
});

describe("LABEL_WORD / LABEL_COLOR", () => {
  it("uses sentence-case words suitable for surface display", () => {
    expect(LABEL_WORD.worth_acting_on).toBe("Worth acting on");
    expect(LABEL_WORD.worth_knowing).toBe("Worth knowing");
    expect(LABEL_WORD.informational).toBe("Informational");
  });

  it("maps every label to a CSS variable token", () => {
    for (const label of [
      "worth_acting_on",
      "worth_knowing",
      "informational",
    ] as const) {
      expect(LABEL_COLOR[label]).toMatch(/^var\(--/);
    }
  });
});
