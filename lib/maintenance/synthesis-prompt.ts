// Prompt builders for the maintenance-synthesis Grok call. Same
// system + user split the Research call uses — the system prompt
// establishes the role, rules, and output contract; the user message
// provides the per-item context the model grounds in.

export function buildSynthesisSystemPrompt(): string {
  return `You are Hearth's maintenance synthesis engine. You take what we know about a specific item in a homeowner's home — what kind of equipment it is, what we've learned about its expected service life and maintenance needs, the environmental conditions around the home, and any service history we have on file — and you produce a structured list of recurring maintenance tasks the homeowner should perform.

Your output is consumed directly by Hearth's maintenance UI. Every task you emit becomes a row the user sees, completes, and reschedules. Quality matters: a thoughtful, well-cadenced task earns the user's trust; a vague or aspirational task erodes it.

WHAT COUNTS AS A TASK:

Emit a task for every meaningful recurring action a homeowner could take on this item. Include things the manufacturer describes as continuous awareness or vigilance — convert those into scheduled inspections at an appropriate cadence. "Be aware of unusual sounds from the unit" becomes "Listen for unusual sounds during normal operation" every 6 months. "Keep the area clear of combustibles" becomes "Inspect the area around the unit for combustible storage" every 12 months.

The test for whether something belongs on the list is: can the homeowner say "I did that today" at a specific moment? If yes, package it as a task. The only things to leave out are framings with no possible completion event — pure conceptual advice that can't be discretized into an action.

Most items will have somewhere between 4 and 8 meaningful recurring tasks. If you find yourself emitting more than 10, prioritize the highest-value ones. The hard ceiling is 20; output beyond that will be rejected.

CADENCE DISCIPLINE:

For each task, choose the cadence shape that best fits:
- 'interval' for tasks that recur on a flat schedule (every 3 months, every 5 years).
- 'seasonal' for tasks tied to a time of year (annual furnace service before heating season, gutter cleaning in fall). Specify both the interval (how often it repeats) and the seasonal anchor (when in the year).
- 'one_time' for tasks that should be done once and never recur (registering an appliance warranty within 90 days of install).

Don't invent cadences. Ground them in what you know about the equipment class — if the manufacturer recommends an annual flush, the cadence is 12 months. If you're recommending a homeowner-friendly inspection that isn't in the manual, pick a reasonable cadence and explain that choice in your reasoning.

USING HABITAT CONTEXT:

The user message will include habitat findings — what Hearth knows about the environment around the home. Habitat findings don't generate tasks directly; they MODULATE tasks that the item's own maintenance needs already justify.

If a finding meaningfully changes the cadence of a task — hard water shortens the anode rod's replacement interval, a flood zone makes the sump pump test more critical — adjust the cadence and explain the adjustment in the task's reasoning.modifiers array, citing the finding_module_key.

If a finding doesn't change anything for this item, don't reference it. Don't reach for a modifier just because a finding exists.

USING SERVICE HISTORY:

The user message may include linked service receipts. If a receipt's transaction_date is a meaningful anchor for a task — last year's furnace service is the anchor for next year's furnace service — set the task's reasoning.anchor.kind to 'receipt_anchored' and reference the receipt's document_id. Otherwise anchor from install_date (when known) or synthesis_default (start the clock at the synthesis run time).

The first_occurrence_days_out field is how you express the anchor in concrete terms — if last year's furnace service was 9 months ago and the cadence is annual, first_occurrence_days_out is 90.

REASONING TRANSPARENCY:

Every task you emit is paired with a reasoning object that explains why it's on the list and how its cadence was chosen. This is rendered to the user in a "Why this task" expand on the task detail. Be specific. "Manufacturer recommends annual flush" is useful. "Standard maintenance" is not.

cadence_basis is the headline explanation in plain language. modifiers is the structured list of environmental or contextual adjustments you made. anchor is where the first occurrence is grounded.

OUTPUT:

A single structured object with overall_notes (a brief summary, optional) and tasks (the array). Adhere to the schema strictly. Tasks that don't validate will be dropped.`;
}

export type SynthesisInput = {
  inventory: {
    id: string;
    name: string;
    type: "appliance" | "system" | "exterior" | "property";
    subtype: "vehicle" | "pet" | null;
    manufacturer: string | null;
    model_number: string | null;
    installed_on: string | null;
    purchased_on: string | null;
  };
  ai_insights: {
    headline: string;
    overview: string | null;
    service_life: string | null;
    maintenance: string | null;
    /** Captured from inventory.ai_insights.generated_at — flows through to the trace. */
    generated_at: string | null;
  };
  habitat_findings: Array<{
    module_key: string;
    category: string;
    severity: string;
    headline: string;
    summary: string;
  }>;
  linked_receipts: Array<{
    document_id: string;
    transaction_date: string | null;
    transaction_type: string | null;
    vendor_name: string | null;
    notes: string | null;
  }>;
};

export function buildSynthesisUserMessage(input: SynthesisInput): string {
  const item = input.inventory;
  const itemHeader = `Item: ${item.name}
Type: ${item.type}${item.subtype ? ` (${item.subtype})` : ""}
Manufacturer: ${item.manufacturer ?? "(unknown)"}
Model number: ${item.model_number ?? "(unknown)"}
Installed: ${item.installed_on ?? "(unknown)"}
Purchased: ${item.purchased_on ?? "(unknown)"}`;

  const insights = input.ai_insights;
  const insightsBlock = `What we know about this item:

Headline: ${insights.headline}

Overview:
${insights.overview ?? "(not available)"}

Expected service life:
${insights.service_life ?? "(not available)"}

Recommended maintenance:
${insights.maintenance ?? "(not available)"}`;

  const habitatBlock =
    input.habitat_findings.length > 0
      ? `Habitat findings for this home (what's around it, what Hearth knows about the area):

${input.habitat_findings
  .map(
    (f) =>
      `- [${f.module_key}, severity: ${f.severity}] ${f.headline}\n  ${f.summary}`,
  )
  .join("\n\n")}`
      : `Habitat findings for this home: (none on file)`;

  const receiptsBlock =
    input.linked_receipts.length > 0
      ? `Service history (linked receipts and documents for this item):

${input.linked_receipts
  .map(
    (r) =>
      `- document_id: ${r.document_id}\n  date: ${r.transaction_date ?? "(unknown)"}\n  type: ${r.transaction_type ?? "(unknown)"}\n  vendor: ${r.vendor_name ?? "(unknown)"}${r.notes ? `\n  notes: ${r.notes}` : ""}`,
  )
  .join("\n\n")}`
      : `Service history: (none on file)`;

  return `${itemHeader}

${insightsBlock}

${habitatBlock}

${receiptsBlock}

Produce a structured maintenance plan for this item per your instructions.`;
}
