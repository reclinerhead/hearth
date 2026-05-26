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
];
