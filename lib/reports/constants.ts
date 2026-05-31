/**
 * Shared constants for the Hearth Reporting pipeline (issue #207).
 *
 * Lives in the shared layer because every report type that flows through
 * `lib/reports/` carries the same attribution footer — these URLs are not
 * water-specific.
 */

/** ToddTech site root. Kept for completeness; the footer does NOT link here. */
export const TODDTECH_URL = "https://www.toddtech.llc";

/**
 * The footer's link target. The Hearth portfolio page — not the site root.
 * A recipient who just read a report about their own house is most
 * receptive to the page describing exactly what produced it; the site root
 * would make them hunt.
 */
export const TODDTECH_HEARTH_URL = "https://www.toddtech.llc/portfolio/hearth";

/**
 * The in-app tagline ("Home Awareness"), used in the running footer. This
 * is deliberately the product tagline, not the marketing-site tagline —
 * the report is a product surface.
 */
export const HEARTH_REPORT_TAGLINE = "Home Awareness";
