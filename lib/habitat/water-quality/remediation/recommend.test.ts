import { describe, expect, it } from "vitest";
import {
  matchRemediationRow,
  personalizeRemediationMatrix,
  recommendRemediationCombination,
  type DetectedContaminantInput,
} from "./recommend";

/** The full Kalamazoo 2024 set from the epic mockup. */
function kalamazooDetected(): DetectedContaminantInput[] {
  return [
    { name: "Lead", level_label: "9 ppb" },
    { name: "PFOA", level_label: "2.2 ng/L" },
    { name: "PFOS", level_label: "4.0 ng/L" },
    { name: "Total Trihalomethanes (TTHMs)", level_label: "28.5 ppb" },
    { name: "Haloacetic Acids (HAA5)", level_label: "16.2 ppb" },
    { name: "1,2-Dichloroethane", level_label: "trace" },
    { name: "cis-1,2-Dichloroethylene", level_label: "trace" },
    { name: "Fluoride", level_label: "0.68 ppm" },
  ];
}

describe("matchRemediationRow", () => {
  it("resolves CCR contaminant names onto matrix rows", () => {
    expect(matchRemediationRow({ name: "Lead" })?.key).toBe("lead");
    expect(matchRemediationRow({ name: "PFOA" })?.key).toBe("pfas");
    expect(matchRemediationRow({ name: "PFOS" })?.key).toBe("pfas");
    expect(
      matchRemediationRow({ name: "Total Trihalomethanes (TTHMs)" })?.key,
    ).toBe("tthm");
    expect(
      matchRemediationRow({ name: "Haloacetic Acids (HAA5)" })?.key,
    ).toBe("haa5");
    expect(matchRemediationRow({ name: "cis-1,2-Dichloroethylene" })?.key).toBe(
      "voc",
    );
    expect(matchRemediationRow({ name: "Fluoride" })?.key).toBe("fluoride");
  });

  it("resolves by SDWIS / LCR code when the name doesn't match", () => {
    expect(matchRemediationRow({ name: "", code: "PB90" })?.key).toBe("lead");
    expect(matchRemediationRow({ name: "", code: "5000" })?.key).toBe("lead");
    expect(matchRemediationRow({ name: "", code: "2950" })?.key).toBe("tthm");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchRemediationRow({ name: "  fLuOrIdE " })?.key).toBe("fluoride");
  });

  it("maps unlisted PFAS species onto the PFAS row by family", () => {
    // Exact aliases can't enumerate every PFAS name; the family
    // fallback catches the rest.
    expect(matchRemediationRow({ name: "PFBA" })?.key).toBe("pfas");
    expect(matchRemediationRow({ name: "PFHpA" })?.key).toBe("pfas");
    expect(
      matchRemediationRow({ name: "Perfluorohexanoic acid" })?.key,
    ).toBe("pfas");
    expect(matchRemediationRow({ name: "GenX" })?.key).toBe("pfas");
  });

  it("does NOT mistake fluoride for a PFAS", () => {
    expect(matchRemediationRow({ name: "Fluoride" })?.key).toBe("fluoride");
  });

  it("returns null for contaminants the matrix omits (e.g. copper)", () => {
    expect(matchRemediationRow({ name: "Copper" })).toBeNull();
    expect(matchRemediationRow({ name: "Sodium" })).toBeNull();
  });
});

