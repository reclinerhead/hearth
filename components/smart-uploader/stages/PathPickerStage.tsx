"use client";

import { Icon } from "@/components/icon";

/**
 * Stage 1 — Path picker. Only the photo path is active in phase 1.
 * Document and video paths are visible but disabled with a "Soon"
 * badge so the user understands the broader product surface.
 */
export function PathPickerStage({
  onPickPhoto,
}: {
  onPickPhoto: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Hearth uses what you capture to build your home&apos;s memory. Start
        with a photo — we&apos;ll handle the rest.
      </p>

      <button
        type="button"
        onClick={onPickPhoto}
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
          <Icon name="camera" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Photo of an appliance or system
          </div>
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Take a photo of a nameplate or the unit itself.
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

      <DisabledOption
        icon="file-text"
        title="Document or receipt"
        body="Receipt, manual, permit, or invoice."
      />
      <DisabledOption
        icon="photo"
        title="Emergency procedure video"
        body="Shutoffs, breaker panels, etc."
      />
    </div>
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
