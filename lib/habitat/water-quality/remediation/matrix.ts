/**
 * Drinking-water remediation matrix — which treatment technology
 * addresses which contaminant, and how well.
 *
 * Static reference data, versioned with the app (epic #165, WQA-5).
 * Does NOT change per user — only the *highlighting* in the rendered
 * matrix changes based on what the user's CCR (or lead/copper samples)
 * actually detected. The personalization lives in `./recommend.ts`;
 * this file is the contaminant × technology effectiveness grid plus
 * the technology metadata (NSF/ANSI standards, install location).
 *
 * Sibling to `../contaminants/data.ts` (the per-contaminant editorial
 * reference that drives the "Detected in your water" disclosures). The
 * two are kept separate: that table is keyed by SDWIS/LCR codes and
 * carries health narratives; this table is keyed by treatment-relevant
 * contaminant *groups* and carries filtration effectiveness. A row here
 * ("VOCs") can span several rows there (1,2-DCE, cis-DCE, TCE…).
 *
 * Effectiveness ratings follow EPA and NSF public guidance and are
 * intentionally conservative — when a technology's certification is
 * contaminant-specific (a "carbon filter" that isn't NSF/ANSI 53 for
 * lead doesn't reliably remove lead), the rating reflects what a
 * properly certified unit achieves, and the matrix view's copy points
 * the user at the certification rather than the technology name.
 */

/**
 * How well a treatment technology addresses a contaminant.
 *
 *   full       — a properly certified unit removes essentially all of
 *                it (NSF-certified reduction claim exists).
 *   partial    — meaningful reduction, but not to non-detect, or
 *                certification is variable across products.
 *   unreliable — sometimes marketed for it, but real-world performance
 *                is inconsistent enough that we won't recommend it
 *                (e.g. carafe pitchers for PFAS).
 *   none       — the technology does not address this contaminant.
 *                Rendered as an em dash in the matrix.
 */
export type RemediationEffectiveness =
  | "full"
  | "partial"
  | "unreliable"
  | "none";

/**
 * The six treatment technologies the matrix scores. `ion_exchange` is
 * the water-softener column; `distillation` and `uv` are scored
 * independently here but the matrix view collapses them into one
 * "Distill / UV" column (taking the better of the two) to match the
 * approved mockup — distillation handles inorganics/VOCs, UV handles
 * microbes, and the combined column reads as "the point-of-use
 * heavy-duty option."
 */
export type RemediationTech =
  | "carbon_block"
  | "pitcher"
  | "reverse_osmosis"
  | "ion_exchange"
  | "distillation"
  | "uv";

/**
 * Where the technology installs, which governs what it can even reach.
 *
 *   tap         — point-of-use only (under-sink / faucet). The only
 *                 place that helps for contaminants that enter
 *                 downstream of the meter (lead from the service line)
 *                 or form in-home.
 *   either      — works point-of-use or whole-house.
 *   whole_house — point-of-entry; the right place for aesthetic/scale
 *                 problems (hardness, iron) that affect every fixture.
 */
export type InstallLocation = "tap" | "either" | "whole_house";

export type RemediationTechInfo = {
  key: RemediationTech;
  /** Full label for legends and the combination cards. */
  label: string;
  /** Compact column header in the matrix table. */
  column_label: string;
  /** NSF/ANSI standards a unit should carry to earn its rating. */
  nsf_standards: string[];
};

/**
 * One contaminant group in the matrix. A group can map to several
 * canonical contaminants from the reference table (the "VOCs" group
 * covers the chlorinated-solvent set); `match_aliases` is the union of
 * the names and codes upstream sources emit for anything in the group.
 */
export type RemediationRow = {
  /** Stable key, used in tests and as a React key. */
  key: string;
  /** Display label in the matrix's first column. */
  label: string;
  /**
   * Neutral context shown under the label when this row is NOT among
   * the user's detected contaminants. When it IS detected, the
   * personalization layer replaces this with "<level> · in your water".
   */
  default_context: string;
  /**
   * Names and codes that resolve a detected contaminant onto this row.
   * Matched case-insensitively against the contaminant name AND any
   * source code. Kept generous so CCR-extracted names ("Total
   * Trihalomethanes (TTHMs)") and SDWIS/LCR codes both land here.
   */
  match_aliases: string[];
  effectiveness: Record<RemediationTech, RemediationEffectiveness>;
  install: InstallLocation;
};

