// System prompt for the "Research this model" feature on the inventory
// detail page. Mirrors lib/briefing/zillow.ts in shape — Perplexity Sonar
// is the default model because the task is structurally identical to the
// Zillow lookup: live web search plus structured output. Separated from
// research.ts so the prompt is easy to iterate on and unit-test.

export type ResearchInventoryInput = {
  manufacturer: string | null;
  model_number: string | null;
  inventory_name: string;
  inventory_type: "appliance" | "system" | "exterior";
  ai_pills: { label: string; value: string }[] | null;
  notes: string | null;
};

export function buildResearchPrompt(input: ResearchInventoryInput): string {
  const pillsBlock = input.ai_pills?.length
    ? `\n\nDetails from the nameplate:\n${input.ai_pills
        .map((p) => `- ${p.label}: ${p.value}`)
        .join("\n")}`
    : "";

  const notesBlock = input.notes
    ? `\n\nAdditional notes:\n${input.notes}`
    : "";

  return `You are an expert at researching home appliances, systems, and equipment. The user owns a home and is documenting their inventory. They want a brief, useful summary about a specific model in their home.

Use web search to look up the specific model. Be honest: if you can't find good information about this exact model or model line, set found_specific_model to false and provide only category-level information (or set the body to a brief honest statement that you couldn't find good info).

Return your response with these fields:

- headline: A one-line category description for the item. Examples: "Built-in residential dishwashers, mid-2010s Maytag", "40-gallon natural gas water heaters, Rheem ProValue line", "Central air condensers, 14 SEER, Carrier Comfort series". Maximum 120 characters.

- body: 2-3 short paragraphs covering:
  1. What's distinctive about this model line — design choices, market positioning, how it compares to alternatives in its class
  2. Expected service life facts for major components — pumps, compressors, control boards, heating elements, etc. — and common failure points
  3. Recommended maintenance tasks at the right cadence (monthly / annually / every few years)

  Keep it practical and homeowner-focused. Avoid marketing language. Avoid speculation — if you don't know something, leave it out. Maximum 2400 characters total.

- source_urls: The URLs you grounded against. These will be stored for our records; the user may eventually see them as "Sources" links.

- found_specific_model: true if you found specific information about this exact model or model line; false if you could only speak to the broader category.

Here is what we know about the item:

Type: ${input.inventory_type}
Name: ${input.inventory_name}
Manufacturer: ${input.manufacturer ?? "(unknown)"}
Model number: ${input.model_number ?? "(unknown)"}${pillsBlock}${notesBlock}`;
}
