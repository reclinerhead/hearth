/**
 * EPA SDWIS contaminant code → human-readable name lookup.
 *
 * SDWIS rows carry numeric contaminant codes ("5000", "2950"); user-
 * facing copy and the activity log narration need human names ("Lead",
 * "Total Trihalomethanes"). There is no Envirofacts endpoint that
 * maps codes to names cleanly, so we ship a small table here covering
 * the codes that meaningfully appear in residential drinking-water
 * violations and LCR samples.
 *
 * Unmapped codes fall through to a `"Contaminant code {N}"` rendering
 * (see `contaminantNameFromCode`) and the consumer surfaces a count
 * of unmapped codes in its activity-log detail so the table can grow
 * over time without flagging the data path.
 *
 * Categories are coarse buckets useful for UI grouping and severity
 * weighting:
 *   - 'inorganic'     — lead, copper, arsenic, fluoride, nitrate, etc.
 *   - 'organic'       — VOCs, SOCs (benzene, atrazine, etc.)
 *   - 'dbp'           — disinfection byproducts (TTHMs, HAA5)
 *   - 'microbial'     — coliform, e.coli, turbidity
 *   - 'radionuclide'  — radium, uranium
 *   - 'pfas'          — UCMR-tracked PFAS species
 *   - 'other'         — operational / process codes that aren't a single
 *                       contaminant (e.g. monitoring/reporting codes)
 *
 * Kept module-local to WQA. The Superfund module's contaminants
 * reference (lib/habitat/contaminants/) is keyed by text aliases and
 * serves a different lookup pattern; merging them later, once the
 * remediation matrix needs both, is a deliberate future step.
 */

export type ContaminantCategory =
  | "inorganic"
  | "organic"
  | "dbp"
  | "microbial"
  | "radionuclide"
  | "pfas"
  | "other";

export type ContaminantInfo = {
  code: string;
  name: string;
  category: ContaminantCategory;
};

/**
 * The mapping. Codes are EPA's own SDWIS contaminant_code values.
 * Sources: EPA Envirofacts data dictionary + SDWIS REF_CODE_VALUES.
 *
 * Coverage target: the ~30-50 codes that appear in residential
 * drinking-water violations and LCR samples. Expansion is cheap —
 * append a new row when the activity log flags an unmapped code in
 * real data.
 */
