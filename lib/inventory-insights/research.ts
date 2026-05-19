// The "Research this model" lookup. Wraps a structured generateObject
// call to Perplexity Sonar via the Vercel AI Gateway — same pattern the
// Day One Briefing's Zillow lookup uses (lib/briefing/zillow.ts), because
// the task is structurally identical: live web search plus a strict
// output schema.
//
// Model selection prefers INVENTORY_INSIGHTS_MODEL but falls back to
// BRIEFING_PRIMARY_MODEL so a single Sonar configuration covers both
// surfaces during development. Either env var being set is enough.
//
// The function does not write to the database — that's the calling
// server action's job. Keeping the lookup pure makes it easier to test
// and to swap providers in isolation.

import { generateObject } from "ai";
import { z } from "zod";
import { buildResearchPrompt, type ResearchInventoryInput } from "./prompt";

export const insightsSchema = z.object({
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(2400),
  source_urls: z.array(z.string().url()),
  found_specific_model: z.boolean(),
});

export type InsightsResult = z.infer<typeof insightsSchema>;

export type { ResearchInventoryInput };

export function getInventoryInsightsModel(): string {
  return (
    process.env.INVENTORY_INSIGHTS_MODEL ||
    process.env.BRIEFING_PRIMARY_MODEL ||
    ""
  );
}

export async function researchInventoryModel(
  input: ResearchInventoryInput,
): Promise<InsightsResult> {
  const model = getInventoryInsightsModel();
  if (!model) {
    throw new Error(
      "Neither INVENTORY_INSIGHTS_MODEL nor BRIEFING_PRIMARY_MODEL is set.",
    );
  }

  const result = await generateObject({
    model,
    schema: insightsSchema,
    system: buildResearchPrompt(input),
    messages: [
      {
        role: "user",
        content:
          "Research this model and tell me what a homeowner should know about it.",
      },
    ],
  });
  return result.object;
}
