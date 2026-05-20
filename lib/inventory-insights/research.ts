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

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
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

  const systemPrompt = buildResearchSystemPrompt();
  const userMessage = buildResearchUserMessage(input);

  const startedAt = new Date();
  const startNs = process.hrtime.bigint();

  let result;
  let thrown: unknown = null;
  try {
    result = await generateObject({
      model,
      schema: insightsSchema,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    return result.object;
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    void writeInsightsDebugLog({
      startedAt,
      durationMs,
      model,
      input,
      systemPrompt,
      userMessage,
      response: result?.object ?? null,
      error: thrown
        ? thrown instanceof Error
          ? { name: thrown.name, message: thrown.message }
          : { name: "unknown", message: String(thrown) }
        : null,
    });
  }
}

type InsightsDebugLogEntry = {
  startedAt: Date;
  durationMs: number;
  model: string;
  input: ResearchInventoryInput;
  systemPrompt: string;
  userMessage: string;
  response: InsightsResult | null;
  error: { name: string; message: string } | null;
};

// Local-only debug log for prompt/response iteration. Written to
// `logs/ai-insights-prompts.log` at the repo root (gitignored). All errors
// are swallowed so a logging failure can never break the user request.
async function writeInsightsDebugLog(entry: InsightsDebugLogEntry) {
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "ai-insights-prompts.log");

    const block = [
      "================================================================================",
      `Timestamp:    ${entry.startedAt.toISOString()}`,
      `Model:        ${entry.model}`,
      `Duration:     ${entry.durationMs.toFixed(0)} ms`,
      `Status:       ${entry.error ? `error (${entry.error.name}: ${entry.error.message})` : "ok"}`,
      "",
      "--- input ---",
      JSON.stringify(entry.input, null, 2),
      "",
      "--- system prompt ---",
      entry.systemPrompt,
      "",
      "--- user message ---",
      entry.userMessage,
      "",
      "--- response (json) ---",
      entry.response ? JSON.stringify(entry.response, null, 2) : "(no response)",
      "",
      "",
    ].join("\n");

    await appendFile(file, block, "utf8");
  } catch (e) {
    console.warn("[inventory-insights] failed to write debug log:", e);
  }
}
