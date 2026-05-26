"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { getEmergencyCategoryMeta } from "@/lib/documents/emergency-categories";
import type { EmergencyCategory } from "@/types/document";

/**
 * Stage 2 of the emergency-procedure-video flow (issue #139). Optional
 * label field for the three named categories (Water / Gas / Electrical);
 * required field for 'Other' since the category alone doesn't
 * disambiguate. Pre-fills with whatever the parent passes back when
 * the user navigates back from later stages.
 */
export function EmergencyLabelStage({
  category,
  initialLabel,
  onContinue,
  onBack,
}: {
  category: EmergencyCategory;
  initialLabel: string | null;
  onContinue: (label: string | null) => void;
  onBack: () => void;
}) {
  const meta = getEmergencyCategoryMeta(category);
  const [value, setValue] = useState(initialLabel ?? "");
  const requiredForOther = category === "other";
  const valueTrimmed = value.trim();
  const canContinue = requiredForOther ? valueTrimmed.length > 0 : true;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          className="relative shrink-0 overflow-hidden rounded-md"
          style={{
            width: 44,
            height: 44,
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          <Image
            src={meta.iconSrc}
            alt=""
            fill
            sizes="44px"
            style={{ objectFit: "cover" }}
          />
        </span>
        <div className="min-w-0">
          <div className="eyebrow">{meta.label} emergency</div>
          <div className="text-small" style={{ color: "var(--color-text-secondary)" }}>
            Give this video a short name so you can tell it apart from
            other {meta.label.toLowerCase()} videos later.
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {requiredForOther ? "Name *" : "Name (optional)"}
        </span>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={meta.labelPlaceholder}
          maxLength={120}
          className="rounded-[var(--radius-md)] px-3 py-2"
          style={{
            backgroundColor: "var(--color-bg-surface)",
            border: "1px solid var(--color-border-subtle)",
            fontSize: 15,
          }}
        />
        {requiredForOther && valueTrimmed.length === 0 ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Required for the &quot;Other&quot; category.
          </span>
        ) : null}
      </label>

      <div className="flex items-center justify-between mt-1">
        <button type="button" onClick={onBack} className="btn btn-ghost">
          <span className="inline-flex items-center gap-1">
            <Icon name="chevron-left" size={16} />
            <span>Back</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onContinue(valueTrimmed || null)}
          disabled={!canContinue}
          className="btn btn-primary"
          style={{ opacity: canContinue ? 1 : 0.5 }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
