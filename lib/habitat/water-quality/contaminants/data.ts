/**
 * Drinking-water contaminants reference table.
 *
 * Sibling to `lib/habitat/contaminants/data.ts` (the Superfund table).
 * The two are intentionally separate:
 *
 * - Superfund's table is keyed by EPA SEMS text aliases ("LEAD",
 *   "BENZENE", "Aroclor 1254") for resolving raw site-inventory
 *   strings.
 * - This table is keyed by canonical drinking-water contaminant
 *   identifiers used by the LCR sample data and (in WQA-3+) the CCR
 *   extraction pipeline — SDWIS contaminant codes for the VIOLATION
 *   table (`"5000"` for lead, `"1022"` for copper) AND the
 *   LCR_SAMPLE_RESULT-specific codes (`"PB90"`, `"CU90"`). One row
 *   per canonical contaminant; each row lists the codes upstream
 *   sources use.
 *
 * Merging the two tables later, when the remediation matrix in
 * WQA-5 needs both, is a deliberate future step. For WQA-4 we ship
 * just lead and copper — the two contaminants the LCR pipeline
 * surfaces today. WQA-3's CCR extraction will append the rest of
 * the common-CCR set as it's introduced.
 *
 * Per-contaminant fields drive the modal's "Detected in your water"
 * disclosure: a short description, the federal MCL or action level,
 * and a canonical EPA learn-more link.
 */

/**
 * Coarse grouping. Mirrors `ContaminantCategory` in the Superfund
 * table but scoped to the categories that show up in drinking-water
 * monitoring. We deliberately use distinct category names rather
 * than reusing Superfund's so the two tables stay independent — a
 * future merge will require explicit reconciliation, not silent
 * unioning.
 */
export type WqaContaminantCategory =
  | "lead_copper_rule"
  | "disinfection_byproducts"
  | "inorganic"
  | "organic"
  | "radionuclide"
  | "microbial"
  | "pfas";

/**
 * Hearth's tier-cue language for the "Detected in your water"
 * section. Matches the verbal tiers in the WQA mockup:
 *
 *   worth_acting_on — measured AT or ABOVE the federal action level
 *                     or MCL; the user should consider doing something.
 *   worth_knowing   — measured between 80% and 100% of the action
 *                     level (the "approaching" band), or other
 *                     situations where a homeowner who wants to
 *                     understand their water should pay attention.
 *   context         — measured below the approaching threshold or
 *                     below detection. Informational only.
 *
 * The renderer maps these to colors (amber for the first two, gray
 * for context) so the UI's visual hierarchy is consistent across
 * contaminants.
 */
export type WqaContaminantTier =
  | "worth_acting_on"
  | "worth_knowing"
  | "context";

/**
 * Federal threshold a contaminant is measured against.
 *
 *   action_level — Lead and Copper Rule sets these (0.015 mg/L lead,
 *                  1.3 mg/L copper). The utility must act if the
 *                  90th-percentile sample exceeds the action level,
 *                  but it isn't an MCL — there's no MCL for lead in
 *                  the LCR framework.
 *   mcl          — Maximum Contaminant Level. Federally enforceable
 *                  primary standard; an exceedance is a health-based
 *                  violation. Most CCR-reported contaminants land here.
 *   mclg         — Maximum Contaminant Level Goal. Non-enforceable
 *                  aspirational target. Useful context for lead
 *                  (MCLG is zero — there is no safe amount of lead).
 */
export type WqaFederalLimit =
  | { kind: "action_level"; value_mg_l: number; label: string }
  | { kind: "mcl"; value_mg_l: number; label: string }
  | { kind: "mclg"; value_mg_l: number; label: string };