export const REMEDIATION_TECHNOLOGIES: RemediationTechInfo[] = [
  {
    key: "carbon_block",
    label: "Under-sink carbon block",
    column_label: "Carbon block",
    nsf_standards: ["NSF/ANSI 53", "NSF/ANSI 42"],
  },
  {
    key: "pitcher",
    label: "Carbon pitcher",
    column_label: "Pitcher",
    nsf_standards: ["NSF/ANSI 42", "NSF/ANSI 53"],
  },
  {
    key: "reverse_osmosis",
    label: "Reverse osmosis",
    column_label: "RO",
    nsf_standards: ["NSF/ANSI 58"],
  },
  {
    key: "ion_exchange",
    label: "Water softener (ion exchange)",
    column_label: "Softener",
    nsf_standards: ["NSF/ANSI 44"],
  },
  {
    key: "distillation",
    label: "Distillation",
    column_label: "Distill / UV",
    nsf_standards: ["NSF/ANSI 62"],
  },
  {
    key: "uv",
    label: "UV disinfection",
    column_label: "Distill / UV",
    nsf_standards: ["NSF/ANSI 55"],
  },
];

/**
 * The matrix. Twelve treatment-relevant contaminant groups, ordered
 * the way the approved mockup orders them: the contaminants a typical
 * municipal customer is most likely to have detected first (lead,
 * PFAS, DBPs, VOCs, fluoride), then the always-present disinfectant
 * residual, then the contaminants that show up on some systems
 * (arsenic, nitrate), then the whole-house aesthetic/scale problems
 * (hardness, iron), then microbial.
 *
 * Cell values reproduce the mockup exactly. The matrix view renders a
 * combined "Distill / UV" column as the better of the `distillation`
 * and `uv` cells.
 */
