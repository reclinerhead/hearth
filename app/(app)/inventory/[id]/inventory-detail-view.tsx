"use client";

// Client-side render of the inventory detail page. The server component
// in page.tsx loads the row (RLS-scoped) and hands us a fully-typed
// item; this component owns presentation plus the on-demand Research
// surface (button state, loading overlay, error handling, refresh).
//
// Documents / Notes & photos / Maintenance & history panels are
// intentionally placeholder content — wired to real data in a later phase.

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { researchInventoryModelAction } from "@/app/actions/inventory/research-model";
import {
  EditInventoryItemModal,
  type EditableInventoryRow,
} from "@/components/edit-inventory-item-modal";
import { Icon, type IconName } from "@/components/icon";
import { Tooltip } from "@/components/tooltip";
import {
  Breadcrumb,
  MetricCard,
  PlaceholderImage,
  SectionHeader,
  TimelineItem,
} from "@/components/ui";
import type {
  InventoryDetailItem,
  InventoryInsights,
  RoomOption,
} from "./page";

const TYPE_BREADCRUMB_LABEL: Record<
  "appliance" | "system" | "exterior",
  string
> = {
  appliance: "Appliances",
  system: "Systems",
  exterior: "Exterior",
};

const TYPE_EYEBROW_LABEL: Record<
  "appliance" | "system" | "exterior",
  string
> = {
  appliance: "Appliance",
  system: "System",
  exterior: "Exterior",
};

export function InventoryDetailView({
  item,
  rooms,
  linkedDocumentCount,
}: {
  item: InventoryDetailItem;
  rooms: RoomOption[];
  linkedDocumentCount: number;
}) {
  const title =
    item.manufacturer && item.model_number
      ? `${item.manufacturer} ${item.model_number}`
      : item.name;

  const eyebrow = `${TYPE_EYEBROW_LABEL[item.type].toUpperCase()} · ${item.roomName.toUpperCase()}`;

  // Research lookup is owned at this level (not inside ResearchPanel) so
  // the edit-modal can trigger a re-run after the user saves changes to
  // manufacturer / model_number / type. Stale insights are cleared by
  // the update action itself; this kicks off the new fetch.
  const router = useRouter();
  const [researchPending, startResearch] = useTransition();
  const [researchError, setResearchError] = useState<string | null>(null);
  const handleResearch = useCallback(() => {
    setResearchError(null);
    startResearch(async () => {
      const result = await researchInventoryModelAction({ inventoryId: item.id });
      if (result.error) {
        setResearchError(result.error);
        return;
      }
      router.refresh();
    });
  }, [item.id, router]);

  // Auto-trigger research after the edit modal reports that key fields
  // changed. The ref is set inside onSaved and consumed in the effect
  // below so the trigger fires once per save, not on every render.
  const pendingResearchTriggerRef = useRef(false);
  useEffect(() => {
    if (pendingResearchTriggerRef.current) {
      pendingResearchTriggerRef.current = false;
      handleResearch();
    }
  });

  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  const editableItem: EditableInventoryRow = {
    id: item.id,
    name: item.name,
    type: item.type,
    room_id: item.room_id,
    manufacturer: item.manufacturer,
    model_number: item.model_number,
    serial_number: item.serial_number,
    installed_on: item.installed_on,
    last_serviced_on: item.last_serviced_on,
    next_service_due_on: item.next_service_due_on,
    notes: item.notes,
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: TYPE_BREADCRUMB_LABEL[item.type] },
          { label: item.roomName },
          { label: item.name },
        ]}
      />

      <section className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          {item.heroSignedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.heroSignedUrl}
              alt={item.name}
              className="w-full rounded-lg object-cover"
              style={{
                aspectRatio: "1 / 1",
                border: "1px solid var(--color-border-subtle)",
              }}
            />
          ) : (
            <PlaceholderImage ratio="1 / 1" label="Add photo" icon="camera" />
          )}
          <Tooltip
            content="Adding more photos from the detail page is coming soon."
            side="bottom"
          >
            <button
              type="button"
              disabled
              className="btn btn-ghost w-full mt-2"
              aria-disabled="true"
              style={{ opacity: 0.55 }}
            >
              <Icon name="camera" size={16} />
              Add photo
            </button>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">{eyebrow}</div>
              <h1 className="h1" style={{ marginTop: 4 }}>
                {title}
              </h1>
            </div>
            <button
              ref={editTriggerRef}
              type="button"
              onClick={() => setEditOpen(true)}
              className="btn btn-ghost shrink-0"
              aria-label={`Edit details for ${item.name}`}
            >
              <Icon name="edit" size={14} />
              <span className="hidden sm:inline">Edit details</span>
              <span className="sm:hidden">Edit</span>
            </button>
          </div>

          <StatTiles item={item} />

          <PillCluster item={item} />
        </div>
      </section>

      <ResearchPanel
        item={item}
        isPending={researchPending}
        error={researchError}
        onResearch={handleResearch}
      />

      {/*
        Conditionally mount: every open is a fresh React mount so the
        modal's internal useState calls re-initialize from the latest
        `item` snapshot. This avoids reset-in-effect (which trips
        react-hooks/set-state-in-effect) and matches how SmartUploader
        scopes its state to a single open.
      */}
      {editOpen ? (
        <EditInventoryItemModal
          open
          item={editableItem}
          rooms={rooms}
          linkedDocumentCount={linkedDocumentCount}
          onClose={() => setEditOpen(false)}
          onSaved={({ researchInvalidated }) => {
            if (researchInvalidated) {
              // Defer the trigger to the next render — by then router.refresh()
              // from the modal has re-fetched the server component and the
              // panel reflects the new (cleared) ai_insights state.
              pendingResearchTriggerRef.current = true;
            }
          }}
          onDeleted={() => {
            // Inventory list page doesn't exist yet; the dashboard's
            // inventory tiles are the de facto landing for "where did
            // my appliances go?" so the deleted page returns there.
            router.replace("/dashboard");
          }}
          getReturnFocusElement={() => editTriggerRef.current}
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <PlaceholderPanel
          title="Documents"
          eyebrow="What we have on file"
          emptyHint="Receipts, manuals, and permits will land here when you upload them."
          rows={[
            {
              icon: "file-text",
              title: "No documents yet",
              meta: "Coming in a future update",
            },
          ]}
        />
        <PlaceholderPanel
          title="Notes & photos"
          eyebrow="Things you've captured"
          emptyHint="Notes and additional photos for this item live here."
          rows={[
            {
              icon: "note",
              title: "No notes yet",
              meta: "Coming in a future update",
            },
          ]}
        />
      </section>

      <section>
        <SectionHeader
          eyebrow="Everything that's happened"
          title="Maintenance & history"
          trailing={
            <Tooltip
              content="Maintenance logging is coming in a future update."
              side="bottom"
            >
              <button
                type="button"
                disabled
                className="btn btn-primary"
                aria-disabled="true"
                style={{ opacity: 0.55 }}
              >
                <Icon name="plus" size={16} />
                Log maintenance
              </button>
            </Tooltip>
          }
        />
        <ol className="surface p-4 sm:p-5">
          {item.installed_on ? (
            <TimelineItem
              icon="circle-dot"
              title="Installed"
              meta={formatLongDate(item.installed_on)}
            />
          ) : (
            <TimelineItem
              icon="info"
              title="No history yet"
              detail="Service entries and maintenance reminders will appear here as you log them."
            />
          )}
        </ol>
      </section>

      <PanelRowStyles />
    </div>
  );
}

