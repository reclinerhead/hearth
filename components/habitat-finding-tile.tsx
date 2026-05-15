import Image from "next/image";
import type { FindingAction, HabitatSeverity } from "@/lib/habitat/types";

/**
 * Renders a single completed habitat finding as a card in the dashboard
 * grid. Server-component-safe (no client hooks, no event handlers).
 *
 * Layout:
 *   - With iconImage: 128px square hero on the left, content column on
 *     the right (CSS grid, 128px 1fr).
 *   - Without iconImage: single content column, full width — no empty
 *     gutter.
 *
 * Visual surface matches the rest of the AI-authored content via the
 * .surface-ai treatment used elsewhere on the dashboard.
 */

const HERO_PX = 128;

const SEVERITY_COLOR: Record<HabitatSeverity, string> = {
  critical: "var(--color-danger)",
  high: "var(--color-danger)",
  moderate: "var(--color-warning)",
  low: "var(--color-text-tertiary)",
  neutral: "var(--color-text-tertiary)",
  good: "var(--color-success)",
};

function SeverityDot({ severity }: { severity: HabitatSeverity }) {
  return (
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
  );
}

function ActionChip({ action }: { action: FindingAction }) {
  const isProduct = action.kind === "product";
  const priceHint = isProduct ? action.priceHint : undefined;

  // Product chips use the accent treatment to read as the primary call to
  // action; link and service chips stay subtler so a tile with all three
  // doesn't compete with itself for attention.
  const style = isProduct
    ? {
        backgroundColor:
          "color-mix(in oklab, var(--color-accent) 14%, var(--color-bg-surface-raised))",
        borderColor: "color-mix(in oklab, var(--color-accent) 26%, transparent)",
        color: "var(--color-text-primary)",
      }
    : {
        backgroundColor: "var(--color-bg-surface-raised)",
        borderColor: "var(--color-border-subtle)",
        color: "var(--color-text-secondary)",
      };

  return (
    <a
      href={action.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-small transition-colors hover:border-(--color-border-emphasis)"
      style={style}
    >
      <span>{action.label}</span>
      {priceHint ? (
        <span style={{ color: "var(--color-text-tertiary)" }}>{priceHint}</span>
      ) : null}
    </a>
  );
}

export function HabitatFindingTile({
  iconImage,
  moduleLabel,
  headline,
  summary,
  severity,
  actions,
}: {
  iconImage?: string | null;
  moduleLabel: string;
  headline: string;
  summary: string;
  severity: HabitatSeverity;
  actions?: FindingAction[] | null;
}) {
  const hasActions = Array.isArray(actions) && actions.length > 0;

  return (
    <article className="surface-ai p-4 sm:p-5">
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: iconImage ? `${HERO_PX}px 1fr` : "1fr",
          alignItems: "start",
        }}
      >
        {iconImage ? (
          <div
            className="relative overflow-hidden"
            style={{
              width: HERO_PX,
              height: HERO_PX,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-surface-raised)",
            }}
          >
            <Image
              src={iconImage}
              alt=""
              fill
              sizes="128px"
              style={{ objectFit: "cover" }}
            />
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityDot severity={severity} />
            <span className="eyebrow">{moduleLabel}</span>
          </div>
          <h3 className="h3" style={{ marginBottom: 6 }}>
            {headline}
          </h3>
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {summary}
          </p>
          {hasActions ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {actions.map((action, i) => (
                <ActionChip
                  key={`${action.kind}:${action.url}:${i}`}
                  action={action}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
