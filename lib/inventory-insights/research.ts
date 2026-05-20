// Zod schema + model selector for the "Research this model" feature.
// The AI call itself lives in the route handler at
// app/api/inventory/[id]/research/route.ts so that the stream can be
// piped straight to the client via the AI SDK's useObject hook. This
// file stays narrow on purpose — schema + env-driven model selection
// are the bits worth importing from multiple places (the route, the
// client-side useObject options, future tests).

import { z } from "zod";
import type { ResearchInventoryInput } from "./prompt";

// Three independently-nullable sections. The model is explicitly told
// it's allowed (and expected) to return null for any section it can't
// ground in real sources, which gives partial responses a structured
// home instead of forcing an all-or-nothing body field. `.min(1)` on
// each section means an empty string is invalid — the only way to skip
// is null, which forces a binary "I have something grounded" decision.
//
// source_urls uses .refine() rather than .url() so the generated JSON
// schema sent to the model is just `string` (OpenAI structured outputs
// rejects the "format": "uri" keyword). Runtime URL validation is
// preserved on the Zod side.
export const insightsSchema = z.object({
  headline: z.string().min(1).max(120),
  overview: z.string().min(1).max(1200).nullable(),
  service_life: z.string().min(1).max(1200).nullable(),
  maintenance: z.string().min(1).max(1200).nullable(),
  source_urls: z.array(
    z.string().refine(
      (s) => {
        try {
          new URL(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid URL" },
    ),
  ),
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
