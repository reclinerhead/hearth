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
import {
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  type ResearchInventoryInput,
} from "./prompt";

// Three independently-nullable sections. The model is explicitly told
// it's allowed (and expected) to return null for any section it can't
// ground in real sources, which gives partial responses a structured
// home instead of forcing an all-or-nothing body field. `.min(1)` on
// each section means an empty string is invalid — the only way to skip
// is null, which forces a binary "I have something grounded" decision.
export const insightsSchema = z.object({
  headline: z.string().min(1).max(120),
  overview: z.string().min(1).max(1200).nullable(),
  service_life: z.string().min(1).max(1200).nullable(),
  maintenance: z.string().min(1).max(1200).nullable(),
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
    system: buildResearchSystemPrompt(),
    messages: [
      {
        role: "user",
        content: buildResearchUserMessage(input),
      },
    ],
  });
  return result.object;
}
