/**
 * Zod schema + env-driven model selector for the EPA Superfund
 * portfolio-summary AI call (issue #140).
 *
 * The schema is intentionally narrow — one string field. The 40-char
 * minimum rejects empty/whitespace outputs that would render as a blank
 * banner; the 1200-char ceiling matches the same generous-but-bounded
 * shape the inventory-insights schema uses for free-form sections,
 * sized comfortably for the 4-sentence cap the prompt enforces.
 */

import { z } from "zod";

export const portfolioSummarySchema = z.object({
  summary: z.string().min(40).max(1200),
});

export type PortfolioSummaryResult = z.infer<typeof portfolioSummarySchema>;

/**
 * Read the configured model from env, falling back to BRIEFING_PRIMARY_MODEL
 * so the env knob is optional in development environments that already
 * have the briefing model wired up. Returns an empty string when neither
 * is set — the caller treats that as "skip the AI call, persist the
 * finding without a summary" rather than failing the whole check().
 */
export function getPortfolioSummaryModel(): string {
  return (
    process.env.SUPERFUND_SUMMARY_MODEL ??
    process.env.BRIEFING_PRIMARY_MODEL ??
    ""
  );
}
