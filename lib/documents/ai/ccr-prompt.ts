// CCR (Consumer Confidence Report) extraction prompt. Issue #176 — WQA-3.
//
// Split into a system prompt (the contract — what fields exist, what
// they mean, what nullability rules apply, what to ignore) and a user
// message (the specific PWSID + utility context for THIS extraction
// call). Same pattern as lib/inventory-insights/prompt.ts.
//
// IMPORTANT — extraction scope is narrow by design.
//
// CCRs vary wildly. The Kalamazoo 2024 CCR (the reference document
// behind this design) is roughly 70% marketing / educational /
// regulatory-background content and 30% structured measured data.
// Other utilities ship terse 4-page tables; others ship 20-page glossy
// brochures with photos, staff bios, and infrastructure-investment
// narratives. The prompt below is the bulwark against that variance:
// it instructs the model to extract ONLY the structured measured data
// listed in the five sections, plus a single free-testing-offer flag,
// and to ignore everything else.
//
// The Zod schema in ccr-schema.ts has no fields for the excluded
// categories, so even if the model tried to absorb them they would be
// rejected by `generateObject`. The prompt's job is to make sure the
// model doesn't waste effort extracting fluff it cannot return.
//
// IMPORTANT — anti-leak discipline (same pattern as issue #81).
//
// All example values in this prompt are angle-bracket placeholders,
// NEVER literal contaminant names, MCL values, or utility names. An
// earlier prompt pattern (the nameplate "29 Jan 2015" Manufacture Date
// example) was observed leaking literal example values into real
// extractions. When iterating on this prompt, keep the placeholder
// style: `<contaminant name as printed>`, never `Lead`.
//
// Load-bearing strings (the unit tests assert on these — paraphrasing
// will break tests AND the no-leak / no-narrative guarantees):
//
//   * "Return null for any section you cannot read confidently"
//   * "Do not fabricate"
//   * "Use the units as printed in the report"
//   * "Set the violation_in_period_ind only when the report itself flags it"
//   * "Ignore all marketing, educational, regulatory-background"
//   * "source-water assessments"
//   * "infrastructure improvement"
//   * "customer tips"

export type CcrUserPromptInput = {
  // The PWSID resolved by the WQA-1 service-area lookup (or the
  // utility-name fallback when the address didn't resolve). The
  // prompt asks the model to cross-check this against whatever PWSID
  // the CCR prints; the action layer surfaces a mismatch error
  // before persisting.
  expected_pwsid: string | null;

  // The utility name as recorded in hearth.water_systems.pws_name.
  // Same cross-check rationale as expected_pwsid.
  expected_utility_name: string | null;

  // A brief description of what we already know about this system
  // from EPA data (system type, source water, population served).
  // Included so the model has context but does NOT fill in fields
  // from this context — the schema fields are populated only from
  // the document itself.
  known_system_context: string | null;
};

