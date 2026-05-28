/**
 * WQA's implementation of `HabitatModule.summarizeRecheckChanges`.
 * Issue #196.
 *
 * Pure: takes the previous and just-completed `HabitatFindingRow`s
 * plus the recheck source, returns a one-line headline for the modal's
 * fresh-update banner — or null when nothing user-visible changed.
 *
 * Three transitions the function knows how to surface:
 *
 *   1. CCR landed via CCR upload. `system_card.latest_ccr_status`
 *      flipped from "not_uploaded" to `{ year }` AND the source was
 *      the upload flow. This is the load-bearing case — Todd
 *      specifically called out that the user needs feedback when
 *      their report finishes processing. Headline names the year and
 *      the count of detected contaminants now visible.
 *
 *   2. CCR landed via a manual recheck. Same state transition but
 *      the source was the modal's Recheck link. Slightly different
 *      copy — the user didn't trigger a CCR upload, but our shared
 *      cache picked up a contribution from someone else on the same
 *      utility.
 *
 *   3. Severity transition. Source-agnostic. Headlines name the
 *      direction ("now reads as worth knowing" — using Hearth's tier
 *      vocabulary, not raw severity words).
 *
 * Returns null when nothing surfaceable changed — the modal shell
 * falls back to either the generic "Recheck complete" copy or
 * suppresses the banner depending on the trigger source.
 */

import type {
  HabitatRecheckSource,
  HabitatRecheckSummary,
} from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import type { WqaFindings } from "./types";

/**
 * Read the WQA findings payload off a row, narrowed to the typed
 * shape. Returns null when the row has no findings (e.g. a fresh
 * `running` row whose check() hasn't completed yet).
 */
function wqaFindings(row: HabitatFindingRow | null): WqaFindings | null {
  if (!row?.findings) return null;
  return row.findings as unknown as WqaFindings;
}

/**
 * Hearth tier vocabulary for severity-transition copy. Mirrors what
 * the discovery-modal onboarding line uses so the banner reads in the
 * same voice the rest of the WQA surface speaks.
 */
const SEVERITY_PHRASE: Record<string, string> = {
  favorable: "looks favorable",
  neutral: "reads as neutral",
  caution: "is now worth knowing about",
  concern: "is now worth a closer look",
};

export function summarizeWqaRecheckChanges(
  before: HabitatFindingRow | null,
  after: HabitatFindingRow,
  source: HabitatRecheckSource,
): HabitatRecheckSummary | null {
  const afterFindings = wqaFindings(after);
  if (!afterFindings) return null;
  const beforeFindings = wqaFindings(before);

  const beforeCcrStatus = beforeFindings?.system_card?.latest_ccr_status;
  const afterCcrStatus = afterFindings.system_card?.latest_ccr_status;

  // ---- Case 1 + 2: CCR landed -----------------------------------------
  const ccrJustLanded =
    afterCcrStatus !== undefined &&
    typeof afterCcrStatus === "object" &&
    "year" in afterCcrStatus &&
    (before === null ||
      beforeCcrStatus === undefined ||
      beforeCcrStatus === "not_uploaded");

  if (ccrJustLanded) {
    const year =
      typeof afterCcrStatus === "object" && "year" in afterCcrStatus
        ? afterCcrStatus.year
        : null;
    const contaminantCount =
      afterFindings.ccr_findings?.contaminants?.length ?? 0;
    const countClause = contaminantCount > 0
      ? ` ${contaminantCount} contaminants from that report are now listed below`
      : " The full report is summarized below";
    const lead =
      source === "ccr_upload"
        ? `We just read your${year ? ` ${year}` : ""} Water Quality Report.`
        : `Your utility's${year ? ` ${year}` : ""} Water Quality Report is now on file from another homeowner on the same system.`;
    return {
      headline: `${lead}${countClause} — take a moment to look it over.`,
      tone: "info",
    };
  }

  // ---- Case 3: severity transition ------------------------------------
  // Skip when the row had no prior severity (first run); skip when the
  // direction is "neutral → neutral" (the most common no-change result
  // and not worth a banner).
  if (
    before &&
    before.severity &&
    after.severity &&
    before.severity !== after.severity
  ) {
    const phrase =
      SEVERITY_PHRASE[after.severity] ?? "reads differently than before";
    return {
      headline: `Recheck complete — your water quality finding ${phrase}. Review the changes below.`,
      tone:
        after.severity === "favorable"
          ? "success"
          : after.severity === "concern" || after.severity === "caution"
            ? "info"
            : "neutral",
    };
  }

  return null;
}
