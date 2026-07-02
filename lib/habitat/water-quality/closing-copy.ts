/**
 * Shared copy + item selection for the Water Quality report's closing
 * "Where to go from here" section (issue #299).
 *
 * Consumed by BOTH surfaces so they can't drift:
 *   - the PDF report (`lib/reports/water-quality/report.ts`), which escapes
 *     these strings and wraps them in HTML, and
 *   - the web finding modal (`WqaOverviewBody`), which renders them as JSX.
 *
 * Pure and render-agnostic: every function returns plain-text data (real
 * apostrophes, em-dashes, and `&` — not HTML entities). Each surface is
 * responsible for its own escaping. Any dynamic value (a free-testing phone
 * number, a CCR upload date) is already interpolated into the returned
 * text, so callers never re-assemble copy.
 *
 * The phone number shown in "Test your own tap" is the utility's own
 * free-testing contact as printed in its CCR (`free_testing_offer
 * .contact_value`) — deliberately the CCR line, not EPA's administrator-of-
 * record phone, which is a distinct number surfaced in the contact block.
 */

/** A single rung of the Next-steps ladder. `title` is the bold lead-in. */
export type WqaNextStep = {
  key: "learn" | "test" | "involve";
  title: string;
  /** Plain-text body; any phone number is already interpolated. */
  body: string;
};

/**
 * A "Where this data comes from" entry. `title` carries the spelled-out
 * acronym (e.g. "…Consumer Confidence Report (CCR)"); `body` is the plain-
 * language explanation, and leads with the em-dash separator so a renderer
 * can place it directly after the bold title.
 */
export type WqaDataSource = {
  key: "ccr" | "sdwis";
  title: string;
  body: string;
};

/** The subset of the CCR free-testing offer the closing copy reads. */
export type WqaFreeTestingOffer = {
  offered: boolean;
  contact_value: string | null;
} | null;

/** Provenance of the uploaded CCR for the CCR data-source line. */
export type WqaCcrProvenance = {
  year: number | null;
  uploadedByName: string | null;
  uploadedOnLabel: string | null;
} | null;

/**
 * The Learn → Test → Get involved ladder. The Test rung has two variants:
 * when the utility plainly offers free residential testing we point the
 * homeowner at it (with the CCR-printed contact when present); otherwise we
 * give the generic "test at your own tap" guidance.
 */
export function buildWqaNextSteps(input: {
  freeTestingOffer: WqaFreeTestingOffer;
}): WqaNextStep[] {
  const offer = input.freeTestingOffer;
  const test: WqaNextStep =
    offer && offer.offered
      ? {
          key: "test",
          title: "Test your own tap.",
          body:
            `Your utility offers free residential water testing${
              offer.contact_value ? ` — reach them at ${offer.contact_value}` : ""
            }. A test of the water at your own faucet is the only way to know ` +
            `what's actually coming out of your pipes, since lead and copper enter downstream of the utility.`,
        }
      : {
          key: "test",
          title: "Test your own tap.",
          body:
            "The water leaving the treatment plant isn't always the water at your faucet — lead and copper enter " +
            "from your home's own plumbing. A certified tap test, or a kit from your county health department, closes that gap.",
        };

  return [
    {
      key: "learn",
      title: "Learn.",
      body:
        "Read the EPA reference linked beside each contaminant above — they explain the health context in plain terms, " +
        "written for homeowners, not regulators.",
    },
    test,
    {
      key: "involve",
      title: "Get involved.",
      body:
        "Your water utility holds public meetings and publishes its annual report. The contact below is your direct " +
        "line to ask questions about anything in this document.",
    },
  ];
}

/**
 * The "Where this data comes from" list. The CCR entry appears whenever we
 * have a CCR on file (with a dated — never named — upload credit); the
 * SDWIS entry appears whenever EPA's SDWIS was a source. Emits an empty
 * array when neither applies (the caller suppresses the block).
 */
export function buildWqaDataSources(input: {
  ccrProvenance: WqaCcrProvenance;
  usedSdwis: boolean;
}): WqaDataSource[] {
  const items: WqaDataSource[] = [];

  const prov = input.ccrProvenance;
  if (prov) {
    const yearPart = prov.year ? `${prov.year} ` : "";
    const name = prov.uploadedByName;
    const date = prov.uploadedOnLabel;
    let creditText = "";
    if (name && date) creditText = ` (uploaded by ${name} on ${date})`;
    else if (date) creditText = ` (uploaded ${date})`;
    else if (name) creditText = ` (uploaded by ${name})`;
    items.push({
      key: "ccr",
      title: `Your utility's ${yearPart}Consumer Confidence Report (CCR)`,
      body:
        `— the annual water-quality report every community water system is required to publish for its ` +
        `customers${creditText}. It's the source of the detected-contaminant levels in this report.`,
    });
  }

  if (input.usedSdwis) {
    items.push({
      key: "sdwis",
      title: "EPA's Safe Drinking Water Information System (SDWIS)",
      body:
        "— the U.S. Environmental Protection Agency's national database of public water systems. Your utility's " +
        "identity, its compliance history, and its lead & copper monitoring records are drawn from it.",
    });
  }

  return items;
}

/** The "How this was made" opening paragraph (after the bold lead-in). */
export const WQA_HOW_THIS_WAS_MADE_BODY =
  "Every number, tier, and treatment rating in this report is drawn directly from your utility's published " +
  "Consumer Confidence Report and EPA's public drinking-water data — nothing here is generated or estimated. " +
  "Treatment effectiveness follows EPA and NSF public guidance and assumes a properly certified unit.";

/** The closing awareness disclaimer paragraph. */
export const WQA_AWARENESS_DISCLAIMER =
  "This report is for awareness, not a substitute for testing the water at your own tap. Treatment " +
  "recommendations are at the technology level; Hearth doesn't sell or endorse specific products.";