function StatTiles({ item }: { item: InventoryDetailItem }) {
  // Always render all three tiles. Empty slots show "Unknown" so the
  // user can see the field exists and edit it later (edit-from-detail
  // is a future phase). Showing the placeholder is more useful than
  // hiding the tile entirely — the layout stays stable across items.
  const tiles: {
    eyebrow: string;
    isoDate: string | null;
    icon: IconName;
  }[] = [
    { eyebrow: "Installed", isoDate: item.installed_on, icon: "calendar" },
    {
      eyebrow: "Last serviced",
      isoDate: item.last_serviced_on,
      icon: "tool",
    },
    { eyebrow: "Next due", isoDate: item.next_service_due_on, icon: "clock" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map((t) => (
        <MetricCard
          key={t.eyebrow}
          eyebrow={t.eyebrow}
          value={
            t.isoDate ? (
              formatYearMonth(t.isoDate)
            ) : (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                Unknown
              </span>
            )
          }
          meta={t.isoDate ? formatRelativeYears(t.isoDate) : null}
          icon={t.icon}
        />
      ))}
    </div>
  );
}

function PillCluster({ item }: { item: InventoryDetailItem }) {
  const aiPills = item.ai_pills ?? [];
  if (!item.serial_number && aiPills.length === 0) return null;

  // Visual hierarchy: the serial number is the load-bearing identifier
  // (uniquely identifies this physical unit), so it gets the brighter
  // accent treatment. The AI-extracted spec pills are reference facts
  // and use the muted base chip so they don't compete with the SN for
  // attention.
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {item.serial_number ? (
        <span className="chip chip-ai chip-mono">
          SN {item.serial_number}
        </span>
      ) : null}
      {aiPills.map((pill, i) => (
        <span key={`${pill.label}-${i}`} className="chip">
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {pill.label}
          </span>
          <span>{pill.value}</span>
        </span>
      ))}
    </div>
  );
}

