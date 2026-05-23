"use client";

import { Icon, type IconName } from "@/components/icon";

/**
 * Stage 1 — Path picker. The photo and receipt paths are both active
 * once issue #117 ships; the emergency-procedure-video entry stays
 * disabled with a "Soon" badge until that pipeline lands.
 */
export function PathPickerStage({
  onPickPhoto,
  onPickReceipt,
}: {
  onPickPhoto: () => void;
  onPickReceipt: () => void;
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

      <DisabledOption
        icon="photo"
        title="Emergency procedure video"
        body="Shutoffs, breaker panels, etc."
      />
    </div>
  );
}

function ActiveOption({
  icon,
  title,
  body,
  onClick,
}: {
  icon: IconName;
  title: string;
  body: string;
  onClick: () => void;
}) {
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
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 18%, transparent)",
          color: "var(--color-accent)",
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

function DisabledOption({
  icon,
  title,
  body,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  body: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--radius-md)] p-4 text-left"
      style={{
        backgroundColor: "transparent",
        border: "1px dashed var(--color-border-subtle)",
        opacity: 0.7,
      }}
      aria-disabled
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: "var(--color-bg-surface)",
          color: "var(--color-text-tertiary)",
        }}
        aria-hidden
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            {title}
          </span>
          <span
            className="chip"
            style={{ height: 18, fontSize: 10, padding: "0 6px" }}
          >
            Soon
          </span>
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
