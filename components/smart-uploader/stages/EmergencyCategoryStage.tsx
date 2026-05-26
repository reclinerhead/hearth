"use client";

import Image from "next/image";
import { Icon } from "@/components/icon";
import {
  EMERGENCY_CATEGORY_META,
  EMERGENCY_CATEGORY_ORDER,
} from "@/lib/documents/emergency-categories";
import type { EmergencyCategory } from "@/types/document";

/**
 * Stage 1 of the emergency-procedure-video flow (issue #139). Four
 * large icon-driven cards (Water / Gas / Electrical / Other). Tapping
 * a card advances to the label stage.
 *
 * The icons are deliberately larger than the lucide icons elsewhere
 * in the uploader — emergency videos are the most important section
 * of the dashboard (per issue #139's user direction) and the visual
 * association between category and icon should be unmistakable.
 */
export function EmergencyCategoryStage({
  selected,
  onPick,
  onBack,
}: {
  selected: EmergencyCategory | null;
  onPick: (category: EmergencyCategory) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        What kind of emergency does this video cover? A short clip of
        you pointing at the right thing is faster than text at 2am.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {EMERGENCY_CATEGORY_ORDER.map((cat) => {
          const meta = EMERGENCY_CATEGORY_META[cat];
          const isSelected = selected === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onPick(cat)}
              className="group relative flex flex-col items-stretch overflow-hidden rounded-[var(--radius-lg)] text-left transition-transform"
              style={{
                aspectRatio: "1 / 1",
                border: isSelected
                  ? "2px solid var(--color-accent)"
                  : "1px solid var(--color-border-subtle)",
                backgroundColor: "var(--color-bg-surface-raised)",
              }}
              aria-pressed={isSelected}
            >
              <div className="relative flex-1">
                <Image
                  src={meta.iconSrc}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 45vw, 220px"
                  style={{ objectFit: "cover" }}
                  priority={cat === "water"}
                />
              </div>
              <div
                className="px-3 py-2"
                style={{
                  borderTop: "1px solid var(--color-border-subtle)",
                  backgroundColor: "var(--color-bg-surface)",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 500 }}>{meta.label}</div>
                <div
                  className="mt-0.5"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.35,
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  {meta.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2">
        <button
          type="button"
          onClick={onBack}
          className="btn btn-ghost"
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="chevron-left" size={16} />
            <span>Back</span>
          </span>
        </button>
      </div>
    </div>
  );
}
