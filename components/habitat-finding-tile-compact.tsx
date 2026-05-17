import Image from "next/image";
import Link from "next/link";
import type { HabitatSeverity } from "@/lib/habitat/types";

/**
 * Dashboard preview variant of HabitatFindingTile. Smaller hero
 * (72px), no action chips, and the whole tile is a single Link to
 * /habitat — clicking anywhere routes the user there for the full
 * detail (summary, actions, source). Server-component-safe.
 *
 * Kept as a separate component rather than a `variant` prop on the
 * full tile because the full tile's action row contains <a> tags and
 * the compact tile *is* an <a>; nesting <a> inside <a> is invalid HTML.
 *
 * Severity dot color mapping mirrors the full tile so the two surfaces
 * read consistently — same finding, two densities.
 */

const HERO_PX = 72;

const SEVERITY_COLOR: Record<HabitatSeverity, string> = {
  critical: "var(--color-danger)",
  concern: "var(--color-danger)",
  caution: "var(--color-warning)",
  neutral: "var(--color-text-tertiary)",
  favorable: "var(--color-success)",
  beneficial: "var(--color-success)",
};

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
    <Link
      href="/habitat"
      className="surface-ai group block p-3 sm:p-4 transition-colors hover:border-(--color-border-emphasis)"
    >
      <div
        className="grid gap-3"
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
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: SEVERITY_COLOR[severity],
              }}
            />
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
    </Link>
  );
}
