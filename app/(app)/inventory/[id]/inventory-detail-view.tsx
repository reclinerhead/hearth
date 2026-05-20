"use client";

// Client-side render of the inventory detail page. The server component
// in page.tsx loads the row (RLS-scoped) and hands us a fully-typed
// item; this component owns presentation plus the on-demand Research
// surface (streaming hook, partial-state rendering, error handling).
//
// The Research call is a POST to /api/inventory/[id]/research that
// streams a structured object via the AI SDK's useObject hook. The
// panel populates progressively as each field arrives — first headline,
// then the three sections one by one. The DB write happens server-side
// in the route's onFinish; we call router.refresh() once the stream
// completes so subsequent navigations see the persisted state.
//
// Documents / Notes & photos / Maintenance & history panels are
// intentionally placeholder content — wired to real data in a later phase.

import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EditInventoryItemModal,
  type EditableInventoryRow,
} from "@/components/edit-inventory-item-modal";
import { Icon, type IconName } from "@/components/icon";
import { Tooltip } from "@/components/tooltip";
import { insightsSchema } from "@/lib/inventory-insights/research";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import { PhotoLightbox } from "./photo-lightbox";
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

// Shape the Research panel reads from. While streaming, fields are
// `undefined` until the model emits them; once persisted, the
// committed InventoryInsights from the server has them all (with
// section fields nullable per the schema). The panel handles both by
// only rendering fields that are present.
type StreamingInsights = {
  headline?: string;
  overview?: string | null;
  service_life?: string | null;
  maintenance?: string | null;
  source_urls?: string[];
  found_specific_model?: boolean;
};

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
  // the update action itself; the hook below kicks off the new fetch.
  //
  // useObject streams a structured object from the POST endpoint. While
  // in flight, `object` is a DeepPartial — fields populate as the model
  // emits them. We render the streaming object during the call and fall
  // back to the persisted item.ai_insights once router.refresh() has
  // pulled the new server-rendered state.
  const router = useRouter();
  const {
    object: streamingObject,
    submit: submitResearch,
    isLoading: researchPending,
    error: researchHookError,
    clear: clearResearch,
  } = useObject({
    api: `/api/inventory/${item.id}/research`,
    schema: insightsSchema,
    onFinish: ({ object, error }) => {
      // router.refresh() pulls the freshly-persisted ai_insights into
      // the page so subsequent navigations and reloads see the same
      // data the stream just produced. The streaming object is still
      // held by the hook until clear() runs, so the user sees no flash.
      if (object && !error) {
        router.refresh();
      }
    },
  });
  const researchError = researchHookError?.message ?? null;
  const handleResearch = useCallback(() => {
    submitResearch({});
  }, [submitResearch]);

  // Auto-trigger research after the edit modal reports that key fields
  // changed. The ref is set inside onSaved and consumed in the effect
  // below so the trigger fires once per save, not on every render.
  // clearResearch() drops any prior streamed object so the panel starts
  // fresh — otherwise a stale stream from the previous click would
  // briefly flash during the re-run.
  const pendingResearchTriggerRef = useRef(false);
  useEffect(() => {
    if (pendingResearchTriggerRef.current) {
      pendingResearchTriggerRef.current = false;
      clearResearch();
      handleResearch();
    }
  });

  // Source of truth for the Research panel: prefer the in-flight /
  // just-completed streaming object when present, otherwise the
  // persisted insights the server component handed us. The streaming
  // object lives in client state and is gone after a navigation, so the
  // committed value is what users see on subsequent loads.
  const displayInsights: StreamingInsights | InventoryInsights | null =
    useMemo(() => {
      if (streamingObject) return streamingObject as StreamingInsights;
      return item.ai_insights;
    }, [streamingObject, item.ai_insights]);

  // "Regenerating" is the gap between clicking re-run on an item that
  // already has insights and the first streamed chunk arriving — easily
  // 10-15s on GPT-5.5. Without an explicit signal here, the panel just
  // sits there showing the old content unchanged because the
  // displayInsights fallback keeps rendering item.ai_insights. The
  // panel uses this flag to dim the old content and surface a small
  // "Regenerating…" indicator so the click visibly registers.
  const isRegenerating =
    researchPending &&
    Boolean(item.ai_insights) &&
    !(streamingObject as StreamingInsights | undefined)?.headline;

  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  // The hero slot is 260px wide; the 600px thumbnail is plenty (2x+
  // DPR) and is the same asset already cached by dashboard tiles, so
  // navigating from dashboard to detail typically resolves from
  // sessionStorage and the bytes from the browser's HTTP cache. The
  // 1920px storage_path is reserved for the lightbox.
  const heroPhoto = item.photos[0] ?? null;
  const heroUrl = useCachedSignedUrl(
    "hearth-documents",
    heroPhoto?.thumbnailPath ?? null,
    null,
  );

  // Lightbox open state. `index` is which slide the lightbox opens to;
  // future surfaces (e.g. a thumbnail strip) could pass non-zero. The
  // hero only ever opens at index 0.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const photoCount = item.photos.length;
  const hasPhotos = photoCount > 0;

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
          { label: TYPE_BREADCRUMB_LABEL[item.type], href: "/inventory" },
          { label: item.roomName },
          { label: item.name },
        ]}
      />

      <section className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          {heroUrl ? (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={
                photoCount > 1
                  ? `View ${photoCount} photos of ${item.name}`
                  : `View photo of ${item.name}`
              }
              className="hero-photo-trigger block w-full rounded-lg overflow-hidden relative"
              style={{
                aspectRatio: "1 / 1",
                border: "1px solid var(--color-border-subtle)",
                cursor: "zoom-in",
                padding: 0,
                background: "transparent",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroUrl}
                alt={item.name}
                className="block w-full h-full object-cover"
              />
              {photoCount > 1 ? (
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    bottom: 8,
                    right: 8,
                    padding: "3px 8px",
                    borderRadius: "999px",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                    backgroundColor:
                      "color-mix(in oklab, var(--color-bg-surface) 80%, transparent)",
                    backdropFilter: "blur(6px)",
                    border: "1px solid var(--color-border-subtle)",
                  }}
                >
                  <Icon name="photo" size={11} />
                  <span style={{ marginLeft: 4 }}>{photoCount}</span>
                </span>
              ) : null}
            </button>
          ) : heroPhoto ? (
            // Photo exists but the signed URL hasn't resolved yet. A
            // neutral skeleton avoids briefly flashing the "Add photo"
            // call-to-action for an item that already has one. Warm
            // reloads swap to the image in a single effect tick; cold
            // visits hold the skeleton for the signing round trip.
            <div
              aria-hidden
              className="w-full rounded-lg"
              style={{
                aspectRatio: "1 / 1",
                border: "1px solid var(--color-border-subtle)",
                backgroundColor: "var(--color-bg-surface-raised)",
              }}
            />
          ) : (
            <PlaceholderImage ratio="1 / 1" label="Add photo" icon="camera" />
          )}
          {hasPhotos ? (
            <PhotoLightbox
              open={lightboxOpen}
              index={0}
              photos={item.photos}
              altPrefix={item.name}
              onClose={() => setLightboxOpen(false)}
            />
          ) : null}
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
        insights={displayInsights}
        isPending={researchPending}
        isRegenerating={isRegenerating}
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
            router.replace("/inventory");
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

