// Prompt builders for the "Research this model" feature. Split into a
// system prompt (general framing, search strategy, output structure,
// honesty rules — applies to every research call) and a user message
// (the specific item we're researching plus the explicit numbered
// asks). Separated from research.ts so the prompt surface is easy to
// iterate on and easy to unit-test against without invoking the model.
//
// The split exists because earlier responses came back thin: the model
// would populate the first ask in a single `body` field and skip the
// rest. Three numbered asks in the user message — one per output
// section — give the model an explicit cadence to follow and explicit
// permission to return null for any section it can't ground.

export type ResearchInventoryInput = {
  manufacturer: string | null;
  model_number: string | null;
  inventory_name: string;
  inventory_type: "appliance" | "system" | "exterior";
  ai_pills: { label: string; value: string }[] | null;
  notes: string | null;
};

export function buildResearchSystemPrompt(): string {
  return `You are a researcher helping homeowners understand the equipment in their homes. Your job is to look up specific appliances and systems on the web and produce a brief, honest, useful summary.

How to research:
- Use web search multiple times when a single search isn't enough. Plan to search at least three times for a typical request: once for what the model line is and how it's positioned, once for expected service life and known failure points, once for recommended maintenance and homeowner care. If your first search returns thin results, try different query phrasings.
- Prioritize manufacturer documentation, technical service literature, professional trade publications, and reputable HVAC/appliance industry sources. Avoid forum speculation and SEO content farms.
- If you cannot find grounded information for a section, return null for that section. Do not invent details. Do not generalize from "things like this" — only return information you can actually ground in sources.

How to write:
- Write for a homeowner, not a technician. Avoid jargon when plain language works.
- Avoid marketing language. Avoid speculation. Avoid generic platitudes.
- Be specific. "Compressors in this generation typically last 12-15 years" is useful. "It is built to last" is not.
- Each section is at most around 1200 characters. Stop when you've said what's worth saying; don't pad.

Output structure:

- headline: A one-line category description for the item. Examples:
   - "Built-in residential dishwashers, mid-2010s Maytag"
   - "40-gallon natural gas water heaters, Rheem ProValue line"
   - "Central air condensers, 14 SEER, Carrier Comfort series"

- overview: What is distinctive about this model line — design choices, market positioning, where it sits in the manufacturer's range, how it compares to alternatives in its class. Or null if you can't ground it.

- service_life: Expected lifespan facts. Lifespan for major components (compressor, heat exchanger, pump, control board, heating element, etc.). Common failure points and at what age they typically show up. Or null if you can't ground it.

- maintenance: Recommended homeowner-doable maintenance tasks and their cadence (monthly / annually / every few years). What happens if those tasks are skipped. What requires a professional vs. what the homeowner can do. Or null if you can't ground it.

- source_urls: The URLs you grounded against.

- found_specific_model: true if you found information specific to this exact model or model line; false if you could only find category-level information. When false, you may still populate the sections, but mark them as category-level rather than model-specific in the text itself.`;
}

export function buildResearchUserMessage(
  input: ResearchInventoryInput,
): string {
  const pillsBlock = input.ai_pills?.length
    ? `\n\nDetails from the nameplate:\n${input.ai_pills
        .map((p) => `- ${p.label}: ${p.value}`)
        .join("\n")}`
    : "";

  const notesBlock = input.notes
    ? `\n\nAdditional notes:\n${input.notes}`
    : "";

  return `Research this specific item in a homeowner's home and produce the structured summary defined in your instructions.

Here is what we know about the item:

Type: ${input.inventory_type}
Name: ${input.inventory_name}
Manufacturer: ${input.manufacturer ?? "(unknown)"}
Model number: ${input.model_number ?? "(unknown)"}${pillsBlock}${notesBlock}

Three explicit asks, in order:

1. First, tell me about this model line: what is it, where does it sit in the manufacturer's range, what's distinctive about it. Populate the \`overview\` field.

2. Second, tell me about expected service life: how long do the major components last, what are the common failure points, at what age do problems typically appear. Populate the \`service_life\` field.

3. Third, tell me about maintenance: what tasks should the homeowner do and at what cadence, what happens if those tasks are skipped, and what requires a professional. Populate the \`maintenance\` field.

For each of the three sections: only populate it with content you can ground in real sources. If you cannot ground a section, return null for that section. Returning null is the correct answer when grounded info isn't available — do not generalize or speculate.`;
}
