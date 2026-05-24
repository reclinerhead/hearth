/**
 * Generate the Superfund portfolio-summary paragraph via the Vercel
 * AI Gateway, with graceful fallback when the env var is unset or the
 * model call fails.
 *
 * Soft-fail by design: the Superfund module's primary job is producing
 * the structured finding (sites, severities, distances, the activity
 * log). The summary is value-add — if the AI call can't run, we
 * persist the finding with `text: null` and surface the cause in the
 * activity log + error_reason. We never fail the whole check() over a
 * missing or broken summary call.
 *
 * No file-based debug log in this slice. The maintenance-synthesis
 * pattern that lands a per-call log file requires the AI call to live
 * inside a `"use step"` boundary in the workflow file (so the dynamic
 * import of `node:fs/promises` is bundled as step code, not workflow
 * code). The Superfund AI call runs inside the module's check() which
 * is reached from a step but isn't a step boundary itself, so any
 * import of Node.js built-ins anywhere in the module's transitive
 * import graph gets caught by the workflow bundler's static analysis.
 * A follow-up that lifts the AI call into a habitat-workflow step
 * will land the debug log alongside. For now, we surface failures via
 * `console.warn` and the per-finding activity-log entry.
 */

import { generateObject } from "ai";
import {
  buildPortfolioSummarySystemPrompt,
  buildPortfolioSummaryUserMessage,
  type PortfolioSummaryInput,
} from "./prompt";
import {
  getPortfolioSummaryModel,
  portfolioSummarySchema,
} from "./schema";

export type GeneratedPortfolioSummary = {
  /** Generated summary text, or null when we couldn't produce one. */
  text: string | null;
  /** Model string used, or null when no model was configured. */
  model: string | null;
  /** ISO timestamp the call finished, or null when no call ran. */
  generated_at: string | null;
  /** Human-readable reason when text is null. Null on success. */
  error_reason: string | null;
};

export async function generatePortfolioSummary(
  input: PortfolioSummaryInput,
): Promise<GeneratedPortfolioSummary> {
  const model = getPortfolioSummaryModel();
  if (!model) {
    return {
      text: null,
      model: null,
      generated_at: null,
      error_reason:
        "SUPERFUND_SUMMARY_MODEL (or BRIEFING_PRIMARY_MODEL) is not set",
    };
  }

  const systemPrompt = buildPortfolioSummarySystemPrompt();
  const userMessage = buildPortfolioSummaryUserMessage(input);

  try {
    const result = await generateObject({
      model,
      schema: portfolioSummarySchema,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    return {
      text: result.object.summary,
      model,
      generated_at: new Date().toISOString(),
      error_reason: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[superfund-summary] generateObject failed:",
      message,
      "— persisting finding without summary",
    );
    return {
      text: null,
      model,
      generated_at: null,
      error_reason: message,
    };
  }
}