export const REMEDIATION_MATRIX: RemediationRow[] = [
  {
    key: "lead",
    label: "Lead",
    default_context: "Not detected in your water",
    match_aliases: ["lead", "pb", "pb90", "5000"],
    effectiveness: {
      carbon_block: "full",
      pitcher: "partial",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "tap",
  },
  {
    key: "pfas",
    label: "PFAS (PFOA, PFOS)",
    default_context: "Not detected in your water",
    match_aliases: [
      "pfas",
      "pfoa",
      "pfos",
      "pfhxs",
      "pfna",
      "pfbs",
      "pfhxa",
      "genx",
      "hfpo-da",
      "hfpo-da (genx chemicals)",
      "perfluorooctanoic acid",
      "perfluorooctane sulfonic acid",
      "2810",
      "2811",
      "2812",
      "2813",
      "2814",
      "2815",
    ],
    effectiveness: {
      carbon_block: "full",
      pitcher: "unreliable",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "tap",
  },
  {
    key: "tthm",
    label: "Trihalomethanes",
    default_context: "Disinfection byproduct",
    match_aliases: [
      "tthm",
      "tthms",
      "trihalomethanes",
      "total trihalomethanes",
      "total trihalomethanes (tthm)",
      "total trihalomethanes (tthms)",
      "2950",
    ],
    effectiveness: {
      carbon_block: "full",
      pitcher: "partial",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "either",
  },
  {
    key: "haa5",
    label: "Haloacetic acids",
    default_context: "Disinfection byproduct",
    match_aliases: [
      "haa5",
      "haa",
      "haloacetic acids",
      "haloacetic acids (haa5)",
      "2456",
    ],
    effectiveness: {
      carbon_block: "full",
      pitcher: "partial",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "either",
  },
  {
    key: "voc",
    label: "VOCs (1,2-DCE, cis-DCE)",
    default_context: "Not detected in your water",
    match_aliases: [
      "voc",
      "vocs",
      "1,2-dichloroethane",
      "1,2-dichloroethylene",
      "1,1-dichloroethylene",
      "cis-1,2-dichloroethylene",
      "trans-1,2-dichloroethylene",
      "trichloroethylene",
      "tetrachloroethylene",
      "vinyl chloride",
      "benzene",
      "carbon tetrachloride",
      "dichloromethane",
      "2968",
      "2969",
      "2380",
      "2979",
      "2984",
      "2987",
      "2985",
      "2977",
      "2964",
      "2983",
    ],
    effectiveness: {
      carbon_block: "full",
      pitcher: "full",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "partial",
      uv: "none",
    },
    install: "either",
  },
  {
    key: "fluoride",
    label: "Fluoride",
    default_context: "Often added intentionally",
    match_aliases: ["fluoride", "1025"],
    effectiveness: {
      carbon_block: "none",
      pitcher: "none",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "tap",
  },
  {
    key: "chlorine",
    label: "Chlorine / chloramine",
    default_context: "Disinfectant residual",
    match_aliases: [
      "chlorine",
      "free chlorine",
      "total chlorine",
      "chloramine",
      "chloramines",
      "1006",
      "1009",
    ],
    effectiveness: {
      carbon_block: "full",
      pitcher: "full",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "either",
  },
  {
    key: "arsenic",
    label: "Arsenic",
    default_context: "Not detected in your water",
    match_aliases: ["arsenic", "1005"],
    effectiveness: {
      carbon_block: "partial",
      pitcher: "none",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "none",
    },
    install: "tap",
  },
  {
    key: "nitrate",
    label: "Nitrate",
    default_context: "Not detected in your water",
    match_aliases: [
      "nitrate",
      "nitrate-nitrite",
      "nitrate (as n)",
      "nitrite",
      "1038",
      "1040",
      "1041",
    ],
    effectiveness: {
      carbon_block: "none",
      pitcher: "none",
      reverse_osmosis: "full",
      ion_exchange: "partial",
      distillation: "full",
      uv: "none",
    },
    install: "tap",
  },
  {
    key: "hardness",
    label: "Hardness (Ca / Mg)",
    default_context: "Feeds maintenance planning",
    match_aliases: [
      "hardness",
      "total hardness",
      "calcium",
      "magnesium",
      "hardness (as caco3)",
    ],
    effectiveness: {
      carbon_block: "none",
      pitcher: "none",
      reverse_osmosis: "partial",
      ion_exchange: "full",
      distillation: "full",
      uv: "none",
    },
    install: "whole_house",
  },
  {
    key: "iron",
    label: "Iron / manganese",
    default_context: "Often treated at the source",
    match_aliases: ["iron", "manganese"],
    effectiveness: {
      carbon_block: "none",
      pitcher: "none",
      reverse_osmosis: "partial",
      ion_exchange: "partial",
      distillation: "full",
      uv: "none",
    },
    install: "whole_house",
  },
  {
    key: "bacteria",
    label: "Bacteria / viruses",
    default_context: "Disinfected — rarely detected",
    match_aliases: [
      "bacteria",
      "total coliform",
      "coliform",
      "e. coli",
      "e.coli",
      "viruses",
      "3014",
      "3013",
    ],
    effectiveness: {
      carbon_block: "none",
      pitcher: "none",
      reverse_osmosis: "full",
      ion_exchange: "none",
      distillation: "full",
      uv: "full",
    },
    install: "either",
  },
];

/**
 * NSF's official certified-product listing — the neutral, non-affiliate
 * resource the matrix view's browse affordance points at. Lets a user
 * verify a product carries the certification the matrix assumes
 * (NSF/ANSI 53 for lead/VOCs, 58 for RO, P473 for PFAS) before buying.
 */
export const NSF_CERTIFIED_PRODUCTS_URL =
  "https://info.nsf.org/Certified/DWTU/";

/** Find a matrix row by its stable key. Null when unknown. */
export function remediationRowByKey(key: string): RemediationRow | null {
  return REMEDIATION_MATRIX.find((r) => r.key === key) ?? null;
}

/**
 * The better of two effectiveness ratings, used by the matrix view to
 * collapse the `distillation` and `uv` cells into one "Distill / UV"
 * column. Ordering: full > partial > unreliable > none.
 */
export function betterEffectiveness(
  a: RemediationEffectiveness,
  b: RemediationEffectiveness,
): RemediationEffectiveness {
  const rank: Record<RemediationEffectiveness, number> = {
    full: 3,
    partial: 2,
    unreliable: 1,
    none: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}
