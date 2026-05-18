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