const CONTAMINANT_TABLE: Record<string, ContaminantInfo> = {
  // -- Inorganic chemicals (lead/copper rule + primary IOCs) -------------
  "1005": { code: "1005", name: "Arsenic", category: "inorganic" },
  "1010": { code: "1010", name: "Barium", category: "inorganic" },
  "1015": { code: "1015", name: "Cadmium", category: "inorganic" },
  "1020": { code: "1020", name: "Chromium", category: "inorganic" },
  "1022": { code: "1022", name: "Copper", category: "inorganic" },
  "1024": { code: "1024", name: "Cyanide", category: "inorganic" },
  "1025": { code: "1025", name: "Fluoride", category: "inorganic" },
  "1030": { code: "1030", name: "Mercury", category: "inorganic" },
  "1035": { code: "1035", name: "Nickel", category: "inorganic" },
  "1038": { code: "1038", name: "Nitrate", category: "inorganic" },
  "1040": { code: "1040", name: "Nitrate", category: "inorganic" },
  "1041": { code: "1041", name: "Nitrite", category: "inorganic" },
  "1045": { code: "1045", name: "Selenium", category: "inorganic" },
  "1052": { code: "1052", name: "Sodium", category: "inorganic" },
  "1074": { code: "1074", name: "Antimony", category: "inorganic" },
  "1075": { code: "1075", name: "Beryllium", category: "inorganic" },
  "1085": { code: "1085", name: "Thallium", category: "inorganic" },
  "5000": { code: "5000", name: "Lead", category: "inorganic" },

  // -- Disinfection byproducts and disinfectants -------------------------
  "1006": { code: "1006", name: "Free chlorine", category: "other" },
  "1009": { code: "1009", name: "Chloramine", category: "other" },
  "1011": { code: "1011", name: "Chlorine dioxide", category: "other" },
  "1014": { code: "1014", name: "Chlorite", category: "dbp" },
  "1017": { code: "1017", name: "Bromate", category: "dbp" },
  "2456": { code: "2456", name: "Haloacetic acids (HAA5)", category: "dbp" },
  "2950": { code: "2950", name: "Total Trihalomethanes (TTHM)", category: "dbp" },

  // -- Volatile organic compounds (the common 8+) ------------------------
  "2977": { code: "2977", name: "Benzene", category: "organic" },
  "2964": { code: "2964", name: "Carbon tetrachloride", category: "organic" },
  "2980": { code: "2980", name: "Chlorobenzene", category: "organic" },
  "2378": { code: "2378", name: "1,2-Dichlorobenzene", category: "organic" },
  "2968": { code: "2968", name: "1,2-Dichloroethane", category: "organic" },
  "2969": { code: "2969", name: "1,1-Dichloroethylene", category: "organic" },
  "2380": { code: "2380", name: "cis-1,2-Dichloroethylene", category: "organic" },
  "2979": { code: "2979", name: "trans-1,2-Dichloroethylene", category: "organic" },
  "2983": { code: "2983", name: "Dichloromethane", category: "organic" },
  "2378.1": {
    code: "2378.1",
    name: "1,4-Dichlorobenzene",
    category: "organic",
  },
  "2378.2": { code: "2378.2", name: "Ethylbenzene", category: "organic" },
  "2992": { code: "2992", name: "Styrene", category: "organic" },
  "2987": { code: "2987", name: "Tetrachloroethylene", category: "organic" },
  "2991": { code: "2991", name: "Toluene", category: "organic" },
  "2984": { code: "2984", name: "Trichloroethylene", category: "organic" },
  "2985": { code: "2985", name: "Vinyl chloride", category: "organic" },
  "2989": { code: "2989", name: "Xylenes (total)", category: "organic" },

  // -- Synthetic organic compounds (common pesticides + PCBs) ------------
  "2050": { code: "2050", name: "Atrazine", category: "organic" },
  "2105": { code: "2105", name: "Glyphosate", category: "organic" },
  "2065": { code: "2065", name: "Simazine", category: "organic" },
  "2383": { code: "2383", name: "PCBs", category: "organic" },

  // -- Microbial / surface-water-treatment-rule codes --------------------
  "3014": { code: "3014", name: "Total coliform", category: "microbial" },
  "3013": { code: "3013", name: "E. coli", category: "microbial" },
  "0100": { code: "0100", name: "Turbidity", category: "microbial" },

  // -- Radionuclides -----------------------------------------------------
  "4006": { code: "4006", name: "Combined radium (226/228)", category: "radionuclide" },
  "4010": { code: "4010", name: "Gross alpha", category: "radionuclide" },
  "4000": { code: "4000", name: "Uranium", category: "radionuclide" },

  // -- PFAS (UCMR 5 / UCMR 3 codes that started appearing in MCL data) ---
  // PFOA and PFOS were added to the SDWA primary standards in 2024; both
  // now carry SDWIS codes. PFHxS, PFNA, GenX, and PFBS round out the
  // current MCL set. Codes track EPA's most recent assignments.
  "2810": { code: "2810", name: "PFOA", category: "pfas" },
  "2811": { code: "2811", name: "PFOS", category: "pfas" },
  "2812": { code: "2812", name: "PFHxS", category: "pfas" },
  "2813": { code: "2813", name: "PFNA", category: "pfas" },
  "2814": { code: "2814", name: "HFPO-DA (GenX chemicals)", category: "pfas" },
  "2815": { code: "2815", name: "PFBS", category: "pfas" },
};

/**
 * Look up a contaminant by its SDWIS numeric code. Returns null when
 * unmapped — consumers render `contaminantNameFromCode(code)` for a
 * user-facing fallback instead.
 *
 * Exported for the test suite.
 */
export function lookupContaminant(
  code: string | null | undefined,
): ContaminantInfo | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  return CONTAMINANT_TABLE[trimmed] ?? null;
}

/**
 * User-facing name for a code. Returns the mapped name when present,
 * a stable fallback `"Contaminant code {N}"` otherwise. Never throws —
 * an unmapped code degrades the copy but doesn't break the finding.
 *
 * Exported for the test suite.
 */
export function contaminantNameFromCode(
  code: string | null | undefined,
): string {
  if (typeof code !== "string" || code.trim().length === 0) {
    return "Unspecified contaminant";
  }
  const hit = lookupContaminant(code);
  return hit ? hit.name : `Contaminant code ${code.trim()}`;
}

/**
 * Whether a code is recognized in the table. Used by the activity-log
 * narration to count unmapped codes in real EPA data — a coarse
 * coverage signal for whether the table needs expansion.
 *
 * Exported for the test suite.
 */
export function isKnownContaminantCode(
  code: string | null | undefined,
): boolean {
  return lookupContaminant(code) !== null;
}
