import type { HabitatSeverity } from "@/lib/habitat/types";

/**
 * Token-keyed color for each severity level, shared by the dashboard
 * compact tile and the finding detail modal. CSS variables resolve at
 * paint time so the values follow the active theme.
 *
 * Mirrors the 6-stop scale in lib/habitat/types.ts. Two stops share a
 * token (concern + critical → danger, favorable + beneficial → success)
 * because the visual signal is two-state along the warm/cool axis with
 * caution as the in-between yellow; the textual severity word carries
 * the finer distinction.
 */
export const SEVERITY_COLOR: Record<HabitatSeverity, string> = {
  critical: "var(--color-danger)",
  concern: "var(--color-danger)",
  caution: "var(--color-warning)",
  neutral: "var(--color-text-tertiary)",
  favorable: "var(--color-success)",
  beneficial: "var(--color-success)",
};

export const SEVERITY_WORD: Record<HabitatSeverity, string> = {
  critical: "Critical",
  concern: "Concern",
  caution: "Caution",
  neutral: "Neutral",
  favorable: "Favorable",
  beneficial: "Beneficial",
};

/**
 * Sort weight for the 6-stop severity scale. Higher = surface first.
 * Matches the UI ordering called out in `lib/habitat/types.ts`
 * (critical → concern → caution → neutral → favorable → beneficial).
 *
 * Kept here alongside the colour and word maps because every consumer
 * that needs a weight also needs the colour or word; one import covers
 * all three. The Superfund module declares its own private weight map
 * inside its severity helpers — that's deliberate, it stays self-
 * contained — and matches the values here.
 */
const SEVERITY_WEIGHT: Record<HabitatSeverity, number> = {
  critical: 6,
  concern: 5,
  caution: 4,
  neutral: 3,
  favorable: 2,
  beneficial: 1,
};

export function severityWeight(severity: HabitatSeverity): number {
  return SEVERITY_WEIGHT[severity];
}

/**
 * Which severities warrant the "flagged" treatment in the onboarding /
 * refresh discovery modal (issue #184): a warning-coloured alert-triangle
 * glyph, a warm-tinted card border, and a relevance pill with tooltip.
 *
 * The set is keyed off the existing 6-stop scale so we don't maintain a
 * parallel vocabulary — caution + concern + critical land in the warm
 * half of the severity colour map. Neutral / favorable / beneficial all
 * render as clean (green-check) rows with no pill.
 */
const FLAGGED_SEVERITIES = new Set<HabitatSeverity>([
  "caution",
  "concern",
  "critical",
]);

export function isFlaggedSeverity(
  severity: HabitatSeverity | null | undefined,
): boolean {
  return severity !== null && severity !== undefined && FLAGGED_SEVERITIES.has(severity);
}

/**
 * Glyph used to lead a discovery-modal row in the `done` state. Flagged
 * severities (caution / concern / critical) get an alert triangle in the
 * severity's colour; everything else gets the same green check used since
 * the modal first shipped.
 */
export function discoveryRowGlyph(
  severity: HabitatSeverity | null | undefined,
): "alert-triangle" | "circle-check" {
  return isFlaggedSeverity(severity) ? "alert-triangle" : "circle-check";
}

/**
 * Two-bucket pill label for flagged severities. "concern" and "critical"
 * read heavier than "caution", so the label escalates with them. Returns
 * null for non-flagged severities — callers should not render a pill in
 * that case.
 */
export function pillLabelForSeverity(
  severity: HabitatSeverity | null | undefined,
): string | null {
  if (severity === "concern" || severity === "critical") {
    return "Worth a closer look";
  }
  if (severity === "caution") {
    return "Worth knowing";
  }
  return null;
}

/**
 * Tooltip copy paired with the relevance pill. Same two-bucket split as
 * the label so future copy edits keep the heavier vs lighter framing
 * aligned. Awareness-first voice — "you'll find this on your dashboard,"
 * not "you must act."
 */
export function pillTooltipForSeverity(
  severity: HabitatSeverity | null | undefined,
): string | null {
  if (severity === "concern" || severity === "critical") {
    return "We'll surface this on your dashboard with our findings and suggested follow-ups.";
  }
  if (severity === "caution") {
    return "Worth being aware of. You'll find this on your dashboard with the full details.";
  }
  return null;
}

export function SeverityDot({
  severity,
  size = 8,
}: {
  severity: HabitatSeverity;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: SEVERITY_COLOR[severity],
      }}
    />
  );
}