// Insights coming from either the in-flight streaming object or the
// committed server-side row. Both are read-only here; the panel only
// needs to know which fields are present right now.
type PanelInsights = {
  headline?: string | undefined;
  overview?: string | null | undefined;
  service_life?: string | null | undefined;
  maintenance?: string | null | undefined;
  source_urls?: string[] | undefined;
  found_specific_model?: boolean | undefined;
};

function ResearchPanel({
  item,
  insights,
  isPending,
  isRegenerating,
  error,
  onResearch,
}: {
  item: InventoryDetailItem;
  insights: PanelInsights | null;
  isPending: boolean;
  isRegenerating: boolean;
  error: string | null;
  onResearch: () => void;
}) {
  const canResearch = Boolean(item.manufacturer && item.model_number);
  const itemTypeLabel = TYPE_EYEBROW_LABEL[item.type].toLowerCase();

  // Always show the model's headline when insights are present, even
  // when found_specific_model is false — the headline is the model's
  // best one-line description of the category, and pairing it with the
  // category-level disclaimer below is more useful than burying it.
  const eyebrow = `What we know about ${itemTypeLabel}s like yours`;

  // First-time run with nothing on screen: show the loading overlay
  // until the first chunk arrives. For regenerate-with-prior-insights,
  // the overlay would cover the existing content unhelpfully — we use
  // the dim + "Regenerating…" indicator instead, owned by isRegenerating.
  const showOverlay =
    isPending && !insights?.headline && !insights?.overview;

  // The "research has results" state for the button — true any time we
  // have content to show, whether persisted or streaming.
  const hasResults = Boolean(insights);

  return (
    <section className="surface-ai p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="sparkles" size={14} />
            </span>
            <span className="eyebrow">{eyebrow}</span>
            {isRegenerating ? (
              <span
                className="text-small regenerating-pill"
                style={{
                  marginLeft: 6,
                  padding: "1px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--color-border-subtle)",
                  color: "var(--color-text-secondary)",
                  background:
                    "color-mix(in oklab, var(--color-bg-surface-ai) 70%, transparent)",
                }}
                aria-live="polite"
              >
                Regenerating…
              </span>
            ) : null}
          </div>
          {insights?.headline ? (
            <div className="h3 insights-appear" style={{ marginTop: 2 }}>
              {insights.headline}
            </div>
          ) : null}
        </div>
        <ResearchButton
          disabled={!canResearch}
          loading={isPending}
          hasResults={hasResults}
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
          // While regenerating with prior insights on screen, dim the
          // old content + suppress the per-section appear animation so
          // the user sees a clear "this is being replaced" state. As
          // soon as the first streamed chunk arrives, isRegenerating
          // flips false, opacity returns to 1, and the new content
          // takes over with its normal appear-in animation.
          <div
            className="insights-body-dim"
            data-regenerating={isRegenerating ? "true" : "false"}
          >
            <InsightsBody
              insights={insights}
              itemTypeLabel={itemTypeLabel}
              isStreaming={isPending}
            />
          </div>
        ) : null}

        {showOverlay ? (
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

      {/*
        Fade + slight slide-in on first mount for each progressively-
        rendered piece — headline, sections, disclaimer. Streaming the
        AI Insights field-by-field would otherwise be a series of hard
        layout pops; this turns each appearance into a soft handoff.
        Matches the existing research-phase-fade keyframe in
        ResearchLoadingOverlay (same duration, same easing). Mounted at
        the panel level (not inside InsightsBody) so the keyframes are
        registered when the headline first animates in, even before
        InsightsBody itself has rendered.
      */}
      <style>{`
        @keyframes insights-appear-kf {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .insights-appear {
          animation: insights-appear-kf 240ms ease-out both;
        }
        /*
          Dim the old insights while a regenerate is in flight but no
          stream chunks have arrived yet. The opacity transition is
          long enough (180ms) to read as intentional but short enough
          that the visible feedback is near-instant after the click.
        */
        .insights-body-dim {
          transition: opacity 180ms ease-out;
        }
        .insights-body-dim[data-regenerating="true"] {
          opacity: 0.45;
        }
        /*
          The "Regenerating…" pill that appears next to the eyebrow
          while waiting on the first streamed chunk. Fade-in matches
          the .insights-appear keyframe.
        */
        .regenerating-pill {
          animation: insights-appear-kf 180ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .insights-appear,
          .regenerating-pill { animation: none; }
          .insights-body-dim { transition: none; }
        }
      `}</style>
    </section>
  );
}

