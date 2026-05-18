import type { FindingAction } from "@/lib/habitat/types";

/**
 * A single action affordance for a habitat finding. Lifted from
 * habitat-finding-tile.tsx so the dashboard modal and any future tile
 * variant can share the same chip without re-declaring the kind-specific
 * styling.
 *
 * Product chips use the accent treatment to read as the primary call to
 * action; link and service chips stay subtler so a tile with all three
 * kinds doesn't compete with itself for attention. Every chip opens in
 * a new tab with rel="noopener noreferrer".
 */

export function HabitatActionChip({ action }: { action: FindingAction }) {
  const isProduct = action.kind === "product";
  const priceHint = isProduct ? action.priceHint : undefined;

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
