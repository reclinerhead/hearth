"use client";

import { Icon, type IconName } from "@/components/icon";

/**
 * Stage 1 — Path picker. The photo and receipt paths landed in earlier
 * phases; the emergency-procedure-video entry lands in issue #139 and
 * the disabled "Soon" affordance is replaced with an active option
 * accent-colored to match the emergency surface.
 */
export function PathPickerStage({
  onPickPhoto,
  onPickReceipt,
  onPickEmergencyVideo,
}: {
  onPickPhoto: () => void;
  onPickReceipt: () => void;
  onPickEmergencyVideo: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Hearth uses what you capture to build your home&apos;s memory.
        Photos identify the unit; receipts give it a paper trail.
      </p>

      <ActiveOption
        icon="camera"
        title="Photo of an appliance, system, or property"
        body="Take a photo of a nameplate, the unit itself, a vehicle, or anything else you own."
        onClick={onPickPhoto}
      />

      <ActiveOption
        icon="file-text"
        title="Document or receipt"
        body="Capture a receipt, invoice, or service record across 1–5 pages."
        onClick={onPickReceipt}
      />

      <ActiveOption
        icon="video"
        title="Emergency procedure video"
        body="Record a 20-second tour of a shutoff valve, breaker panel, or anything else future-you will be glad past-you pointed at."
        onClick={onPickEmergencyVideo}
        accentTone="danger"
      />
    </div>
  );
}

function ActiveOption({
  icon,
  title,
  body,
  onClick,
  accentTone = "accent",
}: {
  icon: IconName;
  title: string;
  body: string;
  onClick: () => void;
  /**
   * Color of the leading icon chip. 'accent' (default) for general
   * paths; 'danger' for the emergency-procedure-video entry so it
   * carries the same red treatment the panel uses on the dashboard.
   */
  accentTone?: "accent" | "danger";
}) {
  const toneVar = accentTone === "danger" ? "var(--color-danger)" : "var(--color-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-[var(--radius-md)] p-4 text-left transition-colors"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: `color-mix(in oklab, ${toneVar} 18%, transparent)`,
          color: toneVar,
        }}
        aria-hidden
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {body}
        </div>
      </div>
      <span
        aria-hidden
        style={{ color: "var(--color-text-tertiary)" }}
        className="self-center"
      >
        <Icon name="chevron-right" size={16} />
      </span>
    </button>
  );
}