describe("personalizeRemediationMatrix", () => {
  it("returns the full matrix in order regardless of detections", () => {
    const rows = personalizeRemediationMatrix([]);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.detected === false)).toBe(true);
    // Undetected rows fall back to their neutral default context.
    expect(rows.find((r) => r.row.key === "chlorine")?.context_label).toBe(
      "Disinfectant residual",
    );
  });

  it("flags detected rows and builds the level context label", () => {
    const rows = personalizeRemediationMatrix([
      { name: "Lead", level_label: "9 ppb" },
    ]);
    const lead = rows.find((r) => r.row.key === "lead")!;
    expect(lead.detected).toBe(true);
    expect(lead.context_label).toBe("9 ppb · in your water");
    // Other rows stay undetected.
    expect(rows.find((r) => r.row.key === "arsenic")?.detected).toBe(false);
  });

  it("collapses multiple species onto one row as 'Detected' (PFOA + PFOS → PFAS)", () => {
    const rows = personalizeRemediationMatrix([
      { name: "PFOA", level_label: "2.2 ng/L" },
      { name: "PFOS", level_label: "4.0 ng/L" },
    ]);
    const pfas = rows.find((r) => r.row.key === "pfas")!;
    expect(pfas.detected).toBe(true);
    expect(pfas.context_label).toBe("Detected · in your water");
  });

  it("detected without a level falls back to 'Detected · in your water'", () => {
    const rows = personalizeRemediationMatrix([{ name: "Fluoride" }]);
    expect(rows.find((r) => r.row.key === "fluoride")?.context_label).toBe(
      "Detected · in your water",
    );
  });

  it("ignores contaminants with no matrix row (copper) without throwing", () => {
    const rows = personalizeRemediationMatrix([
      { name: "Copper", level_label: "0.1 mg/L" },
    ]);
    expect(rows.every((r) => r.detected === false)).toBe(true);
  });
});

describe("recommendRemediationCombination", () => {
  it("the Kalamazoo set → carbon block covers 5 of 6, P473 added, RO add-on for fluoride", () => {
    const combo = recommendRemediationCombination(kalamazooDetected());
    expect(combo.primary.detected_count).toBe(6);
    expect(combo.primary.covered_count).toBe(5);
    expect(combo.primary.covered).toEqual(
      expect.arrayContaining([
        "Lead",
        "PFAS (PFOA, PFOS)",
        "Trihalomethanes",
        "Haloacetic acids",
        "VOCs (1,2-DCE, cis-DCE)",
      ]),
    );
    // Fluoride is the one carbon can't cover.
    expect(combo.primary.covered).not.toContain("Fluoride");
    // PFAS detected → P473 in the cert list.
    expect(combo.primary.nsf_standards).toContain("NSF P473");
    // RO add-on, framed as values-based (fluoride only).
    expect(combo.ro_addon).not.toBeNull();
    expect(combo.ro_addon!.values_based).toBe(true);
    expect(combo.ro_addon!.reason_contaminants).toEqual(["Fluoride"]);
    expect(combo.ro_addon!.label).toBe("Add RO if removing fluoride");
  });

  it("lead-only → covers 1 of 1, no P473, no RO add-on", () => {
    const combo = recommendRemediationCombination([
      { name: "Lead", level_label: "9 ppb" },
    ]);
    expect(combo.primary.covered_count).toBe(1);
    expect(combo.primary.detected_count).toBe(1);
    expect(combo.primary.nsf_standards).not.toContain("NSF P473");
    expect(combo.ro_addon).toBeNull();
    expect(combo.handled_separately).toEqual([]);
  });

  it("arsenic + nitrate drive a non-values-based RO add-on", () => {
    const combo = recommendRemediationCombination([
      { name: "Arsenic", level_label: "5 ppb" },
      { name: "Nitrate", level_label: "3 ppm" },
    ]);
    expect(combo.ro_addon).not.toBeNull();
    expect(combo.ro_addon!.values_based).toBe(false);
    expect(combo.ro_addon!.label).toBe("Add reverse osmosis");
    expect(combo.ro_addon!.reason_contaminants).toEqual(
      expect.arrayContaining(["Arsenic", "Nitrate"]),
    );
  });

  it("hardness is reported as handled separately, not covered by carbon or RO", () => {
    const combo = recommendRemediationCombination([
      { name: "Hardness", level_label: "moderate" },
    ]);
    expect(combo.primary.covered_count).toBe(0);
    expect(combo.ro_addon).toBeNull();
    expect(combo.handled_separately).toEqual(["Hardness (Ca / Mg)"]);
  });

  it("nothing detected → an empty-but-valid recommendation", () => {
    const combo = recommendRemediationCombination([]);
    expect(combo.primary.detected_count).toBe(0);
    expect(combo.primary.covered_count).toBe(0);
    expect(combo.ro_addon).toBeNull();
    expect(combo.handled_separately).toEqual([]);
  });
});
