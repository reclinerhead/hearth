import Image from "next/image";
import { SeverityDot } from "./habitat-severity";
import type { HabitatSeverity } from "@/lib/habitat/types";

/**
 * Dashboard preview variant of a habitat finding. Presentational — no
 * wrapping interactive element. The call site (HabitatFindingTrigger)
 * provides the <button> that opens the finding detail modal, so this
 * component just renders the grid content.
 *
 * Smaller hero (72px), line-clamped 2-line summary, no action chips —
 * the modal carries everything beyond the headline.
 */

const HERO_PX = 72;

export function HabitatFindingTileCompact({
  iconImage,
  moduleLabel,
  headline,
  summary,
  severity,
}: {
  iconImage?: string | null;
  moduleLabel: string;
  headline: string;
  summary: string;
  severity: HabitatSeverity;
}) {
  return (
    <div
      className="grid gap-3 text-left"
      style={{
        gridTemplateColumns: iconImage ? `${HERO_PX}px 1fr` : "1fr",
        alignItems: "start",
      }}
    >
      {iconImage ? (
        <div
          className="relative overflow-hidden shrink-0"
          style={{
            width: HERO_PX,
            height: HERO_PX,
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface-raised)",
          }}
        >
          <Image
            src={iconImage}
            alt=""
            fill
            sizes="72px"
            style={{ objectFit: "cover" }}
          />
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <SeverityDot severity={severity} />
          <span className="eyebrow">{moduleLabel}</span>
        </div>
        <div className="h3" style={{ marginBottom: 4 }}>
          {headline}
        </div>
        <p
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </p>
      </div>
    </div>
  );
}