function ResearchPanel({
  item,
  isPending,
  error,
  onResearch,
}: {
  item: InventoryDetailItem;
  isPending: boolean;
  error: string | null;
  onResearch: () => void;
}) {
  const canResearch = Boolean(item.manufacturer && item.model_number);
  const insights = item.ai_insights;

  const itemTypeLabel = TYPE_EYEBROW_LABEL[item.type].toLowerCase();

  // Always show the model's headline when insights are present, even
  // when found_specific_model is false — the headline is the model's
  // best one-line description of the category, and pairing it with the
  // category-level disclaimer below is more useful than burying it.
  const eyebrow = `What we know about ${itemTypeLabel}s like yours`;

  return (
    <section className="surface-ai p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="sparkles" size={14} />
            </span>
            <span className="eyebrow">{eyebrow}</span>
          </div>
          {insights?.headline ? (
            <div className="h3" style={{ marginTop: 2 }}>
              {insights.headline}
            </div>
          ) : null}
        </div>
        <ResearchButton
          disabled={!canResearch}
          loading={isPending}
          hasResults={insights !== null}
          onClick={onResearch}
        />
      </div>

      <div className="relative">
        {!insights && !isPending && !error ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Click <span style={{ color: "var(--color-text-primary)" }}>
              Research this model
            </span>{" "}
            to look up details about this {itemTypeLabel}.
          </p>
        ) : null}

        {insights ? (
          <InsightsBody
            insights={insights}
            itemTypeLabel={itemTypeLabel}
          />
        ) : null}

        {isPending ? (
          <ResearchLoadingOverlay
            manufacturer={item.manufacturer}
            modelNumber={item.model_number}
          />
        ) : null}

        {error ? (
          <p
            className="text-small mt-3"
            role="alert"
            style={{ color: "var(--color-danger, #c44)" }}
          >
            {error} <button
              type="button"
              onClick={onResearch}
              className="underline"
              style={{ color: "inherit" }}
            >
              Try again?
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function InsightsBody({
  insights,
  itemTypeLabel,
}: {
  insights: InventoryInsights;
  itemTypeLabel: string;
}) {
  // Three independently-nullable sections. A section only renders if
  // its text is present — there's no empty header for a section the
  // model returned null for. If all three are null (the model could
  // only produce a headline), the all-null caption explains why.
  const sections: { eyebrow: string; body: string }[] = [];
  if (insights.overview) {
    sections.push({ eyebrow: "Overview", body: insights.overview });
  }
  if (insights.service_life) {
    sections.push({ eyebrow: "Service life", body: insights.service_life });
  }
  if (insights.maintenance) {
    sections.push({ eyebrow: "Maintenance", body: insights.maintenance });
  }

  const allNull = sections.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {!insights.found_specific_model ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          We couldn&apos;t find information about this specific{" "}
          {itemTypeLabel}. What follows is category-level — useful as a
          starting point but not specific to your unit.
        </p>
      ) : null}

      {allNull ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          We couldn&apos;t find detailed information about this specific{" "}
          {itemTypeLabel}. Try adjusting the manufacturer or model number
          and click Research again.
        </p>
      ) : (
        sections.map((s) => (
          <InsightsSection
            key={s.eyebrow}
            eyebrow={s.eyebrow}
            body={s.body}
          />
        ))
      )}
    </div>
  );
}

