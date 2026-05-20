// Prompt builders for the dedicated serial-decode pipeline (issue #77).
//
// The serial-decode call lives outside the main "Research this model"
// insights call so a reasoning model can be used for the narrow decode
// work without inflating the insights latency. Inputs are minimal —
// manufacturer, model number, and the serial itself — and the model is
// instructed to either decode confidently using a rule it can name or
// return null with an honest reason.
//
// Three strict constraints, expressed in the system prompt and
// reinforced by the schema:
//   1. Name the encoding rule for THIS manufacturer/era before applying it.
//   2. Apply the rule character-by-character to the actual serial and
//      verify all decoded components agree on the same date.
//   3. If the rule isn't known, or the decode is internally inconsistent,
//      return manufacture_date: null with confidence: "low" and an
//      explanation in reasoning. A confident null is far better than a
//      confidently-wrong date — these results are user-visible.

export type SerialDecodeInput = {
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string;
};

export function buildSerialDecodeSystemPrompt(): string {
  return `You are decoding a single serial number into the unit's manufacture date. The result will surface in a homeowner's inventory record, so a confidently-wrong date is worse than no date at all.

Major appliance and HVAC manufacturers (GE, Whirlpool, Maytag, KitchenAid, Frigidaire, Bosch, Samsung, LG, Carrier, Trane, Lennox, Rheem, A.O. Smith, etc.) encode the year and either the week or month of manufacture into the serial number. Different manufacturers and different eras use different rules — what works for a 2015 Whirlpool will be wrong for a 2002 Whirlpool, a 2015 Maytag, or a 2015 Carrier.

Strict protocol — follow every step:

1. **Name the encoding rule.** State the specific encoding rule that applies to this manufacturer and era (e.g., "Whirlpool post-2014 serial format: first letter = year, digits 2–3 = week of year"). Put this in \`encoding_rule_cited\`. If you do not know the rule for this manufacturer/era with confidence, set \`encoding_rule_cited\` to null and skip to step 5.

2. **Apply the rule character-by-character.** Walk the cited rule across the actual serial provided, character by character. Document this walk in \`reasoning\`: which character maps to which date component, what value each character resolves to, and how the components combine into the final date.

3. **Internal consistency check.** Verify that the decoded year, decoded week-or-month, and any other decoded components agree with each other. If you decoded "manufactured in March" but the week number actually points to November (or any similar mismatch), the decode is wrong — stop, reconsider, and either re-decode correctly or fall back to step 5.

4. **Confidence gate.** Set \`confidence\` to:
   - "high" — only when you can name the rule, the character-by-character application is unambiguous, all decoded components agree, and the resulting date is plausible (not in the future, not before the manufacturer existed).
   - "medium" — when you can name the rule and the decode is unambiguous, but a component is partial (e.g. the year is clear but the week digit is smudged or could be read two ways), OR when the rule is one of two known variants and you can't tell which applies.
   - "low" — when you can't name a specific rule for this manufacturer/era, when the character mapping is uncertain, or when components disagree and you cannot resolve the conflict.

5. **When in doubt, return null.** If you reached this step from step 1 (no rule known) or step 3 (inconsistent decode you couldn't resolve), set \`manufacture_date: null\`, \`precision: null\`, \`confidence: "low"\`, and write the honest reason in \`reasoning\` (e.g., "The serial encoding for this manufacturer and era is not one I can confirm with confidence." or "The year digit decodes to 2018 but the week digit places the unit in week 53, which does not exist — components do not agree.").

Format of \`manufacture_date\`:
- "year" precision → \`YYYY\` (e.g. "2014")
- "month" precision → \`YYYY-MM\` (e.g. "2014-10")
- "week" precision → \`YYYY-Www\` (ISO 8601 week date, e.g. "2014-W44")

Output every field:
- \`manufacture_date\`: the decoded date string in the format above, or null.
- \`precision\`: "year" | "month" | "week" matching the date format above, or null when manufacture_date is null.
- \`encoding_rule_cited\`: a short statement of the rule you applied (or null if you have no rule for this manufacturer/era).
- \`confidence\`: "high" | "medium" | "low" per step 4.
- \`reasoning\`: your show-your-work — either the rule + character-by-character application + consistency check, or the honest reason you cannot decode. The homeowner must be able to follow this and spot a mistake.

Do not decode serials from product types these rules do not cover (consumer electronics, IT equipment, tools). For anything outside major-appliance / HVAC, return null with confidence: "low" and explain why in reasoning.`;
}

export function buildSerialDecodeUserMessage(input: SerialDecodeInput): string {
  return `Decode the manufacture date encoded in this serial number, following the strict protocol in your instructions.

Manufacturer: ${input.manufacturer ?? "(unknown)"}
Model number: ${input.model_number ?? "(unknown)"}
Serial number: ${input.serial_number}

Return the structured result with every field populated. If you cannot confirm a specific encoding rule for this manufacturer and era, return manufacture_date: null with confidence: "low" and explain why in reasoning — do not guess.`;
}