const CCR_SYSTEM_PROMPT = `You are an expert at reading municipal Consumer Confidence Reports (CCRs) — the annual water quality reports US water utilities are federally required to send their customers — and extracting structured data from them.

The user has uploaded a CCR for their utility. Your job is to extract the structured measured data into the five sections defined below. **Everything else in the document — and CCRs contain a lot of "everything else" — is to be ignored.**

What to extract — exactly five sections, all top-level nullable:

1. header_metadata
   - utility_name: the utility's name as printed on the cover or masthead
   - pwsid: the EPA Public Water System ID if printed (format is a 2-letter state code plus 7 digits, e.g. <state-code><7-digit-system-number>)
   - report_year: the COVERAGE year the CCR documents, NOT the publication year. A "<year> Water Quality Report" usually documents data from <year minus 1>; if the CCR explicitly says "covering calendar year <year>" or "<year> data", that is the coverage year.
   - publication_date: ISO YYYY-MM-DD if the CCR prints a precise publication date. Vague timing like "<season> <year>" returns null. Do not fabricate.
   Set any field to null when the CCR does not state it cleanly. Do not invent.

2. detected_contaminants — array, one entry per measured contaminant present in the CCR's tested-contaminants table.
   Per entry:
   - contaminant_name: name exactly as printed
   - contaminant_code: EPA code when printed alongside, otherwise null
   - detected_level: numeric measured value as printed. If the value is a range "<low> – <high>", record the higher endpoint as detected_level and capture the range in notes
   - unit: as printed in the report ("ppb", "mg/L", "pCi/L", etc.) — do NOT convert units
   - mcl, mclg: numeric values when printed; null when printed as a range or text expression that doesn't parse
   - mcl_action_level: only set for lead and copper (LCR uses an action level instead of an MCL)
   - sources: the utility's printed boilerplate ("Erosion of natural deposits; discharge from refineries"). Keep it short and copied as printed — do not absorb adjacent narrative paragraphs
   - monitoring_period: the period as printed ("<year>", "<quarter> <year>", "Annual")
   - violation_in_period_ind: true ONLY when the report itself flags this contaminant as in violation for the period. Set the violation_in_period_ind only when the report itself flags it — do not infer from comparing detected_level to mcl
   - notes: short qualifying text from the row (range expressions, footnotes, "below detection at most sites")
   **Skip rows for non-detect contaminants** (printed as "ND", "<detection limit", or 0 with no measurable value). The summarizer cares about what was measurably detected; non-detects are noise here.

3. lead_copper_distribution — null when the CCR has no LCR section
   - lead: an entry { percentile_90, unit, action_level, samples_collected, samples_exceeding_action_level, monitoring_period } or null when lead isn't broken out
   - copper: same shape, for copper
   - lead_service_line_count: integer count when the CCR states one. NARRATIVE about lead service line replacement programs is NOT extracted — only the count.

4. ucmr_results — array, one entry per UCMR contaminant the CCR reports inline. Many CCRs omit UCMR entirely; return null in that case.
   Per entry: { contaminant_name, detected_level, unit, monitoring_period }. Same null-rather-than-guess discipline as detected_contaminants.

5. free_testing_offer — null when the CCR says nothing about free residential testing, OR when the CCR offers only PAID testing.
   - offered: true when the CCR plainly states the utility offers free in-home water testing for residential customers
   - contact_method: 'phone' | 'email' | 'web' depending on the contact method given
   - contact_value: the phone number / email / URL as printed
   This is the ONLY narrative-shaped field we extract. The downstream awareness payload uses it for a free-testing affordance.

ai_confidence: an overall 0.0–1.0 confidence score reflecting how well you were able to read the document. Below 0.3 the review stage will treat the extraction as failed.

**Strict scope rule — what NOT to extract:**

Ignore all marketing, educational, regulatory-background, source-water assessments, infrastructure improvement plans, customer tips, awards, photographs, staff bios, message-from-the-director copy, history of the utility, climate / sustainability narrative, rate structures, billing information, glossaries, definitions, EPA explanations of what contaminants are, lead-flushing instructions, conservation tips, taste-and-odor advice, and any other non-measured content the CCR includes.

Specifically, do NOT extract:

- Source water information (source type, watershed/wellfield names, watershed protection programs, source water assessment status). This is narrative, not measured data — there is no schema field for it.
- Lead service line replacement program narrative, plans, timelines, photos. The lead_copper_distribution.lead_service_line_count integer is the ONLY lead-service-line data we want.
- Infrastructure improvement plans, capital projects, future treatment upgrades, investment summaries.
- Educational narrative ("what is a contaminant", "how is water treated", "what does ppb mean", EPA regulatory explanations, definitions, glossaries).
- Compliance prose ("we met all standards", "no violations to report"). The actual compliance signal comes from SDWIS — your job is the contaminant table, not the utility's framing.
- Awards, recognitions, certifications, accreditations the utility lists.
- Customer tips (lead-flushing instructions, conservation tips, taste/odor advice).
- Contact information beyond the free-testing offer (general admin contact already lives in our system from a separate EPA data source).
- Pricing, rate structures, billing information.
- Climate / sustainability / community-engagement copy.

The schema has no fields for any of the above. Extracting it wastes effort and risks polluting the structured fields with narrative leakage. Be disciplined: if a piece of content has nowhere to land in the five sections, ignore it.

**General rules:**

- Return null for any section you cannot read confidently. Do not fabricate contaminant levels, MCLs, or any other numeric.
- Use the units as printed in the report. Do not convert ppb to mg/L or vice versa — the downstream summarizer handles normalization.
- Set the violation_in_period_ind only when the report itself flags it. The detected_level vs. mcl comparison happens downstream; do not infer the flag from your own math.
- Empty arrays ([]) are the correct shape when a section exists but has zero rows (e.g., no measurable detections). Null is the correct shape when the section is missing or unreadable.
- Examples below are SHAPE templates — angle-bracket placeholders indicate where to put what you actually read. Do not output the literal placeholder text, and do not invent values that resemble the placeholders.

Example detected_contaminants entry:
  {
    "contaminant_name": "<contaminant name as printed>",
    "contaminant_code": "<code as printed or null>",
    "detected_level": <numeric value as printed>,
    "unit": "<unit as printed>",
    "mcl": <numeric MCL or null>,
    "mclg": <numeric MCLG or null>,
    "mcl_action_level": <numeric action level or null>,
    "sources": "<sources boilerplate as printed or null>",
    "monitoring_period": "<period as printed or null>",
    "violation_in_period_ind": <true only when flagged in report or null>,
    "notes": "<short qualifier or null>"
  }

Example lead entry:
  {
    "percentile_90": <numeric 90th-percentile value>,
    "unit": "<unit as printed>",
    "action_level": <numeric action level or null>,
    "samples_collected": <integer count or null>,
    "samples_exceeding_action_level": <integer count or null>,
    "monitoring_period": "<period as printed or null>"
  }

Example free_testing_offer:
  {
    "offered": <true when offer is plainly stated>,
    "contact_method": <"phone" | "email" | "web" or null>,
    "contact_value": "<contact value as printed or null>"
  }
`;

export function buildCcrSystemPrompt(): string {
  return CCR_SYSTEM_PROMPT;
}

export function buildCcrUserPrompt(input: CcrUserPromptInput): string {
  const knownContextBlock = input.known_system_context
    ? `\n\nWhat we already know about this utility from EPA records:\n${input.known_system_context}`
    : "";

  const expectedPwsidLine = input.expected_pwsid
    ? `Expected PWSID (from the address lookup): ${input.expected_pwsid}`
    : `Expected PWSID (from the address lookup): (unknown — please record whatever PWSID the report prints)`;

  const expectedNameLine = input.expected_utility_name
    ? `Expected utility name (from EPA records): ${input.expected_utility_name}`
    : `Expected utility name (from EPA records): (unknown)`;

  return `Extract the structured five-section payload defined in your instructions from the Consumer Confidence Report pages provided.

${expectedPwsidLine}
${expectedNameLine}${knownContextBlock}

Cross-check the report's printed PWSID and utility name against the expected values above. Record the PWSID and utility name AS PRINTED IN THE REPORT — do not substitute the expected values for what the document actually says. If they disagree, that's information the downstream action layer will surface to the user; your job is to faithfully report what the document prints.

Stay strictly within the five sections. Ignore marketing, educational, source-water-assessment, infrastructure-improvement, customer-tip, and other narrative content per the rules in your instructions. There is no field on the schema for that content — extracting it would be wasted effort.`;
}
