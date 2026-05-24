/**
 * Canonical contaminants table.
 *
 * This dataset is the single source of truth that other habitat modules
 * (EPA Superfund proximity, future water-system and soil modules)
 * resolve their raw EPA strings against. Each entry pins a canonical
 * spelling, a list of aliases the upstream sources actually emit, and
 * the editorial context Hearth shows to the user.
 *
 * Ordering by `rank` is editorial — lower numbers are surfaced first
 * when multiple contaminants are present at a site. Concern levels
 * are Hearth's classification, informed by EPA / ATSDR carcinogenicity
 * and persistence assessments referenced in each `description`.
 */

/**
 * Coarse grouping used for dashboard sectioning. New categories must
 * be added to this union explicitly so the type system surfaces typos
 * rather than letting an unknown bucket sneak in.
 */
export type ContaminantCategory =
  | "heavy_metal"
  | "vocs"
  | "pcbs_dioxins"
  | "pahs"
  | "pesticides"
  | "pfas"
  | "industrial_chemical"
  | "petroleum"
  | "nutrient"
  | "common_mineral"
  | "radionuclide";

/**
 * Hearth's three-stop concern scale for contaminants. Distinct from
 * the 6-stop HabitatSeverity in lib/habitat/types.ts because that
 * scale grades findings (a whole site, a whole zone), whereas this
 * one grades individual chemicals.
 */
export type ConcernLevel = "high" | "moderate" | "low";

/**
 * The route by which a contaminant typically reaches people from a
 * nearby site. Used by the Superfund recommended-actions logic
 * (issue #144) to decide which actions apply given the property's
 * situation: "test your well" for groundwater-pathway contaminants
 * when the home draws from a well; "check for vapor intrusion" for
 * volatile compounds when the home has a basement; etc.
 *
 * The enum is deliberately small. Sub-typing (e.g. "shallow
 * groundwater" vs. "deep groundwater") should wait until a real
 * product surface needs the distinction — the existing five paths
 * cover every category currently in the canonical table.
 */
export type Pathway =
  | "groundwater"
  | "vapor_intrusion"
  | "soil_exposure"
  | "surface_water"
  | "airborne_particulate";

/**
 * Plain-English explanation of how a pathway typically reaches a
 * homeowner. Keyed by pathway (not by contaminant) — one paragraph
 * covers every chemical that travels by that route. The display
 * layer (Site Detail card's "How contamination spreads" disclosure,
 * issue #146) and the recommended-actions copy (issue #144) both
 * consume these strings.
 *
 * Written in Hearth's voice. Cite EPA / ATSDR as the underlying
 * source, but don't paste verbatim — this is editorial framing
 * pitched at a non-expert homeowner.
 */
export const PATHWAY_EXPLANATIONS: Record<Pathway, string> = {
  groundwater:
    "Contaminated groundwater can migrate to private wells in the area through the same aquifer the home draws from. Municipal water systems are tested and treated separately by the utility — your water provider's most recent Consumer Confidence Report is the authoritative source for what's actually at your tap.",
  vapor_intrusion:
    "Volatile chemicals can rise as gas from contaminated soil or groundwater up through cracks in foundations and basement floors. Homes with basements, slabs in direct contact with affected soil, or sump pits near the contamination footprint are the typical settings of concern.",
  soil_exposure:
    "Contaminants in soil reach people through direct contact with bare skin, hand-to-mouth contact (a particular concern for young children who play in yards), and inhalation of dust kicked up by digging or wind. Garden produce grown in affected soil can also concentrate certain chemicals.",
  surface_water:
    "Contaminants can run off into nearby lakes, rivers, and streams, then bioaccumulate up the food chain in fish and shellfish. The most direct homeowner exposure path is eating fish caught downstream of an affected site — state fish-consumption advisories are the authoritative guide for which waters and species to avoid.",
  airborne_particulate:
    "Dust or fibers can become airborne and travel beyond the site boundary, especially during construction, demolition, or high winds. Exposure is highest during active disturbance of the site and falls off with distance from the source.",
};

export interface Contaminant {
  /** Canonical display spelling. The form we render in user-facing copy. */
  canonical_name: string;
  /**
   * Every variant we've observed upstream — ALL-CAPS, mixed case,
   * abbreviations (PCBs, TCE), structural variants (Aroclor 1254
   * under PCBs), trade names (Lindane under Hexachlorocyclohexane).
   * Used for alias-based resolution against raw EPA strings. The
   * canonical_name appears as the first alias so a single membership
   * check covers both lookup forms.
   */
  aliases: string[];
  /** Short, common-vernacular name ("PCBs" vs the full IUPAC form). */
  common_name: string;
  /** Editorial sort key. Lower = surface first when several contaminants are present. */
  rank: number;
  category: ContaminantCategory;
  concern_level: ConcernLevel;
  /**
   * Routes by which this chemical typically reaches people from a
   * nearby contaminated site. Issue #147. Editorial assignment per
   * entry — most contaminants have one or two relevant pathways;
   * a few (PCBs, persistent pesticides) span more because they
   * accumulate across multiple media. Must be non-empty: a
   * contaminant with no plausible homeowner-relevant pathway
   * doesn't belong in the table at all.
   */
  pathways: Pathway[];
  /**
   * 2–4 sentence editorial summary describing what the chemical is,
   * where it comes from, and the health framing. Written in Hearth's
   * voice; not a verbatim EPA paste.
   */
  description: string;
  /** Authoritative external reference — EPA, ATSDR, or equivalent. */
  epa_url: string;
}

