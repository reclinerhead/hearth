// CCR (Consumer Confidence Report) extraction schema. Issue #176 — WQA-3.
//
// This schema is the load-bearing contract between the extraction
// prompt and every downstream WQA surface. Its shape is deliberately
// narrow:
//
//   1. header_metadata        — utility name, PWSID, coverage year,
//                               publication date. Used for the
//                               (PWSID, year) shared-cache key and
//                               for the EPA-vs-CCR cross-check.
//   2. detected_contaminants  — the core of the extraction. Each row
//                               is a measured contaminant with the
//                               level, MCL, MCLG, sources, monitoring
//                               period, and the utility's own
//                               violation flag for the period.
//   3. lead_copper_distribution — 90th percentile values, sample
//                               counts, lead-service-line counts when
//                               the CCR states a count.
//   4. ucmr_results           — the utility's UCMR (Unregulated
//                               Contaminant Monitoring Rule) results
//                               when the CCR includes them.
//   5. free_testing_offer     — a single nullable flag. The only
//                               narrative-shaped field we extract,
//                               because the WQA awareness payload's
//                               free-testing affordance is load-
//                               bearing for a downstream UI surface.
//
// EVERYTHING ELSE IN THE CCR IS DELIBERATELY NOT EXTRACTED. CCRs vary
// wildly in marketing-fluff volume — some are 4-page dense tables,
// others are 20-page glossy brochures with photos, staff bios, and
// infrastructure-investment narratives. The schema is the bulwark
// against that variance: if a piece of content has nowhere to land
// in the schema, the model has no reason to extract it.
//
// Categories explicitly NOT represented anywhere in this schema:
//   * Source-water assessments, watershed names, watershed protection
//   * Lead service line replacement program narrative / timelines
//   * Infrastructure improvement plans, capital projects, treatment
//     upgrades
//   * Educational narrative ("what is a contaminant", definitions)
//   * Compliance narrative as prose (actual data comes from WQA-2's
//     SDWIS pull)
//   * Awards, recognitions, certifications
//   * Photographs, staff bios, message-from-the-director
//   * Customer tips (lead flushing instructions, conservation)
//   * Contact info beyond the free-testing offer (admin contact is
//     already in WQA-1's water_systems.email_addr / phone_number)
//   * Pricing, rate structures, billing
//   * Climate / sustainability / community-engagement copy
//
// If a future product surface needs one of these categories, that
// becomes its own focused project with its own schema decision —
// don't quietly grow the CCR extraction to absorb it. See the WQA-3
// issue's "Out of scope at the extraction-prompt level" section.
//
// All five sections are independently nullable so the model can
// extract partial data honestly when the CCR is missing a section,
// rather than fabricating to fill the shape.

import { z } from "zod";

// Header metadata. The model cross-checks utility_name and pwsid
// against the WQA-1 record we pass in the user prompt. publication_
// date is null when the CCR doesn't print one unambiguously
// ("Spring 2025" — don't invent).
const ccrHeaderMetadataSchema = z.object({
  utility_name: z.string().min(1).max(200).nullable(),

  // EPA Public Water System ID. Format is a 2-letter state code + 7
  // digits ("MI0003520"). We don't enforce the format here — the
  // utility itself sometimes prints it loosely — but the action
  // layer compares this to water_systems.pwsid and surfaces a
  // mismatch error if they disagree.
  pwsid: z.string().min(1).max(40).nullable(),

  // The coverage year the CCR documents (a "2024 Water Quality
  // Report" usually documents 2023 data). Stored as a number so the
  // shared-cache lookup compares cleanly. We accept 1990..3000 as a
  // sanity range; anything outside that is almost certainly an
  // extraction error and should fall to null instead.
  report_year: z.number().int().gte(1990).lte(3000).nullable(),

  // ISO YYYY-MM-DD when the document itself states one cleanly.
  // Null when the CCR uses vague timing ("Annual report for 2024"
  // with no specific publication date).
  publication_date: z.string().nullable(),
});

