import { describe, expect, it } from "vitest";
import {
  REMEDIATION_MATRIX,
  REMEDIATION_TECHNOLOGIES,
  betterEffectiveness,
  remediationRowByKey,
  type RemediationRow,
} from "./matrix";

function row(key: string): RemediationRow {
  const hit = remediationRowByKey(key);
  if (!hit) throw new Error(`Test fixture: row '${key}' missing from matrix`);
  return hit;
}

describe("REMEDIATION_MATRIX shape", () => {
  it("has the 12 contaminant groups from the mockup in order", () => {
    expect(REMEDIATION_MATRIX.map((r) => r.key)).toEqual([
      "lead",
      "pfas",
      "tthm",
      "haa5",
      "voc",
      "fluoride",
      "chlorine",
      "arsenic",
      "nitrate",
      "hardness",
      "iron",
      "bacteria",
    ]);
  });

  it("scores every row against all six technologies", () => {
    const techs = REMEDIATION_TECHNOLOGIES.map((t) => t.key).sort();
    for (const r of REMEDIATION_MATRIX) {
      expect(Object.keys(r.effectiveness).sort()).toEqual(techs);
    }
  });

  it("keys are unique", () => {
    const keys = REMEDIATION_MATRIX.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("effectiveness cells reproduce the mockup", () => {
  it("lead: carbon full, pitcher partial, RO full, softener none, distill full, tap-only", () => {
    const lead = row("lead");
    expect(lead.effectiveness.carbon_block).toBe("full");
    expect(lead.effectiveness.pitcher).toBe("partial");
    expect(lead.effectiveness.reverse_osmosis).toBe("full");
    expect(lead.effectiveness.ion_exchange).toBe("none");
    expect(lead.effectiveness.distillation).toBe("full");
    expect(lead.install).toBe("tap");
  });

  it("PFAS: carbon full, pitcher UNRELIABLE, RO full, tap-only", () => {
    const pfas = row("pfas");
    expect(pfas.effectiveness.carbon_block).toBe("full");
    expect(pfas.effectiveness.pitcher).toBe("unreliable");
    expect(pfas.effectiveness.reverse_osmosis).toBe("full");
    expect(pfas.install).toBe("tap");
  });

  it("fluoride: carbon NONE, RO full (the reason RO becomes an add-on)", () => {
    const fluoride = row("fluoride");
    expect(fluoride.effectiveness.carbon_block).toBe("none");
    expect(fluoride.effectiveness.reverse_osmosis).toBe("full");
    expect(fluoride.install).toBe("tap");
  });

  it("VOCs: pitcher full but distillation only partial", () => {
    const voc = row("voc");
    expect(voc.effectiveness.pitcher).toBe("full");
    expect(voc.effectiveness.distillation).toBe("partial");
    expect(voc.effectiveness.uv).toBe("none");
  });

  it("hardness and iron are whole-house problems", () => {
    expect(row("hardness").install).toBe("whole_house");
    expect(row("iron").install).toBe("whole_house");
    expect(row("hardness").effectiveness.ion_exchange).toBe("full");
  });

  it("bacteria is the only row UV fully handles", () => {
    for (const r of REMEDIATION_MATRIX) {
      if (r.key === "bacteria") expect(r.effectiveness.uv).toBe("full");
      else expect(r.effectiveness.uv).toBe("none");
    }
  });
});

describe("betterEffectiveness (the Distill / UV column collapse)", () => {
  it("takes the stronger of two ratings", () => {
    expect(betterEffectiveness("full", "none")).toBe("full");
    expect(betterEffectiveness("none", "full")).toBe("full");
    expect(betterEffectiveness("partial", "none")).toBe("partial");
    expect(betterEffectiveness("unreliable", "none")).toBe("unreliable");
    expect(betterEffectiveness("none", "none")).toBe("none");
  });

  it("reproduces the mockup's combined Distill/UV column", () => {
    // VOCs: distill partial + uv none → partial. Bacteria: full + full
    // → full. Lead: distill full + uv none → full.
    expect(
      betterEffectiveness(
        row("voc").effectiveness.distillation,
        row("voc").effectiveness.uv,
      ),
    ).toBe("partial");
    expect(
      betterEffectiveness(
        row("bacteria").effectiveness.distillation,
        row("bacteria").effectiveness.uv,
      ),
    ).toBe("full");
    expect(
      betterEffectiveness(
        row("lead").effectiveness.distillation,
        row("lead").effectiveness.uv,
      ),
    ).toBe("full");
  });
});

describe("remediationRowByKey", () => {
  it("returns the row for a known key and null otherwise", () => {
    expect(remediationRowByKey("lead")?.label).toBe("Lead");
    expect(remediationRowByKey("nonexistent")).toBeNull();
  });
});