export const CONTAMINANTS: Contaminant[] = [
  {
    canonical_name: "Arsenic",
    aliases: [
      "Arsenic",
      "ARSENIC",
      "arsenic",
      "Arsenic, inorganic",
      "Inorganic arsenic",
    ],
    common_name: "Arsenic",
    rank: 1,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A naturally occurring element that also enters soil and groundwater through mining, smelting, wood preservatives, and pesticide use. Long-term exposure is associated with several cancers and cardiovascular effects, and arsenic is classified as a known human carcinogen.",
    epa_url: "https://www.epa.gov/dwreginfo/chemical-contaminant-rules",
  },
  {
    canonical_name: "Lead",
    aliases: [
      "Lead",
      "LEAD",
      "lead",
      "Pb",
      "Lead and compounds",
      "Inorganic lead",
    ],
    common_name: "Lead",
    rank: 2,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A heavy metal historically used in paint, plumbing solder, and leaded gasoline. Lead persists in soil near older housing, former industrial sites, and roadways, and exposure is particularly harmful to children's developing nervous systems even at low levels.",
    epa_url: "https://www.epa.gov/lead",
  },
  {
    canonical_name: "Mercury",
    aliases: [
      "Mercury",
      "MERCURY",
      "mercury",
      "Hg",
      "Elemental mercury",
      "Mercury, elemental",
      "Methylmercury",
      "Inorganic mercury",
    ],
    common_name: "Mercury",
    rank: 3,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["surface_water", "groundwater", "soil_exposure"],
    description:
      "A heavy metal released from coal combustion, chlor-alkali plants, gold mining, and historical use in switches, thermometers, and dental amalgam. Mercury bioaccumulates in fish as methylmercury and is a potent neurotoxin, particularly affecting developing brains.",
    epa_url: "https://www.epa.gov/mercury",
  },
  {
    canonical_name: "Vinyl chloride",
    aliases: [
      "Vinyl chloride",
      "VINYL CHLORIDE",
      "Vinyl Chloride",
      "Chloroethene",
      "CHLOROETHENE",
      "Chloroethene (Vinyl Chloride)",
      "Chloroethylene",
      "Monochloroethylene",
      "VCM",
    ],
    common_name: "Vinyl chloride",
    rank: 4,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A volatile organic compound used to manufacture PVC plastic, and also formed in groundwater as a breakdown product of chlorinated solvents like TCE and PCE. It is a known human carcinogen, and its presence in groundwater often signals nearby industrial solvent contamination.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/vinyl-chloride.pdf",
  },
  {
    canonical_name: "Polychlorinated biphenyls",
    aliases: [
      "Polychlorinated biphenyls",
      "Polychlorinated Biphenyls",
      "POLYCHLORINATED BIPHENYLS",
      "Polychlorinated Biphenyls (PCBs)",
      "Polychlorinated Biphenyls (PCBS)",
      "POLYCHLORINATED BIPHENYLS (PCBS)",
      "PCBs",
      "PCBS",
      "PCB",
      "Aroclor",
      "Aroclor 1016",
      "Aroclor 1221",
      "Aroclor 1232",
      "Aroclor 1242",
      "Aroclor 1248",
      "Aroclor 1254",
      "Aroclor 1260",
      "Aroclor 1262",
      "Aroclor 1268",
      "AROCLOR 1016",
      "AROCLOR 1221",
      "AROCLOR 1232",
      "AROCLOR 1242",
      "AROCLOR 1248",
      "AROCLOR 1254",
      "AROCLOR 1260",
    ],
    common_name: "PCBs",
    rank: 5,
    category: "pcbs_dioxins",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "A family of synthetic chlorinated compounds used in electrical equipment, hydraulic fluids, and carbonless copy paper before being banned in 1979. PCBs persist in soil and sediment for decades, accumulate in the food chain, and are classified as probable human carcinogens by the EPA.",
    epa_url: "https://www.epa.gov/pcbs",
  },
  {
    canonical_name: "Benzene",
    aliases: ["Benzene", "BENZENE", "benzene"],
    common_name: "Benzene",
    rank: 6,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A volatile component of gasoline, solvents, and industrial chemicals, often found at petroleum spill sites and former gas stations. Benzene is a known human carcinogen linked to leukemia, and it can migrate readily through soil and groundwater.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benzene.pdf",
  },
  {
    canonical_name: "Cadmium",
    aliases: ["Cadmium", "CADMIUM", "cadmium", "Cd", "Cadmium and compounds"],
    common_name: "Cadmium",
    rank: 7,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A heavy metal used in batteries, pigments, and metal plating, and released by smelting and waste incineration. Long-term exposure can damage the kidneys and bones, and cadmium is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/cadmium-compounds.pdf",
  },
  {
    canonical_name: "Benzo(a)pyrene",
    aliases: [
      "Benzo(a)pyrene",
      "Benzo[a]pyrene",
      "Benzo(A)Pyrene",
      "Benzo[a]Pyrene",
      "BENZO(A)PYRENE",
      "BENZO[A]PYRENE",
      "BaP",
      "B(a)P",
      "Benzopyrene",
    ],
    common_name: "Benzo(a)pyrene",
    rank: 8,
    category: "pahs",
    concern_level: "high",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon formed by incomplete combustion of coal, oil, wood, and tobacco, and a common component of coal tar, creosote, and asphalt. It is the most studied PAH and is classified as a known human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benzo-a-pyrene.pdf",
  },
  {
    canonical_name: "Polycyclic aromatic hydrocarbons",
    aliases: [
      "Polycyclic aromatic hydrocarbons",
      "Polycyclic Aromatic Hydrocarbons",
      "POLYCYCLIC AROMATIC HYDROCARBONS",
      "Polycyclic Aromatic Hydrocarbons (PAHs)",
      "Polycyclic Aromatic Hydrocarbons (PAHS)",
      "POLYCYCLIC AROMATIC HYDROCARBONS (PAHS)",
      "PAHs",
      "PAHS",
      "PAH",
    ],
    common_name: "PAHs",
    rank: 9,
    category: "pahs",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A group of compounds formed when fossil fuels, wood, or organic matter burn incompletely. PAHs are common at sites with coal tar, asphalt, creosote, or fuel oil contamination, and several individual PAHs are classified as probable or possible human carcinogens.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2014-03/documents/pahs_factsheet.pdf",
  },
  {
    canonical_name: "Chromium(VI)",
    aliases: [
      "Chromium(VI)",
      "Chromium (VI)",
      "Chromium VI",
      "CHROMIUM(VI)",
      "CHROMIUM (VI)",
      "Hexavalent chromium",
      "HEXAVALENT CHROMIUM",
      "Chromium, hexavalent",
      "Cr(VI)",
      "Cr VI",
    ],
    common_name: "Hexavalent chromium",
    rank: 10,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "The more toxic oxidation state of chromium, used historically in metal plating, leather tanning, wood preservatives, and corrosion inhibitors. Hexavalent chromium is a known human carcinogen when inhaled and is associated with several health effects when ingested in drinking water.",
    epa_url: "https://www.epa.gov/sdwa/chromium-drinking-water",
  },
  {
    canonical_name: "Chromium",
    aliases: [
      "Chromium",
      "CHROMIUM",
      "chromium",
      "Cr",
      "Total chromium",
      "Chromium, total",
    ],
    common_name: "Chromium",
    rank: 11,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A metallic element used in stainless steel, plating, and pigments. Total chromium reported in soil and water is a mix of the trivalent form (an essential nutrient at trace levels) and the more toxic hexavalent form; the health concern depends heavily on which form is present.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/chromium-compounds.pdf",
  },
  {
    canonical_name: "2,3,7,8-Tetrachlorodibenzo-p-dioxin",
    aliases: [
      "2,3,7,8-Tetrachlorodibenzo-p-dioxin",
      "2,3,7,8-Tetrachlorodibenzo-P-Dioxin",
      "2,3,7,8-TETRACHLORODIBENZO-P-DIOXIN",
      "TCDD",
      "2,3,7,8-TCDD",
      "Dioxin",
      "2,3,7,8-Tetrachlorodibenzo-p-dioxin (TCDD)",
      "2,3,7,8-Tetrachlorodibenzo-P-Dioxin (Tcdd)",
      "2,3,7,8-Tetrachlorodibenzo-p-dioxin (TCDD) Toxicity Equivalents (TEQ)",
      "2,3,7,8-Tetrachlorodibenzo-P-Dioxin (Tcdd) Toxicity Equivalents (Teq)",
      "TCDD TEQ",
      "Dioxin TEQ",
    ],
    common_name: "TCDD (a dioxin)",
    rank: 12,
    category: "pcbs_dioxins",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      'The most toxic chlorinated dioxin, an unintentional byproduct of combustion, chemical manufacturing, and chlorine bleaching. TCDD is classified as a known human carcinogen, persists in soil for decades, and accumulates in fatty tissue. "Toxicity equivalents" or TEQ values express a mixture of related dioxins as an equivalent amount of TCDD.',
    epa_url: "https://www.epa.gov/dioxin",
  },
  {
    canonical_name: "Chlorinated dioxins and furans",
    aliases: [
      "Chlorinated dioxins and furans",
      "Chlorinated Dioxins and Furans",
      "CHLORINATED DIOXINS AND FURANS",
      "Dioxins and furans",
      "Dioxins/furans",
      "PCDD/PCDF",
      "Polychlorinated dibenzo-p-dioxins and dibenzofurans",
    ],
    common_name: "Dioxins & furans",
    rank: 13,
    category: "pcbs_dioxins",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "A family of chlorinated compounds produced unintentionally by combustion, waste incineration, and certain industrial processes. They persist in soil and sediment for decades, accumulate in the food chain, and several are classified as probable or known human carcinogens.",
    epa_url: "https://www.epa.gov/dioxin",
  },
  {
    canonical_name: "DDT",
    aliases: [
      "DDT",
      "ddt",
      "4,4'-DDT",
      "p,p'-DDT",
      "Dichlorodiphenyltrichloroethane",
      "1,1,1-Trichloro-2,2-bis(p-chlorophenyl)ethane",
    ],
    common_name: "DDT",
    rank: 14,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater", "surface_water"],
    description:
      "A synthetic insecticide used widely from the 1940s until its U.S. ban in 1972. DDT and its breakdown products persist in soil for decades, accumulate in the food chain, and are classified as probable human carcinogens.",
    epa_url:
      "https://www.epa.gov/ingredients-used-pesticide-products/ddt-brief-history-and-status",
  },
  {
    canonical_name: "Aroclor 1254",
    aliases: ["Aroclor 1254", "AROCLOR 1254", "aroclor 1254"],
    common_name: "Aroclor 1254",
    rank: 15,
    category: "pcbs_dioxins",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "A specific commercial PCB mixture, approximately 54% chlorine by weight, used in transformers, capacitors, and hydraulic fluids before the 1979 PCB ban. Like other Aroclors, it persists in soil and sediment for decades and is treated as a probable human carcinogen.",
    epa_url: "https://www.epa.gov/pcbs",
  },
  {
    canonical_name: "Trichloroethene",
    aliases: [
      "Trichloroethene",
      "TRICHLOROETHENE",
      "Trichloroethylene",
      "TRICHLOROETHYLENE",
      "TCE",
      "1,1,2-Trichloroethene",
      "Trichloroethene (TCE)",
    ],
    common_name: "TCE",
    rank: 16,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent used historically for degreasing metal parts and in dry cleaning. TCE is among the most common groundwater contaminants at industrial and military sites, classified as a known human carcinogen, and can migrate as vapor into overlying buildings.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/trichloroethylene.pdf",
  },
  {
    canonical_name: "Tetrachloroethene",
    aliases: [
      "Tetrachloroethene",
      "TETRACHLOROETHENE",
      "Tetrachloroethylene",
      "TETRACHLOROETHYLENE",
      "PCE",
      "PERC",
      "Perchloroethylene",
      "PERCHLOROETHYLENE",
      "Tetrachloroethene (PCE)",
    ],
    common_name: "PCE",
    rank: 17,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent most commonly associated with dry cleaning and metal degreasing. PCE is a common groundwater contaminant near former dry cleaners and industrial sites, is classified as a likely human carcinogen, and can intrude into buildings as vapor.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/tetrachloroethylene.pdf",
  },
  {
    canonical_name: "Hexachlorobutadiene",
    aliases: [
      "Hexachlorobutadiene",
      "HEXACHLOROBUTADIENE",
      "HCBD",
      "1,1,2,3,4,4-Hexachloro-1,3-butadiene",
    ],
    common_name: "Hexachlorobutadiene",
    rank: 18,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent and byproduct of chlorinated hydrocarbon manufacturing. It is persistent in the environment, bioaccumulates in fish, and is classified as a possible human carcinogen with documented kidney toxicity.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=864&tid=168",
  },
  {
    canonical_name: "Chlordane",
    aliases: [
      "Chlordane",
      "CHLORDANE",
      "Technical chlordane",
      "alpha-Chlordane",
      "gamma-Chlordane",
      "cis-Chlordane",
      "trans-Chlordane",
    ],
    common_name: "Chlordane",
    rank: 19,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used widely on crops and for termite control around home foundations until restricted in 1988. Chlordane persists in soil for decades, bioaccumulates, and is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/chlordane.pdf",
  },
  {
    canonical_name: "Aldrin",
    aliases: ["Aldrin", "ALDRIN", "aldrin"],
    common_name: "Aldrin",
    rank: 20,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used on crops and for termite control before being banned in the U.S. in 1987. Aldrin breaks down to the equally persistent dieldrin in soil and living tissue and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=316&tid=56",
  },
  {
    canonical_name: "Cyanide",
    aliases: [
      "Cyanide",
      "CYANIDE",
      "cyanide",
      "Hydrogen cyanide",
      "Free cyanide",
      "Total cyanide",
      "Cyanide, total",
    ],
    common_name: "Cyanide",
    rank: 21,
    category: "industrial_chemical",
    concern_level: "high",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "An anion used in metal plating, gold extraction, and some chemical manufacturing, and also produced by combustion of nitrogen-containing materials. Cyanide is acutely toxic at high doses but in soil and groundwater it typically degrades rapidly except in certain stable metal-cyanide complexes.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/cyanide-compounds.pdf",
  },
  {
    canonical_name: "DDE",
    aliases: [
      "DDE",
      "4,4'-DDE",
      "p,p'-DDE",
      "1,1-Dichloro-2,2-bis(p-chlorophenyl)ethylene",
    ],
    common_name: "DDE",
    rank: 22,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "A persistent breakdown product of the banned insecticide DDT. DDE accumulates in soil, sediment, and the food chain and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=80&tid=20",
  },
  {
    canonical_name: "Dieldrin",
    aliases: ["Dieldrin", "DIELDRIN", "dieldrin"],
    common_name: "Dieldrin",
    rank: 23,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used heavily on corn and for termite control until banned for most uses in 1974. Dieldrin is extremely persistent in soil, bioaccumulates, and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=316&tid=56",
  },
  {
    canonical_name: "Heptachlor",
    aliases: ["Heptachlor", "HEPTACHLOR", "Heptachlor epoxide"],
    common_name: "Heptachlor",
    rank: 24,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used on crops and for termite control before its 1988 ban. It breaks down to the equally persistent heptachlor epoxide and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=744&tid=135",
  },
  {
    canonical_name: "Benzo(b)fluoranthene",
    aliases: [
      "Benzo(b)fluoranthene",
      "Benzo[b]fluoranthene",
      "Benzo(B)Fluoranthene",
      "Benzo[b]Fluoranthene",
      "BENZO(B)FLUORANTHENE",
      "BENZO[B]FLUORANTHENE",
      "B(b)F",
    ],
    common_name: "Benzo(b)fluoranthene",
    rank: 25,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon formed from incomplete combustion of fossil fuels and organic matter, often found alongside other PAHs in coal tar, soot, and asphalt residues. It is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benzo-b-fluoranthene.pdf",
  },
  {
    canonical_name: "Benzo(a)anthracene",
    aliases: [
      "Benzo(a)anthracene",
      "Benzo[a]anthracene",
      "Benzo(A)Anthracene",
      "Benzo[a]Anthracene",
      "BENZO(A)ANTHRACENE",
      "BENZO[A]ANTHRACENE",
      "1,2-Benzanthracene",
    ],
    common_name: "Benzo(a)anthracene",
    rank: 26,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon produced by incomplete combustion and present in coal tar, creosote, and vehicle exhaust. It is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benz-a-anthracene.pdf",
  },
  {
    canonical_name: "Asbestos",
    aliases: [
      "Asbestos",
      "ASBESTOS",
      "asbestos",
      "Chrysotile",
      "Amosite",
      "Crocidolite",
      "Asbestos fibers",
    ],
    common_name: "Asbestos",
    rank: 27,
    category: "industrial_chemical",
    concern_level: "high",
    pathways: ["airborne_particulate"],
    description:
      "A group of naturally occurring fibrous minerals once widely used in insulation, flooring, roofing, and pipe wraps. Inhaled asbestos fibers are a known human carcinogen and cause mesothelioma, lung cancer, and asbestosis; risk is associated with fibers becoming airborne during disturbance.",
    epa_url: "https://www.epa.gov/asbestos",
  },
  {
    canonical_name: "Toxaphene",
    aliases: ["Toxaphene", "TOXAPHENE", "Chlorinated camphene"],
    common_name: "Toxaphene",
    rank: 28,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "An organochlorine insecticide once used heavily on cotton and livestock, banned in the U.S. in 1990. Toxaphene persists in soil and sediment for decades and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=295&tid=53",
  },
  {
    canonical_name: "Hexachlorocyclohexane",
    aliases: [
      "Hexachlorocyclohexane",
      "HEXACHLOROCYCLOHEXANE",
      "HCH",
      "Lindane",
      "LINDANE",
      "gamma-HCH",
      "alpha-HCH",
      "beta-HCH",
      "Benzene hexachloride",
      "BHC",
    ],
    common_name: "Lindane / HCH",
    rank: 29,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A family of organochlorine insecticides; the gamma isomer (lindane) was used on crops, livestock, and as a lice treatment before being phased out. The isomers persist in soil and are classified as probable human carcinogens.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=754&tid=138",
  },
  {
    canonical_name: "DDD",
    aliases: [
      "DDD",
      "4,4'-DDD",
      "p,p'-DDD",
      "TDE",
      "1,1-Dichloro-2,2-bis(p-chlorophenyl)ethane",
    ],
    common_name: "DDD",
    rank: 30,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "An organochlorine insecticide and a breakdown product of DDT. It persists in soil and sediment for decades, bioaccumulates in the food chain, and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=80&tid=20",
  },
  {
    canonical_name: "PFOA",
    aliases: [
      "PFOA",
      "Perfluorooctanoic acid",
      "PERFLUOROOCTANOIC ACID",
      "C8",
      "Perfluorooctanoate",
    ],
    common_name: "PFOA",
    rank: 31,
    category: "pfas",
    concern_level: "high",
    pathways: ["groundwater", "surface_water", "soil_exposure"],
    description:
      'A perfluorinated chemical used in nonstick coatings, stain repellents, and firefighting foams. Often called a "forever chemical" because it doesn\'t break down, PFOA is found in drinking water near manufacturing and military training sites and is associated with several health effects at low exposure levels.',
    epa_url: "https://www.epa.gov/pfas",
  },
  {
    canonical_name: "PFOS",
    aliases: [
      "PFOS",
      "Perfluorooctanesulfonic acid",
      "PERFLUOROOCTANESULFONIC ACID",
      "Perfluorooctane sulfonate",
      "Perfluorooctanesulfonate",
    ],
    common_name: "PFOS",
    rank: 32,
    category: "pfas",
    concern_level: "high",
    pathways: ["groundwater", "surface_water", "soil_exposure"],
    description:
      "A perfluorinated chemical used in stain-resistant fabrics, food packaging, and firefighting foams. Like other PFAS, PFOS persists indefinitely in water and accumulates in the body, and is associated with immune, developmental, and other health effects.",
    epa_url: "https://www.epa.gov/pfas",
  },
  {
    canonical_name: "Beryllium",
    aliases: [
      "Beryllium",
      "BERYLLIUM",
      "beryllium",
      "Be",
      "Beryllium and compounds",
    ],
    common_name: "Beryllium",
    rank: 33,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater", "airborne_particulate"],
    description:
      "A lightweight metal used in aerospace alloys, electronics, and nuclear applications. Inhaled beryllium is a known human carcinogen and causes chronic beryllium disease, though uptake from soil contamination is generally limited.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/beryllium-compounds.pdf",
  },
  {
    canonical_name: "Endrin",
    aliases: ["Endrin", "ENDRIN", "endrin"],
    common_name: "Endrin",
    rank: 34,
    category: "pesticides",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used on cotton, grain, and orchards before being banned in the U.S. in 1986. It persists in soil and is acutely toxic, though it is not classified as a carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=615&tid=114",
  },
  {
    canonical_name: "Pentachlorophenol",
    aliases: [
      "Pentachlorophenol",
      "Pentachlorophenol",
      "PENTACHLOROPHENOL",
      "PCP",
      "Penta",
    ],
    common_name: "Pentachlorophenol",
    rank: 35,
    category: "industrial_chemical",
    concern_level: "high",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A chlorinated phenol used as a wood preservative for utility poles, railroad ties, and lumber. It persists in soil at treatment sites, often contains dioxin impurities, and is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/ingredients-used-pesticide-products/pentachlorophenol",
  },
  {
    canonical_name: "Carbon tetrachloride",
    aliases: [
      "Carbon tetrachloride",
      "CARBON TETRACHLORIDE",
      "Tetrachloromethane",
      "CCl4",
    ],
    common_name: "Carbon tetrachloride",
    rank: 36,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent once used in dry cleaning, refrigerants, and fire extinguishers. It is a likely human carcinogen, persists in groundwater, and can damage the liver and kidneys.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/carbon-tetrachloride.pdf",
  },
  {
    canonical_name: "Hexachlorobenzene",
    aliases: [
      "Hexachlorobenzene",
      "HEXACHLOROBENZENE",
      "HCB",
      "Perchlorobenzene",
    ],
    common_name: "Hexachlorobenzene",
    rank: 37,
    category: "industrial_chemical",
    concern_level: "high",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "A persistent organic pollutant formerly used as a fungicide and produced as a byproduct of chlorinated chemical manufacturing. It persists in soil and sediment, bioaccumulates, and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=627&tid=115",
  },
  {
    canonical_name: "Dibenzo(a,h)anthracene",
    aliases: [
      "Dibenzo(a,h)anthracene",
      "Dibenz(a,h)anthracene",
      "Dibenzo[a,h]anthracene",
      "Dibenz[a,h]anthracene",
      "Dibenzo(a,H)Anthracene",
      "Dibenz(a,H)Anthracene",
      "DIBENZO(A,H)ANTHRACENE",
      "DIBENZ(A,H)ANTHRACENE",
    ],
    common_name: "Dibenzo(a,h)anthracene",
    rank: 38,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon formed by incomplete combustion of fossil fuels and organic material. It is one of the more potent PAHs in animal studies and is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/dibenzo-a-h-anthracene.pdf",
  },
  {
    canonical_name: "Disulfoton",
    aliases: ["Disulfoton", "DISULFOTON", "Di-Syston"],
    common_name: "Disulfoton",
    rank: 39,
    category: "pesticides",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organophosphate insecticide used on cotton, tobacco, and ornamentals. It is acutely toxic but breaks down in soil within weeks to months, so persistence at older sites is limited.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=559&tid=104",
  },
  {
    canonical_name: "Endosulfan",
    aliases: [
      "Endosulfan",
      "ENDOSULFAN",
      "alpha-Endosulfan",
      "beta-Endosulfan",
      "Endosulfan sulfate",
    ],
    common_name: "Endosulfan",
    rank: 40,
    category: "pesticides",
    concern_level: "moderate",
    pathways: ["soil_exposure", "surface_water"],
    description:
      "An organochlorine insecticide used on a wide range of crops; its use in the U.S. was phased out by 2016. It persists in soil, bioaccumulates moderately, and is acutely toxic to aquatic life.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=607&tid=113",
  },
  {
    canonical_name: "Endrin ketone",
    aliases: ["Endrin ketone", "ENDRIN KETONE", "Endrin Ketone"],
    common_name: "Endrin ketone",
    rank: 41,
    category: "pesticides",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A breakdown product of the banned insecticide endrin, found at sites with historical endrin contamination. It persists in soil and sediment along with the parent compound.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=615&tid=114",
  },
  {
    canonical_name: "1,2-Dibromoethane",
    aliases: [
      "1,2-Dibromoethane",
      "1,2-DIBROMOETHANE",
      "Ethylene dibromide",
      "EDB",
      "Dibromoethane",
    ],
    common_name: "EDB",
    rank: 42,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A brominated solvent and former gasoline additive and soil fumigant, banned for most U.S. uses in 1984. It is persistent in groundwater at very low concentrations and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=727&tid=131",
  },
  {
    canonical_name: "1,2-Dibromo-3-chloropropane",
    aliases: [
      "1,2-Dibromo-3-chloropropane",
      "1,2-DIBROMO-3-CHLOROPROPANE",
      "DBCP",
      "Dibromochloropropane",
    ],
    common_name: "DBCP",
    rank: 43,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A soil fumigant used on fruit and vegetable crops until banned in 1979 after links to reproductive harm. It persists in groundwater for decades and is classified as a probable human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=478&tid=85",
  },
  {
    canonical_name: "Nickel",
    aliases: ["Nickel", "NICKEL", "nickel", "Ni", "Nickel and compounds"],
    common_name: "Nickel",
    rank: 44,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A metallic element used in stainless steel, batteries, and electroplating. Inhaled nickel compounds are classified as carcinogenic, but oral exposure from typical soil concentrations is a much smaller concern; nickel is also a common cause of skin contact allergy.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/nickel-compounds.pdf",
  },
  {
    canonical_name: "Zinc",
    aliases: ["Zinc", "ZINC", "zinc", "Zn"],
    common_name: "Zinc",
    rank: 45,
    category: "heavy_metal",
    concern_level: "low",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A common metal used in galvanizing, batteries, and brass, and an essential nutrient at trace levels. Elevated soil zinc occurs near smelting, mining, and galvanized infrastructure but is rarely a primary health concern at residential exposure levels.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=301&tid=54",
  },
  {
    canonical_name: "Carbon disulfide",
    aliases: ["Carbon disulfide", "CARBON DISULFIDE", "CS2"],
    common_name: "Carbon disulfide",
    rank: 46,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A volatile solvent used in rayon manufacturing, rubber processing, and as a fumigant. It can affect the nervous system at high exposures but is less persistent in soil than many chlorinated solvents.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=471&tid=84",
  },
  {
    canonical_name: "Methoxychlor",
    aliases: ["Methoxychlor", "METHOXYCHLOR"],
    common_name: "Methoxychlor",
    rank: 47,
    category: "pesticides",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An organochlorine insecticide used as a DDT replacement on crops and livestock, with U.S. registration cancelled in 2003. It is less persistent than DDT but still accumulates in soil and sediment.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=778&tid=151",
  },
  {
    canonical_name: "Chloroform",
    aliases: ["Chloroform", "CHLOROFORM", "Trichloromethane", "CHCl3"],
    common_name: "Chloroform",
    rank: 48,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent and a common disinfection byproduct from chlorinated drinking water. At Superfund sites it indicates historical solvent use; chloroform is classified as a probable human carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/chloroform.pdf",
  },
  {
    canonical_name: "Bis(2-ethylhexyl) phthalate",
    aliases: [
      "Bis(2-ethylhexyl) phthalate",
      "Bis(2-Ethylhexyl)Phthalate",
      "Bis(2-ethylhexyl)phthalate",
      "BIS(2-ETHYLHEXYL)PHTHALATE",
      "DEHP",
      "Di(2-ethylhexyl) phthalate",
      "Di-2-ethylhexyl phthalate",
      "Diethylhexyl phthalate",
    ],
    common_name: "DEHP",
    rank: 49,
    category: "industrial_chemical",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "The most widely used phthalate plasticizer, added to PVC plastics to make them flexible. It is widespread in the environment from product leaching and disposal, classified as a probable human carcinogen, and a suspected endocrine disruptor.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/bis-2-ethylhexyl-phthalate.pdf",
  },
  {
    canonical_name: "Cobalt",
    aliases: ["Cobalt", "COBALT", "cobalt", "Co"],
    common_name: "Cobalt",
    rank: 50,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A metallic element used in alloys, batteries, pigments, and as an essential trace nutrient (as vitamin B12). Elevated cobalt occurs near mining, smelting, and battery manufacturing; chronic high exposure can affect the heart and thyroid.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=372&tid=64",
  },
  {
    canonical_name: "Manganese",
    aliases: ["Manganese", "MANGANESE", "manganese", "Mn"],
    common_name: "Manganese",
    rank: 51,
    category: "heavy_metal",
    concern_level: "low",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A common metallic element essential to human nutrition at trace levels and naturally abundant in many soils. Elevated manganese in drinking water can affect the nervous system at chronic high exposures, but reported soil values often reflect natural background rather than contamination.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=101&tid=23",
  },
  {
    canonical_name: "Toluene",
    aliases: ["Toluene", "TOLUENE", "toluene", "Methylbenzene"],
    common_name: "Toluene",
    rank: 52,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A volatile aromatic solvent found in gasoline, paint thinners, and adhesives. It is common at petroleum spill sites and can affect the nervous system at high inhalation exposures, but is not classified as a carcinogen.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/toluene.pdf",
  },
  {
    canonical_name: "Antimony",
    aliases: [
      "Antimony",
      "ANTIMONY",
      "antimony",
      "Sb",
      "Antimony and compounds",
    ],
    common_name: "Antimony",
    rank: 53,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A metallic element used in flame retardants, lead-acid batteries, and alloys. Long-term exposure to elevated levels can affect the heart and lungs; it is most often found near smelting and battery recycling sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=331&tid=58",
  },
  {
    canonical_name: "Indeno(1,2,3-cd)pyrene",
    aliases: [
      "Indeno(1,2,3-cd)pyrene",
      "Indeno[1,2,3-cd]pyrene",
      "Indeno(1,2,3-Cd)Pyrene",
      "Indeno[1,2,3-Cd]Pyrene",
      "INDENO(1,2,3-CD)PYRENE",
      "INDENO[1,2,3-CD]PYRENE",
    ],
    common_name: "Indeno(1,2,3-cd)pyrene",
    rank: 54,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon produced by incomplete combustion of fossil fuels and organic matter. It is classified as a probable human carcinogen and typically appears alongside other PAHs in coal tar and combustion residues.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/indeno-pyrene.pdf",
  },
  {
    canonical_name: "Xylenes",
    aliases: [
      "Xylenes",
      "Xylene",
      "XYLENE",
      "XYLENES",
      "Mixed xylenes",
      "Xylene (mixed isomers)",
      "Xylene (Mixed Isomers)",
      "XYLENE (MIXED ISOMERS)",
      "Total xylenes",
      "o-Xylene",
      "m-Xylene",
      "p-Xylene",
      "Dimethylbenzene",
    ],
    common_name: "Xylenes",
    rank: 55,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      'A trio of aromatic solvents found in gasoline, paints, and adhesives, commonly reported together as "mixed isomers." Xylenes are common at petroleum and solvent spill sites; high exposures can affect the nervous system but they are not classified as carcinogens.',
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=296&tid=53",
  },
  {
    canonical_name: "1,1-Dichloroethene",
    aliases: [
      "1,1-Dichloroethene",
      "1,1-DICHLOROETHENE",
      "1,1-Dichloroethylene",
      "1,1-DCE",
      "Vinylidene chloride",
      "1,1-DICHLOROETHYLENE",
    ],
    common_name: "1,1-DCE",
    rank: 56,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent and a breakdown product of TCE and 1,1,1-trichloroethane in groundwater. It is classified as a possible human carcinogen and can affect the liver and kidneys at high exposures.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=464&tid=82",
  },
  {
    canonical_name: "1,2-Dichloroethane",
    aliases: [
      "1,2-Dichloroethane",
      "1,2-DICHLOROETHANE",
      "Ethylene dichloride",
      "EDC",
      "1,2-DCA",
    ],
    common_name: "1,2-DCA",
    rank: 57,
    category: "vocs",
    concern_level: "high",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent and former gasoline additive used in vinyl chloride manufacturing. It is a likely human carcinogen, persists in groundwater, and is one of the more commonly detected chlorinated VOCs at industrial sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/1-2-dichloroethane.pdf",
  },
  {
    canonical_name: "Ethylbenzene",
    aliases: ["Ethylbenzene", "ETHYLBENZENE", "ethylbenzene", "Phenylethane"],
    common_name: "Ethylbenzene",
    rank: 58,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "An aromatic solvent and the E in BTEX, found in gasoline, paints, and styrene production. It is classified as a possible human carcinogen and commonly co-occurs with benzene, toluene, and xylenes at petroleum spill sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=383&tid=66",
  },
  {
    canonical_name: "Selenium",
    aliases: ["Selenium", "SELENIUM", "selenium", "Se"],
    common_name: "Selenium",
    rank: 59,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A trace element essential in tiny amounts but harmful at higher exposures, found near coal combustion, mining, and some agricultural areas. Chronic high exposure can affect the hair, nails, and nervous system.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=153&tid=28",
  },
  {
    canonical_name: "Copper",
    aliases: ["Copper", "COPPER", "copper", "Cu"],
    common_name: "Copper",
    rank: 60,
    category: "heavy_metal",
    concern_level: "low",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A common metal used in plumbing, wiring, and alloys, and an essential trace nutrient. Elevated copper in soil occurs near mining and smelting; in drinking water it can cause taste issues and, at high concentrations, gastrointestinal effects.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=205&tid=37",
  },
  {
    canonical_name: "1,1,1-Trichloroethane",
    aliases: [
      "1,1,1-Trichloroethane",
      "1,1,1-TRICHLOROETHANE",
      "1,1,1-TCA",
      "Methyl chloroform",
      "TCA",
    ],
    common_name: "1,1,1-TCA",
    rank: 61,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent widely used for metal degreasing and as an aerosol propellant before being phased out under the Montreal Protocol. It is common in older industrial groundwater plumes and is not classified as a human carcinogen, though it can affect the nervous system at high exposures.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=464&tid=82",
  },
  {
    canonical_name: "Vanadium",
    aliases: ["Vanadium", "VANADIUM", "vanadium", "V"],
    common_name: "Vanadium",
    rank: 62,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A metallic element used in steel alloys and as a catalyst, and released by burning oil and coal. It is often present at low levels in soil as natural background; chronic high exposure can irritate the lungs and gastrointestinal tract.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=274&tid=50",
  },
  {
    canonical_name: "Barium",
    aliases: ["Barium", "BARIUM", "barium", "Ba"],
    common_name: "Barium",
    rank: 63,
    category: "heavy_metal",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A naturally occurring metal used in drilling muds, paints, and bricks. Soluble barium compounds can affect the heart and blood pressure at high exposures, but most barium in soil is in insoluble forms with limited uptake.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=327&tid=57",
  },
  {
    canonical_name: "Silver",
    aliases: ["Silver", "SILVER", "silver", "Ag"],
    common_name: "Silver",
    rank: 64,
    category: "heavy_metal",
    concern_level: "low",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A precious metal used in electronics, photography, and antimicrobial coatings. Silver in soil is generally not a significant health concern at typical contamination levels; chronic high exposure can cause harmless skin discoloration called argyria.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=538&tid=97",
  },
  {
    canonical_name: "Thallium",
    aliases: ["Thallium", "THALLIUM", "thallium", "Tl"],
    common_name: "Thallium",
    rank: 65,
    category: "heavy_metal",
    concern_level: "high",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A heavy metal once used in rat poison and historically released by cement and smelting operations. Thallium is highly toxic to the nervous system and is taken up by plants, though it is uncommon at typical residential sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=308&tid=49",
  },
  {
    canonical_name: "Chrysene",
    aliases: ["Chrysene", "CHRYSENE", "chrysene"],
    common_name: "Chrysene",
    rank: 66,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon formed by incomplete combustion and present in coal tar, creosote, and vehicle exhaust. It is classified as a probable human carcinogen and commonly appears alongside other PAHs.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/chrysene.pdf",
  },
  {
    canonical_name: "Benzo(k)fluoranthene",
    aliases: [
      "Benzo(k)fluoranthene",
      "Benzo[k]fluoranthene",
      "Benzo(K)Fluoranthene",
      "Benzo[k]Fluoranthene",
      "BENZO(K)FLUORANTHENE",
      "BENZO[K]FLUORANTHENE",
      "B(k)F",
    ],
    common_name: "Benzo(k)fluoranthene",
    rank: 67,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon produced by incomplete combustion of fossil fuels and organic matter. It is classified as a possible human carcinogen and commonly co-occurs with other PAHs in coal tar and soot.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benzo-k-fluoranthene.pdf",
  },
  {
    canonical_name: "Naphthalene",
    aliases: ["Naphthalene", "NAPHTHALENE", "naphthalene", "Naphthalin"],
    common_name: "Naphthalene",
    rank: 68,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater", "vapor_intrusion"],
    description:
      "The simplest polycyclic aromatic hydrocarbon, used historically in mothballs and as a feedstock for dyes and resins, and a major component of coal tar and creosote. It is classified as a possible human carcinogen and is commonly the most volatile PAH found at coal tar and petroleum sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/naphthalene.pdf",
  },
  {
    canonical_name: "Atrazine",
    aliases: ["Atrazine", "ATRAZINE", "atrazine"],
    common_name: "Atrazine",
    rank: 69,
    category: "pesticides",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A widely used herbicide applied to corn and other crops, and one of the most frequently detected pesticides in U.S. surface and groundwater. It is a suspected endocrine disruptor, and EPA regulates it under the Safe Drinking Water Act.",
    epa_url: "https://www.epa.gov/ingredients-used-pesticide-products/atrazine",
  },
  {
    canonical_name: "1,1,2-Trichloroethane",
    aliases: [
      "1,1,2-Trichloroethane",
      "1,1,2-TRICHLOROETHANE",
      "1,1,2-TCA",
      "Vinyl trichloride",
    ],
    common_name: "1,1,2-TCA",
    rank: 70,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent used in the production of vinylidene chloride and as a degreaser. It is less common than 1,1,1-TCA in groundwater but is classified as a possible human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=801&tid=156",
  },
  {
    canonical_name: "Benzo(ghi)perylene",
    aliases: [
      "Benzo(ghi)perylene",
      "Benzo[ghi]perylene",
      "Benzo(Ghi)Perylene",
      "Benzo[Ghi]Perylene",
      "BENZO(GHI)PERYLENE",
      "BENZO[GHI]PERYLENE",
    ],
    common_name: "Benzo(ghi)perylene",
    rank: 71,
    category: "pahs",
    concern_level: "low",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon found in coal tar, asphalt, and vehicle exhaust. It is not classified as carcinogenic on its own but is part of the PAH mixture typically present at combustion-related sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/benzo-ghi-perylene.pdf",
  },
  {
    canonical_name: "Fluoranthene",
    aliases: ["Fluoranthene", "FLUORANTHENE", "fluoranthene"],
    common_name: "Fluoranthene",
    rank: 72,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon present in coal tar, creosote, and combustion residues. It is not classified as a human carcinogen but is one of the more abundant PAHs at contaminated sites and is toxic to aquatic life.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/fluoranthene.pdf",
  },
  {
    canonical_name: "Dichloromethane",
    aliases: [
      "Dichloromethane",
      "DICHLOROMETHANE",
      "Methylene chloride",
      "METHYLENE CHLORIDE",
      "Methylene Chloride",
      "Dichloromethane (Methylene Chloride)",
      "DCM",
      "Methylene dichloride",
    ],
    common_name: "Methylene chloride",
    rank: 73,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent used in paint stripping, degreasing, and pharmaceutical extraction. It is classified as a likely human carcinogen and is volatile enough to pose vapor intrusion concerns at contaminated sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/methylene-chloride.pdf",
  },
  {
    canonical_name: "Phenanthrene",
    aliases: ["Phenanthrene", "PHENANTHRENE", "phenanthrene"],
    common_name: "Phenanthrene",
    rank: 74,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon abundant in coal tar, creosote, and combustion residues. It is not classified as a human carcinogen but is one of the most common PAHs at contaminated sites and is used as an indicator of broader PAH contamination.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=121&tid=25",
  },
  {
    canonical_name: "Anthracene",
    aliases: ["Anthracene", "ANTHRACENE", "anthracene"],
    common_name: "Anthracene",
    rank: 75,
    category: "pahs",
    concern_level: "low",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon found in coal tar and used historically in dyes. It is not classified as a human carcinogen and is one of the less toxic PAHs, though it is part of the broader PAH mixture at combustion sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/anthracene.pdf",
  },
  {
    canonical_name: "Pyrene",
    aliases: ["Pyrene", "PYRENE", "pyrene"],
    common_name: "Pyrene",
    rank: 76,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon common to coal tar, creosote, and vehicle exhaust. It is not classified as a human carcinogen but is often used alongside fluoranthene as an indicator of PAH contamination.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/pyrene.pdf",
  },
  {
    canonical_name: "Chlorobenzene",
    aliases: [
      "Chlorobenzene",
      "CHLOROBENZENE",
      "chlorobenzene",
      "Monochlorobenzene",
      "Phenyl chloride",
      "MCB",
    ],
    common_name: "Chlorobenzene",
    rank: 77,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A chlorinated solvent used as an intermediate in pesticide and dye manufacturing and as a degreaser. It is not classified as a human carcinogen but can affect the liver and nervous system at high exposures.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=627&tid=115",
  },
  {
    canonical_name: "MTBE",
    aliases: [
      "MTBE",
      "Methyl tert-butyl ether",
      "METHYL TERT-BUTYL ETHER",
      "tert-Butyl methyl ether",
      "2-Methoxy-2-methylpropane",
    ],
    common_name: "MTBE",
    rank: 78,
    category: "petroleum",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "A gasoline additive used widely in the 1990s and 2000s to reduce air pollution before being phased out due to groundwater contamination. MTBE migrates rapidly in groundwater, has a strong turpentine-like taste at very low concentrations, and is classified as a possible human carcinogen.",
    epa_url:
      "https://www.epa.gov/dwstandardsregulations/methyl-tertiary-butyl-ether-mtbe",
  },
  {
    canonical_name: "Total petroleum hydrocarbons",
    aliases: [
      "Total petroleum hydrocarbons",
      "Total Petroleum Hydrocarbons",
      "TOTAL PETROLEUM HYDROCARBONS",
      "TPH",
      "Petroleum hydrocarbons",
      "Gasoline range organics",
      "GRO",
      "Diesel range organics",
      "DRO",
    ],
    common_name: "TPH",
    rank: 79,
    category: "petroleum",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion", "soil_exposure"],
    description:
      "A bulk measurement that captures hundreds of compounds from gasoline, diesel, and oil spills rather than a single chemical. The health significance depends on which fractions are present; specific contaminants like benzene are usually evaluated separately.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=423&tid=75",
  },
  {
    canonical_name: "1,2,4-Trimethylbenzene",
    aliases: [
      "1,2,4-Trimethylbenzene",
      "1,2,4-TRIMETHYLBENZENE",
      "Pseudocumene",
      "1,2,4-TMB",
    ],
    common_name: "1,2,4-TMB",
    rank: 80,
    category: "vocs",
    concern_level: "moderate",
    pathways: ["groundwater", "vapor_intrusion"],
    description:
      "An aromatic solvent component of gasoline and diesel fuel. It is commonly detected at petroleum spill sites and can affect the nervous system and respiratory tract at high exposures, but is not classified as a carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=1112&tid=237",
  },
  {
    canonical_name: "Phenol",
    aliases: ["Phenol", "PHENOL", "phenol", "Carbolic acid", "Hydroxybenzene"],
    common_name: "Phenol",
    rank: 81,
    category: "industrial_chemical",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "An aromatic compound used to manufacture plastics, resins, and disinfectants. It is acutely toxic but degrades relatively quickly in soil; it is not classified as a human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=146&tid=27",
  },
  {
    canonical_name: "2,4,6-Trichlorophenol",
    aliases: ["2,4,6-Trichlorophenol", "2,4,6-TRICHLOROPHENOL", "2,4,6-TCP"],
    common_name: "2,4,6-Trichlorophenol",
    rank: 82,
    category: "industrial_chemical",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A chlorinated phenol used historically as a fungicide and wood preservative and as an intermediate in pesticide manufacturing. It is classified as a probable human carcinogen and is commonly found alongside pentachlorophenol at wood treatment sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=276&tid=50",
  },
  {
    canonical_name: "4-Methylphenol",
    aliases: [
      "4-Methylphenol",
      "4-METHYLPHENOL",
      "p-Cresol",
      "P-Cresol",
      "P-CRESOL",
      "para-Cresol",
      "4-Methylphenol (p-Cresol)",
      "4-Methylphenol (P-Cresol)",
      "Cresol",
    ],
    common_name: "p-Cresol",
    rank: 83,
    category: "industrial_chemical",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A methylated phenol found in coal tar, creosote, and wood-treatment wastes, and produced naturally by some bacteria. It is corrosive at high exposures and is classified as a possible human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=691&tid=125",
  },
  {
    canonical_name: "4-Chloro-3-methylphenol",
    aliases: [
      "4-Chloro-3-methylphenol",
      "4-CHLORO-3-METHYLPHENOL",
      "p-Chloro-m-cresol",
      "PCMC",
      "Parachlorometacresol",
    ],
    common_name: "4-Chloro-3-methylphenol",
    rank: 84,
    category: "industrial_chemical",
    concern_level: "moderate",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A chlorinated phenol used as a preservative in glues, paints, and inks, and as a disinfectant. It is moderately toxic and persists in soil but is not classified as a human carcinogen.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=121&tid=25",
  },
  {
    canonical_name: "2-Methylnaphthalene",
    aliases: [
      "2-Methylnaphthalene",
      "2-METHYLNAPHTHALENE",
      "2-MN",
      "beta-Methylnaphthalene",
    ],
    common_name: "2-Methylnaphthalene",
    rank: 85,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure", "vapor_intrusion"],
    description:
      "A methylated polycyclic aromatic hydrocarbon and major component of creosote, coal tar, and diesel fuel. It is not classified as a carcinogen but commonly co-occurs with naphthalene at petroleum and coal tar sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=240&tid=43",
  },
  {
    canonical_name: "Fluorene",
    aliases: [
      "Fluorene",
      "FLUORENE",
      "fluorene",
      "9H-Fluorene",
      "9h-Fluorene",
      "9H-FLUORENE",
    ],
    common_name: "Fluorene",
    rank: 86,
    category: "pahs",
    concern_level: "low",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon found in coal tar, creosote, and diesel exhaust. It is not classified as a human carcinogen and is one of the less toxic PAHs, though it commonly appears alongside other PAHs at combustion sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/fluorene.pdf",
  },
  {
    canonical_name: "Carbazole",
    aliases: [
      "Carbazole",
      "CARBAZOLE",
      "9H-Carbazole",
      "9h-Carbazole",
      "9H-CARBAZOLE",
      "Dibenzopyrrole",
    ],
    common_name: "Carbazole",
    rank: 87,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "A nitrogen-containing aromatic compound found in coal tar and crude oil and used in dye and pigment manufacturing. It is classified as a possible human carcinogen and commonly appears at coal tar and creosote-contaminated sites.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=121&tid=25",
  },
  {
    canonical_name: "Dibenzofuran",
    aliases: ["Dibenzofuran", "DIBENZOFURAN", "dibenzofuran"],
    common_name: "Dibenzofuran",
    rank: 88,
    category: "pahs",
    concern_level: "moderate",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "An oxygen-containing aromatic compound found in coal tar, creosote, and as a structural relative of the chlorinated dibenzofurans. The unchlorinated form found at coal tar sites is much less toxic than the chlorinated dioxin-related furans.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=121&tid=25",
  },
  {
    canonical_name: "Acenaphthene",
    aliases: ["Acenaphthene", "ACENAPHTHENE", "acenaphthene"],
    common_name: "Acenaphthene",
    rank: 89,
    category: "pahs",
    concern_level: "low",
    pathways: ["soil_exposure"],
    description:
      "A polycyclic aromatic hydrocarbon found in coal tar and creosote. It is not classified as a human carcinogen and is one of the lower-toxicity PAHs, though it is part of the broader PAH mixture at contaminated sites.",
    epa_url:
      "https://www.epa.gov/sites/default/files/2016-09/documents/acenaphthene.pdf",
  },
  {
    canonical_name: "Chromium(III) chloride",
    aliases: [
      "Chromium(III) chloride",
      "Chromium(III) Chloride",
      "CHROMIUM(III) CHLORIDE",
      "Chromium III chloride",
      "Trivalent chromium chloride",
      "Chromic chloride",
    ],
    common_name: "Chromium(III) chloride",
    rank: 90,
    category: "heavy_metal",
    concern_level: "low",
    pathways: ["groundwater", "soil_exposure"],
    description:
      "A trivalent chromium salt; trivalent chromium is an essential trace nutrient at very low intakes and is far less toxic than hexavalent chromium. At residential exposure levels it is generally not a primary contaminant of concern.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=61&tid=17",
  },
  {
    canonical_name: "Phosphorus",
    aliases: [
      "Phosphorus",
      "PHOSPHORUS",
      "phosphorus",
      "P",
      "Total phosphorus",
    ],
    common_name: "Phosphorus",
    rank: 91,
    category: "nutrient",
    concern_level: "low",
    pathways: ["surface_water", "groundwater"],
    description:
      "An essential nutrient abundant in soils, used heavily in fertilizers and detergents. Reported phosphorus in environmental data is typically a measure of nutrient loading rather than a contaminant of direct human health concern; its main impact is on surface water quality through algal growth.",
    epa_url: "https://www.epa.gov/nutrientpollution",
  },
  {
    canonical_name: "Nitrate",
    aliases: [
      "Nitrate",
      "NITRATE",
      "nitrate",
      "NO3",
      "Nitrate-N",
      "Nitrate as N",
      "Nitrate (as N)",
    ],
    common_name: "Nitrate",
    rank: 92,
    category: "nutrient",
    concern_level: "moderate",
    pathways: ["groundwater"],
    description:
      "A common nitrogen compound from fertilizer, septic systems, and animal waste, and one of the most widespread groundwater contaminants. In drinking water it is regulated because high levels can interfere with oxygen transport in infants (methemoglobinemia).",
    epa_url: "https://www.epa.gov/sdwa/chemical-contaminant-rules",
  },
  {
    canonical_name: "Ammonia",
    aliases: [
      "Ammonia",
      "AMMONIA",
      "ammonia",
      "NH3",
      "Ammonia-N",
      "Ammonia as N",
      "Total ammonia",
    ],
    common_name: "Ammonia",
    rank: 93,
    category: "nutrient",
    concern_level: "low",
    pathways: ["groundwater", "surface_water"],
    description:
      "A nitrogen compound from fertilizer, animal waste, and industrial processes. At typical groundwater concentrations it is not a primary human health concern, but it can be toxic to aquatic life and contributes to nutrient pollution.",
    epa_url: "https://www.epa.gov/nutrientpollution",
  },
  {
    canonical_name: "Iron",
    aliases: ["Iron", "IRON", "iron", "Fe"],
    common_name: "Iron",
    rank: 94,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["groundwater"],
    description:
      "A common natural element present in nearly all soils. When it appears in EPA contamination data, iron is usually a background mineral rather than a primary contaminant of concern, though high concentrations in drinking water can affect taste and color.",
    epa_url:
      "https://www.epa.gov/sdwa/secondary-drinking-water-standards-guidance-nuisance-chemicals",
  },
  {
    canonical_name: "Aluminum",
    aliases: ["Aluminum", "ALUMINUM", "aluminum", "Aluminium", "Al"],
    common_name: "Aluminum",
    rank: 95,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["soil_exposure", "groundwater"],
    description:
      "One of the most abundant elements in Earth's crust and a major component of most soils. When it appears in EPA contamination data it is typically a natural background constituent rather than a primary contaminant of concern.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/tf.asp?id=190&tid=34",
  },
  {
    canonical_name: "Magnesium",
    aliases: ["Magnesium", "MAGNESIUM", "magnesium", "Mg"],
    common_name: "Magnesium",
    rank: 96,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["groundwater"],
    description:
      "An essential mineral and a major natural component of soil, groundwater, and rock. When it appears in EPA data it almost always reflects natural background rather than contamination.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/index.asp",
  },
  {
    canonical_name: "Sodium",
    aliases: ["Sodium", "SODIUM", "sodium", "Na"],
    common_name: "Sodium",
    rank: 97,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["groundwater"],
    description:
      "A common natural element abundant in soils and groundwater. When sodium appears in EPA contamination data it is typically natural background or from road salt rather than a primary contaminant of concern.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/index.asp",
  },
  {
    canonical_name: "Calcium",
    aliases: ["Calcium", "CALCIUM", "calcium", "Ca"],
    common_name: "Calcium",
    rank: 98,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["groundwater"],
    description:
      "An essential mineral and one of the most abundant elements in soil and rock. When it appears in EPA data it reflects natural background and is not a contaminant of human health concern.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/index.asp",
  },
  {
    canonical_name: "Potassium",
    aliases: ["Potassium", "POTASSIUM", "potassium", "K"],
    common_name: "Potassium",
    rank: 99,
    category: "common_mineral",
    concern_level: "low",
    pathways: ["groundwater"],
    description:
      "An essential mineral and abundant natural soil component, also used in fertilizers. When reported in EPA data it almost always reflects natural background rather than contamination.",
    epa_url: "https://www.atsdr.cdc.gov/toxfaqs/index.asp",
  },
  {
    canonical_name: "Radon",
    aliases: ["Radon", "RADON", "radon", "Radon-222", "Rn"],
    common_name: "Radon",
    rank: 100,
    category: "radionuclide",
    concern_level: "high",
    pathways: ["vapor_intrusion", "airborne_particulate"],
    description:
      "A naturally occurring radioactive gas formed by the decay of uranium in soil and rock. Radon is the second leading cause of lung cancer in the U.S. and can accumulate in homes built over uranium-bearing geology; EPA recommends testing all homes.",
    epa_url: "https://www.epa.gov/radon",
  },
];