export interface WqaContaminant {
  /** Canonical display spelling. The form we render in user-facing copy. */
  canonical_name: string;
  /**
   * Short, common-vernacular name. Often the same as canonical_name
   * for drinking-water contaminants (lead, copper, arsenic), but
   * exists separately for cases where the canonical IUPAC form
   * differs from the common name (Total Trihalomethanes vs. TTHM).
   */
  common_name: string;
  /**
   * Every code or alias upstream sources use to refer to this
   * contaminant. Includes SDWIS contaminant codes from the VIOLATION
   * table and dataset-specific codes from LCR_SAMPLE_RESULT. The
   * alias-based lookup walks these case-insensitively. Canonical
   * name appears first so a single membership check covers the
   * display-name case too.
   *
   * Codes are quoted as strings even when they look numeric — EPA's
   * `contaminant_code` column is text and some codes carry leading
   * zeros that would be stripped if stored as numbers.
   */
  aliases: string[];
  category: WqaContaminantCategory;
  /**
   * Federal threshold(s). Most contaminants have one; lead has both
   * an action level (LCR enforcement) and an MCLG (the
   * "no safe amount" framing the public-health discussion uses), so
   * we model this as an array. Render order: action_level → mcl →
   * mclg, with the primary enforcement standard first.
   */
  federal_limits: WqaFederalLimit[];
  /**
   * Short editorial summary describing what the contaminant is,
   * where it comes from, and why a homeowner should care. Written
   * in Hearth's voice, 2–4 sentences. Not a verbatim EPA paste.
   */
  description: string;
  /** Authoritative external reference — EPA primary-contaminants page. */
  learn_more_url: string;
}

/**
 * The mapping. Lead and copper for WQA-4; the rest of the common-CCR
 * contaminant set lands as part of WQA-3 (CCR extraction pipeline).
 *
 * Aliases lists deliberately include BOTH the LCR_SAMPLE_RESULT code
 * (`PB90` / `CU90`, the 90th-percentile rollup codes) and the
 * VIOLATION table code (`5000` / `1022`, the general SDWIS codes).
 * A single alias-lookup call handles both data paths.
 */