// One detected contaminant row. CCRs typically list 20-60
// contaminants in a table; many will be "ND" (non-detect) which the
// prompt drops — only contaminants with an actual measured level
// land here.
const ccrDetectedContaminantSchema = z.object({
  // Contaminant name as printed in the CCR ("Total Trihalomethanes",
  // "Lead", "PFOA"). The downstream summarizer maps this against the
  // contaminant-codes reference in lib/habitat/modules/water-
  // quality-awareness/data/contaminant-codes.ts to derive tier
  // classification.
  contaminant_name: z.string().min(1).max(200),

  // EPA contaminant code when printed in the CCR. Most utilities
  // omit this; it's nullable.
  contaminant_code: z.string().max(40).nullable(),

  // Measured level for the reporting period. Numeric so the
  // summarizer can compare against MCL without parsing. Range-
  // shaped CCR values ("0.5 – 2.1") aren't supported here; the
  // prompt picks the higher endpoint as the reported level and the
  // notes field on the contaminant captures the range.
  detected_level: z.number().nullable(),

  // Unit as printed in the report ("ppb", "mg/L", "pCi/L"). No
  // unit conversion happens during extraction — the summarizer
  // normalizes downstream.
  unit: z.string().min(1).max(40).nullable(),

  // Federal MCL (Maximum Contaminant Level). Kept as a numeric
  // when the CCR prints it numerically; null when the CCR prints a
  // range or text expression that doesn't parse cleanly.
  mcl: z.number().nullable(),

  // MCLG (Maximum Contaminant Level Goal). Same shape and rules
  // as mcl. MCLG is the health-based goal; MCL is the enforceable
  // limit. The summarizer surfaces both when present.
  mclg: z.number().nullable(),

  // For lead and copper, the federal "action level" displaces the
  // MCL — the LCR rule uses an action level instead. Captured
  // separately so the summarizer doesn't confuse the two.
  mcl_action_level: z.number().nullable(),

  // Likely sources of the contaminant, as printed by the utility.
  // CCRs print boilerplate text here ("Erosion of natural deposits;
  // discharge from refineries and factories"); kept short to avoid
  // accidentally absorbing nearby paragraph text.
  sources: z.string().max(500).nullable(),

  // Monitoring period as printed ("2024", "Q3 2023", "Annual").
  // Free text because CCR conventions vary wildly.
  monitoring_period: z.string().max(80).nullable(),

  // Whether the report itself flags this contaminant as in
  // violation for the period. The federal violation flag tracks
  // the SYSTEM's annual average; an individual sampling period can
  // exceed MCL without triggering. The summarizer uses the
  // detected_level vs. MCL comparison separately from this flag.
  violation_in_period_ind: z.boolean().nullable(),

  // Free-text notes from the row — captures range expressions,
  // footnotes, "below detection at most sites" qualifiers. Kept
  // short because the prompt is instructed not to absorb adjacent
  // paragraph text.
  notes: z.string().max(300).nullable(),
});

// Lead and copper distribution. CCRs typically have a dedicated
// table for these because LCR rules require it. The structure can
// vary — some report lead and copper jointly in one table, others
// split. The schema accepts both lead and copper as optional sub-
// objects.
const ccrLeadCopperEntrySchema = z.object({
  // 90th percentile value across sampled homes for the reporting
  // period. The LCR action level is what triggers regulatory
  // response.
  percentile_90: z.number().nullable(),
  unit: z.string().min(1).max(40).nullable(),

  // Federal action level (15 ppb for lead, 1.3 mg/L for copper).
  action_level: z.number().nullable(),

  // How many homes were sampled. Useful context for "how
  // representative is this number".
  samples_collected: z.number().int().nonnegative().nullable(),

  // How many samples exceeded the action level. Distinct from the
  // 90th percentile — a system can have several over-action-level
  // samples while still passing the 90th percentile rule.
  samples_exceeding_action_level: z.number().int().nonnegative().nullable(),

  // Monitoring period as printed.
  monitoring_period: z.string().max(80).nullable(),
});

