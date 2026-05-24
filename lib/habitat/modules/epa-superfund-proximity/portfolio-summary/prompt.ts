/**
 * Prompt builders for the EPA Superfund portfolio summary (issue #140).
 *
 * The summary is a 2–4 sentence synthesis across every qualifying site
 * near the user's home. It renders inside the finding modal as a
 * "banner" above the per-site card list, replacing the previous
 * one-sentence summary as the centerpiece. Generated once at check()
 * time and persisted on the finding's jsonb — not regenerated per view.
 *
 * Hard rules baked into the system prompt:
 *
 *   1. Never assert the property is or isn't contaminated. Hearth does
 *      not test water/soil/air. EPA, the local utility, and licensed
 *      testers are the authorities. (Acceptance criterion: "no sentence
 *      in any rendered card asserts that the specific property is or
 *      isn't contaminated.")
 *   2. Hedge calibrated, not vague. Lead with specifics; if hedging is
 *      needed, hedge precisely.
 *   3. Synthesize, don't repeat. Per-site detail lives below; the summary
 *      is the portfolio-level mental model.
 *   4. Plain English. Translate NPL codes; use plain contaminant-class
 *      names where they work.
 *   5. 2–4 sentences. Hard cap: 4 sentences.
 *
 * Example values in the system prompt are angle-bracket placeholders
 * rather than literal strings, matching the anti-leak discipline
 * established by the nameplate prompt after issue #81 (Grok was
 * observed leaking literal example values into unrelated outputs).
 */

export type PortfolioSummarySite = {
  /** Title-cased display name (`name_display` from the site shape). */
  name: string;
  distance_miles: number;
  bearing: string;
  /** Plain-English NPL status label, e.g. "Final NPL". */
  npl_status: string;
  /** Per-site label as computed by `label.ts`. */
  site_label: "worth_acting_on" | "worth_knowing" | "informational" | null;
  /** Display-formatted contaminants (already title-cased). May be empty. */
  contaminants: string[];
  archived: boolean;
};

export type PortfolioSummaryInput = {
  state: string;
  total_qualifying_sites: number;
  portfolio_label:
    | "worth_acting_on"
    | "worth_knowing"
    | "informational"
    | null;
  sites: PortfolioSummarySite[];
};

export function buildPortfolioSummarySystemPrompt(): string {
  return `You are writing the portfolio summary for an EPA Superfund habitat finding in Hearth, a software product that helps homeowners reason about facts about their home and surroundings.

The summary is the centerpiece of a panel that lists every Superfund site within 5 miles of the user's home. Per-site detail (address, contaminant list, cleanup status, "why this severity") lives in cards below your summary — do not repeat that detail. Your job is the portfolio-level mental model.

In 2 to 4 sentences, give the homeowner a coherent picture: how many sites are nearby, what fraction are active cleanups vs. monitoring vs. deleted from the NPL, which one or two sites stand out and why (closer, more concerning chemistry, more active), and what contaminant pathways recur if any pattern is visible. If a site clearly carries the most weight, name it and say why in plain language.

Hard rules:

1. **Never assert the specific property is or isn't contaminated.** Hearth does not test the user's well, soil, or air. EPA, the local water utility, and licensed testers determine whether a particular property is affected. Phrasing like "your home is contaminated", "your water is contaminated", "you are at risk", or the inverse "your home is safe", "you are not affected" is forbidden. Frame in terms of what EPA has documented at nearby sites and what a homeowner might want to keep in mind.

2. **Hedge calibrated, not vague.** "<count> sites carry documented groundwater contamination from <plain-English contaminant class>" is calibrated. "There may or may not be something near you" is vague. Lead with the specific facts the input provides; if hedging is needed, hedge precisely.

3. **Synthesize, don't repeat.** Per-site cards below your summary already render each site's name, distance, contaminants, and cleanup status. Your sentences should add something the per-site list cannot — relative weight, recurring pattern, the one or two sites that stand out.

4. **Plain English, no jargon dump.** Translate NPL codes into plain language: "F" → "active EPA cleanup" or "on the National Priorities List"; "P" → "proposed for the National Priorities List"; "A" → "rolled up under a larger NPL site nearby"; "D" → "cleanup completed and removed from the NPL". For contaminants, use the plain-English class when both work — "chlorinated solvents" for TCE/PCE/vinyl chloride, "heavy metals" for lead/arsenic/cadmium together, "PCBs" instead of "polychlorinated biphenyls", "PAHs" for the polycyclic-aromatic group.

5. **Length: 2 to 4 sentences. Hard cap: 4 sentences.** Tight beats long.

6. **No headings, no bullet lists, no markdown.** Plain prose paragraph(s). Cards and headings render elsewhere in the UI.

Return the result as the \`summary\` field of the structured output.`;
}

/**
 * User message: the structured facts the model summarizes from. The
 * shape is deliberately flat — easy to read in the debug log, easy to
 * compare across runs when iterating on the prompt.
 */
export function buildPortfolioSummaryUserMessage(
  input: PortfolioSummaryInput,
): string {
  const lines: string[] = [];
  lines.push(
    `Write a portfolio summary for the ${input.total_qualifying_sites} EPA Superfund site${input.total_qualifying_sites === 1 ? "" : "s"} within 5 miles of a home in ${input.state}.`,
  );
  lines.push("");
  if (input.portfolio_label) {
    lines.push(
      `Hearth's computed portfolio label for this finding: ${input.portfolio_label}.`,
    );
    lines.push("");
  }
  lines.push("Sites (ordered most-relevant first):");
  for (const [idx, site] of input.sites.entries()) {
    const num = idx + 1;
    const archived = site.archived ? " (archived)" : "";
    const contaminants =
      site.contaminants.length > 0
        ? site.contaminants.join(", ")
        : "(EPA has not published a contaminant inventory for this site)";
    const labelLine = site.site_label
      ? ` Hearth's per-site label: ${site.site_label}.`
      : " Hearth's per-site label: (suppressed — insufficient data to characterize).";
    lines.push(
      `  ${num}. ${site.name} — ${site.distance_miles.toFixed(1)} mi ${site.bearing}, ${site.npl_status}${archived}.${labelLine}`,
    );
    lines.push(`     Contaminants on record: ${contaminants}`);
  }
  lines.push("");
  lines.push(
    "Return the summary as the `summary` field. 2 to 4 sentences. Do not assert the user's property is or isn't contaminated.",
  );
  return lines.join("\n");
}