function InsightsSection({
  eyebrow,
  body,
}: {
  eyebrow: string;
  body: string;
}) {
  return (
    <div>
      <div
        className="eyebrow mb-1"
        style={{ letterSpacing: "1.2px", fontSize: 10 }}
      >
        {eyebrow}
      </div>
      <div
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {body.split(/\n\n+/).map((para, i) => (
          <p key={i} className={i === 0 ? "" : "mt-2"}>
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}

// The Sonar call takes ~10-15 seconds — most of which is the web-search
// phase that the AI Gateway doesn't expose progress signals for. The
// narration below is theater (timed phase changes, not real progress)
// but it gives the user a sense that work is happening in stages and
// makes the wait feel shorter than a single static "Researching…" line.
//
// Phases are paced to roughly match the model's typical behavior:
// search → read sources → write summary, with a "still working" fallback
// for slower runs.
const RESEARCH_PHASES: { atMs: number; label: (subject: string) => string }[] = [
  { atMs: 0, label: (s) => `Searching the web for ${s}…` },
  { atMs: 5000, label: () => "Reading sources…" },
  { atMs: 11000, label: () => "Writing your summary…" },
  { atMs: 20000, label: () => "Still working — almost there…" },
];

function ResearchLoadingOverlay({
  manufacturer,
  modelNumber,
}: {
  manufacturer: string | null;
  modelNumber: string | null;
}) {
  const subject =
    manufacturer && modelNumber
      ? `${manufacturer} ${modelNumber}`
      : manufacturer ?? modelNumber ?? "this item";

  // The overlay only mounts while the research call is in flight, so
  // the initial phase is always 0 — no synchronous reset needed inside
  // the effect (which would trip react-hooks/set-state-in-effect). The
  // setTimeouts that advance the phase are async, so they're fine.
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const timers = RESEARCH_PHASES.slice(1).map((phase, i) =>
      setTimeout(() => setPhaseIndex(i + 1), phase.atMs),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const label = RESEARCH_PHASES[phaseIndex].label(subject);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-surface-ai) 80%, transparent)",
        borderRadius: "inherit",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="research-spinner"
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            borderRadius: 999,
            border: "2px solid var(--color-border-subtle)",
            borderTopColor: "var(--color-accent)",
          }}
        />
        <span
          key={phaseIndex}
          className="research-phase-label text-small"
          style={{ color: "var(--color-text-secondary)" }}
          aria-live="polite"
        >
          {label}
        </span>
      </div>
      <style>{`
        @keyframes research-spinner-rotate { to { transform: rotate(360deg); } }
        .research-spinner { animation: research-spinner-rotate 0.9s linear infinite; }
        @keyframes research-phase-fade {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .research-phase-label { animation: research-phase-fade 240ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .research-spinner { animation: none; }
          .research-phase-label { animation: none; }
        }
      `}</style>
    </div>
  );
}

function ResearchButton({
  disabled,
  loading,
  hasResults,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  hasResults: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="btn btn-ghost"
      aria-disabled={disabled || loading ? "true" : "false"}
      style={disabled ? { opacity: 0.55 } : undefined}
    >
      <Icon name={hasResults ? "refresh-cw" : "sparkles"} size={14} />
      {hasResults ? "Research again" : "Research this model"}
    </button>
  );

  if (!disabled) return button;

  return (
    <Tooltip
      content="Add manufacturer and model number to research this item."
      side="bottom"
    >
      {button}
    </Tooltip>
  );
}

function PlaceholderPanel({
  title,
  eyebrow,
  emptyHint,
  rows,
}: {
  title: string;
  eyebrow: string;
  emptyHint: string;
  rows: { icon: IconName; title: string; meta: string }[];
}) {
  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <div className="h3 mt-0.5">{title}</div>
        </div>
        <Tooltip
          content="Coming in a future update."
          side="bottom"
        >
          <span
            className="text-small inline-flex items-center gap-1"
            style={{
              color: "var(--color-text-tertiary)",
              opacity: 0.7,
              cursor: "not-allowed",
            }}
            aria-disabled="true"
          >
            Add
            <Icon name="plus" size={14} />
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <div className="panel-row" key={i}>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              style={{
                backgroundColor: "var(--color-bg-surface-raised)",
                color: "var(--color-text-secondary)",
              }}
            >
              <Icon name={r.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span
                className="block truncate"
                style={{ fontSize: 14, fontWeight: 500 }}
              >
                {r.title}
              </span>
              <span
                className="block truncate text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {r.meta}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p
        className="text-small mt-3"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {emptyHint}
      </p>
    </section>
  );
}

function PanelRowStyles(): ReactNode {
  return (
    <style>{`
      .panel-row {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        background-color: transparent;
        border: 1px solid transparent;
        text-align: left;
      }
    `}</style>
  );
}

function formatYearMonth(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatLongDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatRelativeYears(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);
  if (Math.abs(days) < 30) {
    return days >= 0 ? "This month" : "Next month";
  }
  const years = days / 365.25;
  if (days < 0) {
    const future = Math.abs(years);
    if (future < 1) {
      const months = Math.round((Math.abs(days) / 365.25) * 12);
      return months <= 1 ? "Next month" : `In ${months} months`;
    }
    const rounded = Math.round(future * 10) / 10;
    return rounded === 1 ? "In 1 year" : `In ${rounded.toFixed(rounded < 2 ? 1 : 0)} years`;
  }
  if (years < 1) {
    const months = Math.round((days / 365.25) * 12);
    return months <= 1 ? "Last month" : `${months} months ago`;
  }
  const rounded = Math.floor(years);
  return rounded === 1 ? "1 year ago" : `${rounded} years ago`;
}