const ccrLeadCopperDistributionSchema = z.object({
  // Lead-specific row. Null when the CCR doesn't report lead
  // separately.
  lead: ccrLeadCopperEntrySchema.nullable(),

  // Copper-specific row. Null when the CCR doesn't report copper
  // separately.
  copper: ccrLeadCopperEntrySchema.nullable(),

  // Total number of lead service lines on the system when the CCR
  // states a count. Many CCRs print narrative about LSL
  // replacement programs without giving a count — the schema
  // captures only the count, not the narrative. Null when no count
  // is stated.
  lead_service_line_count: z.number().int().nonnegative().nullable(),
});

// One UCMR (Unregulated Contaminant Monitoring Rule) result row.
// Some CCRs include the utility's UCMR results inline; others
// don't. Tight shape — name, level, unit, period.
const ccrUcmrResultSchema = z.object({
  contaminant_name: z.string().min(1).max(200),
  detected_level: z.number().nullable(),
  unit: z.string().min(1).max(40).nullable(),
  monitoring_period: z.string().max(80).nullable(),
});

// Free-testing offer. The single narrative-shaped field we extract.
// Captured only when the utility plainly offers free in-home water
// testing for residential customers. The WQA awareness payload's
// free-testing affordance depends on this flag; that is the ONLY
// reason any narrative-shaped data is extracted.
const ccrFreeTestingOfferSchema = z.object({
  // Whether the CCR plainly states the utility offers free
  // residential water testing. False when the CCR says nothing
  // about free testing OR when it only offers paid testing.
  offered: z.boolean(),

  // How the resident reaches the utility for testing, when the
  // offer includes a contact method.
  contact_method: z.enum(["phone", "email", "web"]).nullable(),

  // The phone number / email / URL exactly as printed. Null when
  // the offer is mentioned but no contact method is given (rare —
  // most offers print at least a phone number).
  contact_value: z.string().max(300).nullable(),
});

// The full extraction shape. All five sections are top-level
// nullable so the model can return partial extractions honestly.
// ai_confidence is the model's overall confidence in what it
// returned; the action layer surfaces a "we couldn't read that
// clearly" affordance when this is below threshold.
//
// NO OTHER TOP-LEVEL FIELDS EXIST ON THIS SCHEMA. The excluded
// categories listed at the top of this file have nowhere to land
// even if the model tried to extract them — `generateObject`
// rejects unknown fields by default. That's deliberate.
export const ccrExtractionSchema = z.object({
  header_metadata: ccrHeaderMetadataSchema.nullable(),
  detected_contaminants: z.array(ccrDetectedContaminantSchema).nullable(),
  lead_copper_distribution: ccrLeadCopperDistributionSchema.nullable(),
  ucmr_results: z.array(ccrUcmrResultSchema).nullable(),
  free_testing_offer: ccrFreeTestingOfferSchema.nullable(),

  ai_confidence: z.number().min(0).max(1),
});

export type CcrExtractionResult = z.infer<typeof ccrExtractionSchema>;

export type CcrHeaderMetadata = z.infer<typeof ccrHeaderMetadataSchema>;
export type CcrDetectedContaminant = z.infer<typeof ccrDetectedContaminantSchema>;
export type CcrLeadCopperEntry = z.infer<typeof ccrLeadCopperEntrySchema>;
export type CcrLeadCopperDistribution = z.infer<
  typeof ccrLeadCopperDistributionSchema
>;
export type CcrUcmrResult = z.infer<typeof ccrUcmrResultSchema>;
export type CcrFreeTestingOffer = z.infer<typeof ccrFreeTestingOfferSchema>;