function InsightsBody({
  insights,
  itemTypeLabel,
  isStreaming,
}: {
  insights: PanelInsights;
  itemTypeLabel: string;
  isStreaming: boolean;
}) {
  // Three independently-nullable sections. A section only renders if
  // its text is present — there's no empty header for a section the
  // model returned null for. If all three are null AND we're not still
  // streaming (so we know the model is done), the all-null caption
  // explains why. While streaming, missing sections may still arrive,
  // so we just render what we have so far without a final-state caption.
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

  const allNull = sections.length === 0 && !isStreaming;

  // The model can only set found_specific_model after generating the
  // body, so it arrives near the end of the stream. We don't want to
  // flash the "category-level only" disclaimer mid-stream when the
  // field is briefly undefined, so the disclaimer only shows when the
  // field has explicitly been set to false (committed or fully streamed).
  const showCategoryDisclaimer = insights.found_specific_model === false;

  return (
    <div className="flex flex-col gap-4">
      {showCategoryDisclaimer ? (
        <p
          className="text-small insights-appear"
          style={{ color: "var(--color-text-secondary)" }}
        >
          We couldn&apos;t find information about this specific{" "}
          {itemTypeLabel}. What follows is category-level — useful as a
          starting point but not specific to your unit.
        </p>
      ) : null}

      {allNull ? (
        <p
          className="text-small insights-appear"
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

      <SourcesList urls={insights.source_urls} />
    </div>
  );
}

function SourcesList({ urls }: { urls: string[] | undefined }) {
  // source_urls is the LAST field the model emits, so during streaming
  // it's undefined until almost the end. We only render the subsection
  // when there's at least one URL to show — no dangling "Sources"
  // header when the array is empty or missing. Filter out anything
  // that isn't a parseable URL: the schema validates the final object
  // but mid-stream the partial may briefly carry a half-typed URL like
  // "https://www.whirlp" before the next chunk arrives, and an <a> with
  // a broken href is worse than the field rendering a fraction of a
  // second late.
  const valid = (urls ?? []).filter((u) => {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });

  if (valid.length === 0) return null;

  return (
    <div className="insights-appear">
      <div
        className="eyebrow mb-1"
        style={{ letterSpacing: "1.2px", fontSize: 10 }}
      >
        Sources
      </div>
      <ul className="flex flex-col gap-1" style={{ listStyle: "none" }}>
        {valid.map((url, i) => (
          <li key={`${url}-${i}`} className="text-small sources-list-item">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="sources-list-link"
            >
              {url}
            </a>
          </li>
        ))}
      </ul>
      <style>{`
        .sources-list-item {
          /*
            Long PDF / spec-sheet URLs are common — truncate with
            ellipsis on a single line so they never wrap and break the
            panel layout. The underlying anchor keeps the full href, so
            the click target is the visible (truncated) text and the
            destination is the complete URL.
          */
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sources-list-link {
          color: var(--color-text-secondary);
          text-decoration: underline;
          text-decoration-color: var(--color-border-subtle);
          text-underline-offset: 2px;
          transition: color 120ms ease-out, text-decoration-color 120ms ease-out;
        }
        .sources-list-link:hover {
          color: var(--color-accent);
          text-decoration-color: currentColor;
        }
      `}</style>
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
    <div className="insights-appear">
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

// With streaming, the overlay's job is to cover the brief gap between
// click and first-token (typically 1-3 seconds before the headline
// arrives). After that the panel populates progressively from the
// stream and the overlay is gone. The narration is intentionally short
// — there's not enough time to need multiple stages, and once the
// stream starts the real content does the talking.
const RESEARCH_PHASES: { atMs: number; label: (subject: string) => string }[] = [
  { atMs: 0, label: (s) => `Looking up ${s}…` },
  { atMs: 4000, label: () => "Almost there…" },
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
  // Loading state needs to look obviously inactive — otherwise users
  // (rightly) keep clicking when nothing visible happens for the first
  // ~15s before stream content starts arriving. Opacity drop + the
  // refresh-cw icon spinning gives an immediate "I heard you" signal,
  // and the disabled attribute already prevents repeat submissions.
  const inactive = disabled || loading;

  const button = (
    <button
      type="button"
      disabled={inactive}
      onClick={onClick}
      className="btn btn-ghost research-button"
      aria-disabled={inactive ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
      style={inactive ? { opacity: 0.55 } : undefined}
    >
      <span
        className={loading && hasResults ? "research-button-icon-spin" : ""}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <Icon name={hasResults ? "refresh-cw" : "sparkles"} size={14} />
      </span>
      {loading
        ? hasResults
          ? "Regenerating…"
          : "Researching…"
        : hasResults
          ? "Research again"
          : "Research this model"}
      <style>{`
        @keyframes research-button-icon-rotate { to { transform: rotate(360deg); } }
        .research-button-icon-spin {
          animation: research-button-icon-rotate 0.9s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .research-button-icon-spin { animation: none; }
        }
      `}</style>
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