export const WQA_CONTAMINANTS: WqaContaminant[] = [
  {
    canonical_name: "Lead",
    common_name: "Lead",
    aliases: [
      "Lead",
      "LEAD",
      "lead",
      "Pb",
      "PB90", // LCR_SAMPLE_RESULT 90th-percentile rollup code
      "5000", // SDWIS VIOLATION table general code
    ],
    category: "lead_copper_rule",
    federal_limits: [
      {
        kind: "action_level",
        value_mg_l: 0.015,
        label: "0.015 mg/L (15 ppb) action level",
      },
      {
        kind: "mclg",
        value_mg_l: 0,
        label: "0 mg/L MCLG (no safe amount)",
      },
    ],
    description:
      "Lead enters drinking water primarily from corrosion of older household plumbing and lead service lines, not from the water source itself. There is no known safe level of lead exposure — the federal action level is the threshold at which a utility must take corrective steps, not a target. Most exposure happens at the tap, so flushing water that's sat in pipes overnight before drinking is the simplest mitigation, and a tap filter certified to NSF/ANSI 53 for lead removes more than 99% of remaining lead.",
    learn_more_url: "https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water",
  },
  {
    canonical_name: "Copper",
    common_name: "Copper",
    aliases: [
      "Copper",
      "COPPER",
      "copper",
      "Cu",
      "CU90", // LCR_SAMPLE_RESULT 90th-percentile rollup code
      "1022", // SDWIS VIOLATION table general code
    ],
    category: "lead_copper_rule",
    federal_limits: [
      {
        kind: "action_level",
        value_mg_l: 1.3,
        label: "1.3 mg/L action level",
      },
    ],
    description:
      "Copper, like lead, comes from corrosion of household plumbing rather than the water source. Short-term exposure to elevated copper can cause stomach upset; long-term exposure can affect liver and kidney function in people with copper-sensitive conditions like Wilson's disease. The same flushing and filtration steps that address lead generally address copper too — copper is comparatively easier to remove and most household carbon filters handle it.",
    learn_more_url: "https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations",
  },

  // -- Disinfection byproducts (the CCR pair every chlorinated system reports) --
  {
    canonical_name: "Total Trihalomethanes",
    common_name: "TTHMs",
    aliases: [
      "Total Trihalomethanes",
      "Total Trihalomethanes (TTHM)",
      "Total Trihalomethanes (TTHMs)",
      "Trihalomethanes",
      "TTHM",
      "TTHMs",
      "2950",
    ],
    category: "disinfection_byproducts",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.08, label: "0.080 mg/L (80 ppb) MCL" },
    ],
    description:
      "Trihalomethanes form when the chlorine a utility uses to disinfect reacts with naturally occurring organic matter in the water. They're a near-universal tradeoff of safe, disinfected tap water — the federal limit balances disinfection-byproduct risk against the much larger risk of waterborne disease. A carbon filter removes them readily; counterintuitively, boiling concentrates them rather than removing them.",
    learn_more_url: "https://www.epa.gov/dwreginfo/stage-1-and-stage-2-disinfectants-and-disinfection-byproducts-rules",
  },
  {
    canonical_name: "Haloacetic Acids",
    common_name: "HAA5",
    aliases: [
      "Haloacetic Acids",
      "Haloacetic Acids (HAA5)",
      "Haloacetic acids (HAA5)",
      "HAA5",
      "HAA",
      "2456",
    ],
    category: "disinfection_byproducts",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.06, label: "0.060 mg/L (60 ppb) MCL" },
    ],
    description:
      "Haloacetic acids are the second regulated family of disinfection byproducts, formed the same way as trihalomethanes — chlorine reacting with organic matter. Like TTHMs they're a byproduct of the disinfection that makes tap water safe, removed effectively by carbon filtration and concentrated rather than removed by boiling.",
    learn_more_url: "https://www.epa.gov/dwreginfo/stage-1-and-stage-2-disinfectants-and-disinfection-byproducts-rules",
  },

  // -- PFAS (2024 final MCLs; any detection is meaningful) -----------------
  {
    canonical_name: "PFOA",
    common_name: "PFOA",
    aliases: [
      "PFOA",
      "Perfluorooctanoic acid",
      "Perfluorooctanoic Acid",
      "2810",
    ],
    category: "pfas",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.000004, label: "4.0 ng/L (ppt) MCL — effective 2029" },
      { kind: "mclg", value_mg_l: 0, label: "0 ng/L MCLG (no safe amount)" },
    ],
    description:
      "PFOA is one of the 'forever chemicals' — synthetic compounds that don't break down in the environment or the body and accumulate over time. EPA finalized an enforceable limit of 4 parts per trillion in 2024, with utilities required to comply by 2029. Because the limit is so low and the health concerns (developmental, immune, and cancer effects) attach to long-term accumulation, any detected level is worth knowing about. A carbon-block filter certified to NSF P473, or reverse osmosis, removes it.",
    learn_more_url: "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas",
  },
  {
    canonical_name: "PFOS",
    common_name: "PFOS",
    aliases: [
      "PFOS",
      "Perfluorooctane sulfonic acid",
      "Perfluorooctanesulfonic acid",
      "2811",
    ],
    category: "pfas",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.000004, label: "4.0 ng/L (ppt) MCL — effective 2029" },
      { kind: "mclg", value_mg_l: 0, label: "0 ng/L MCLG (no safe amount)" },
    ],
    description:
      "PFOS is the other most-studied 'forever chemical', regulated alongside PFOA under EPA's 2024 PFAS rule at 4 parts per trillion with a 2029 compliance deadline. The same persistence and accumulation concerns apply, and the same treatments address it — a carbon-block filter certified to NSF P473, or reverse osmosis. Ordinary carafe pitchers are unreliable for PFAS.",
    learn_more_url: "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas",
  },

  // -- Inorganic chemicals commonly printed on CCRs ------------------------
  {
    canonical_name: "Arsenic",
    common_name: "Arsenic",
    aliases: ["Arsenic", "1005"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.01, label: "0.010 mg/L (10 ppb) MCL" },
      { kind: "mclg", value_mg_l: 0, label: "0 mg/L MCLG" },
    ],
    description:
      "Arsenic occurs naturally in many rock formations and enters groundwater as it dissolves — so it's primarily a concern for groundwater systems and private wells. Long-term exposure is linked to several cancers and cardiovascular effects. Carbon filters only partially address it; reverse osmosis or distillation is the reliable household treatment.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Nitrate",
    common_name: "Nitrate",
    aliases: ["Nitrate", "Nitrate (as N)", "Nitrate-Nitrite", "1038", "1040"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 10, label: "10 mg/L (as nitrogen) MCL" },
    ],
    description:
      "Nitrate enters water mainly from fertilizer runoff, septic systems, and animal waste, so it tends to be elevated in agricultural areas. It's the one common contaminant with an acute rather than cumulative risk: high nitrate is dangerous for infants under six months ('blue baby syndrome'). Carbon filters do not remove it — reverse osmosis, distillation, or a nitrate-selective ion-exchange unit is required.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Fluoride",
    common_name: "Fluoride",
    aliases: ["Fluoride", "1025"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 4, label: "4.0 mg/L MCL (enforceable)" },
    ],
    description:
      "Most utilities add fluoride deliberately, targeting roughly 0.7 mg/L for dental health — so a detected level in that range is intentional, not contamination. The federal MCL of 4 mg/L guards against the skeletal effects of much higher long-term exposure. Removing fluoride is a personal/values choice rather than a safety necessity at typical added levels, and it requires reverse osmosis or distillation; carbon filters don't touch it.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Chromium",
    common_name: "Chromium (total)",
    aliases: ["Chromium", "Chromium (total)", "Total Chromium", "1020"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.1, label: "0.1 mg/L (100 ppb) MCL" },
    ],
    description:
      "Total chromium covers both the benign trivalent form (a dietary nutrient) and hexavalent chromium-6 (the industrial form of 'Erin Brockovich' fame). EPA regulates total chromium; California and others have pushed for a separate chromium-6 standard. Reverse osmosis is the reliable household treatment.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Barium",
    common_name: "Barium",
    aliases: ["Barium", "1010"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 2, label: "2 mg/L MCL" },
    ],
    description:
      "Barium occurs naturally in mineral deposits and can dissolve into groundwater. At levels above the federal limit, long-term exposure can raise blood pressure. Reverse osmosis, ion exchange, and distillation all address it.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Selenium",
    common_name: "Selenium",
    aliases: ["Selenium", "1045"],
    category: "inorganic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.05, label: "0.05 mg/L (50 ppb) MCL" },
    ],
    description:
      "Selenium is an essential trace nutrient at low levels but harmful in excess; it enters water from natural deposits and some industrial discharge. Reverse osmosis or distillation removes it.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Uranium",
    common_name: "Uranium",
    aliases: ["Uranium", "4000"],
    category: "radionuclide",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.03, label: "0.030 mg/L (30 µg/L) MCL" },
    ],
    description:
      "Uranium occurs naturally in granitic and sedimentary rock and dissolves into groundwater — a concern chiefly for groundwater systems and private wells. The health concern is kidney toxicity from the metal itself more than radioactivity at typical levels. Reverse osmosis, ion exchange, and distillation remove it.",
    learn_more_url: "https://www.epa.gov/radiation/radionuclides-drinking-water",
  },

  // -- Volatile organic compounds (the chlorinated-solvent set the matrix
  //    groups as "VOCs"; co-occur with nearby Superfund plumes, WQA-7) -----
  {
    canonical_name: "1,2-Dichloroethane",
    common_name: "1,2-DCE",
    aliases: ["1,2-Dichloroethane", "1,2-DCE", "12DCA", "2968"],
    category: "organic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.005, label: "0.005 mg/L (5 ppb) MCL" },
    ],
    description:
      "1,2-Dichloroethane is an industrial solvent and a volatile organic compound — when it shows up in drinking water it usually traces back to an industrial release or a contaminated-site plume rather than the water source. Carbon filtration removes it well. Where it co-occurs with a nearby Superfund chlorinated-solvent site, the connection is worth understanding even when the treated water tests compliant.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "cis-1,2-Dichloroethylene",
    common_name: "cis-1,2-DCE",
    aliases: [
      "cis-1,2-Dichloroethylene",
      "cis-1,2-DCE",
      "cis-1,2-Dichloroethene",
      "2380",
    ],
    category: "organic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.07, label: "0.07 mg/L (70 ppb) MCL" },
    ],
    description:
      "cis-1,2-Dichloroethylene is a breakdown product of industrial solvents like trichloroethylene, so it commonly appears alongside other VOCs near contaminated sites. It's a volatile organic compound that carbon filtration addresses effectively.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Trichloroethylene",
    common_name: "TCE",
    aliases: ["Trichloroethylene", "TCE", "2984"],
    category: "organic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.005, label: "0.005 mg/L (5 ppb) MCL" },
    ],
    description:
      "Trichloroethylene (TCE) is a widely used industrial degreasing solvent and a common groundwater contaminant near manufacturing and dry-cleaning sites. Long-term exposure carries cancer and developmental concerns. As a volatile organic compound it's removed well by carbon filtration or air stripping.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },

  // -- Synthetic organic compounds (common agricultural detection) ---------
  {
    canonical_name: "Atrazine",
    common_name: "Atrazine",
    aliases: ["Atrazine", "2050"],
    category: "organic",
    federal_limits: [
      { kind: "mcl", value_mg_l: 0.003, label: "0.003 mg/L (3 ppb) MCL" },
    ],
    description:
      "Atrazine is one of the most widely used agricultural herbicides in the U.S., so it shows up seasonally in surface-water systems drawing from farmland watersheds. It's an endocrine-disruption concern at chronic exposure. Carbon filtration addresses it.",
    learn_more_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
];
