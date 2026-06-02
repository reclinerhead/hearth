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
import { buildMaintenancePlanAction } from "@/app/actions/maintenance/build-plan";
import {
  EditInventoryItemModal,
  type EditableInventoryRow,
} from "@/components/edit-inventory-item-modal";
import { Icon, type IconName } from "@/components/icon";
import { SmartUploader } from "@/components/smart-uploader/SmartUploader";
import { Toast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import {
  formatManufactureDate,
  pickFirstDateTile,
} from "@/lib/inventory/first-date-tile";
import type { DecodeSerialResult } from "@/lib/serial-decode/schema";
import { displayModelNumber } from "@/lib/inventory/model-number";
import {
  parsePetMetadata,
  parseVehicleMetadata,
  type VehicleMetadata,
} from "@/lib/inventory/metadata-schemas";
import { insightsSchema } from "@/lib/inventory-insights/research";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import type { SynthesisRunLog } from "@/lib/maintenance/types";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { PhotoLightbox } from "./photo-lightbox";
import { ReceiptExtractionPeek } from "./receipt-extraction-peek";
import { ReceiptPageFlipModal } from "./receipt-page-flip-modal";
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
  InventoryReceipt,
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
  "appliance" | "system" | "exterior" | "property",
  string
> = {
  appliance: "Appliances",
  system: "Systems",
  exterior: "Exterior",
  property: "Property",
};

const TYPE_EYEBROW_LABEL: Record<
  "appliance" | "system" | "exterior" | "property",
  string
> = {
  appliance: "Appliance",
  system: "System",
  exterior: "Exterior",
  property: "Property",
};

// Render-time helper for the "Research this model" panel's eyebrow.
// "appliances like yours" / "systems like yours" reads naturally;
// "propertys like yours" doesn't. The lowercase here is intentional —
// it appears inline in a longer sentence ("What we know about X").
function pluralizeTypeLabel(
  type: "appliance" | "system" | "exterior" | "property",
  subtype: string | null,
): string {
  if (type === "property") {
    if (subtype === "vehicle") return "vehicles";
    if (subtype === "pet") return "pets";
    return "items";
  }
  return `${TYPE_EYEBROW_LABEL[type].toLowerCase()}s`;
}

export type HistoryEvent =
  | {
      id: string;
      kind: "completed_task";
      taskKind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
      /** ISO timestamp for completed tasks, YYYY-MM-DD for milestones. */
      date: string;
      title: string;
      detail: string | null;
    }
  | {
      id: string;
      kind: "milestone";
      date: string;
      title: string;
    };

export function InventoryDetailView({
  item,
  rooms,
  linkedDocumentCount,
  receipts,
  historyEvents,
  maintenancePanelSlot,
}: {
  item: InventoryDetailItem;
  rooms: RoomOption[];
  linkedDocumentCount: number;
  receipts: InventoryReceipt[];
  historyEvents: HistoryEvent[];
  /**
   * Server-rendered maintenance panel for this inventory item. Rendered
   * from page.tsx so the panel keeps its own RLS-scoped Supabase server
   * client. Passed in as a slot rather than rendered here because this
   * component is a client boundary. Per-use practices (issue #135) live
   * inside this same panel as a dedicated "Every time you use it" tier —
   * the wrapper selects per-use rows and the panel routes them to the
   * tier directly, so this is the only maintenance slot the page needs.
   */
  maintenancePanelSlot: ReactNode;
}) {
  const isProperty = item.type === "property";
  const isVehicle = isProperty && item.subtype === "vehicle";
  const isPet = isProperty && item.subtype === "pet";

  const displayModel = displayModelNumber(item.model_number);
  // Vehicles read more naturally with the item name as the headline
  // ("Toyota Land Cruiser") than a synthesized Manufacturer + Model
  // line — the manufacturer is already implied by the name and the
  // model_number for a vehicle is usually the trim or "Land Cruiser",
  // which would duplicate the name verbatim.
  const title = isVehicle
    ? item.name
    : item.manufacturer && displayModel
      ? `${item.manufacturer} ${displayModel}`
      : item.name;

  const subtypeWord = isVehicle ? "Vehicle" : isPet ? "Pet" : null;
  const eyebrowLeft = subtypeWord
    ? subtypeWord.toUpperCase()
    : TYPE_EYEBROW_LABEL[item.type].toUpperCase();
  const eyebrow = `${eyebrowLeft} · ${item.roomName.toUpperCase()}`;

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

        // Mirror the server-side maintenance auto-chain (issue #248): the
        // research route starts synthesis in its own onFinish when the
        // result carries a non-null maintenance section. Flag it here so
        // the effect below can flip the Build button into its in-flight
        // state and surface the handoff message. We only set a ref — the
        // synthesis state setters live further down this component, and
        // the consuming effect has a non-stale view of liveSynthesisRun.
        const maintenance = (object as StreamingInsights).maintenance;
        if (typeof maintenance === "string" && maintenance.trim().length > 0) {
          pendingAutoChainRef.current = true;
        }
      }
    },
  });
  const researchError = researchHookError?.message ?? null;

  // Parallel serial-decode call (issue #77). Fires alongside the
  // research stream on the same click. The decode endpoint waits for a
  // reasoning model to return a structured result, then persists it
  // server-side only when confidence === "high". When that happens, we
  // surface a small toast and call router.refresh() so the StatTiles
  // fallback (Manufactured vs Installed) sees the new column values.
  // The decode in-flight state is tracked separately from researchPending
  // so cancelling one doesn't affect the other.
  const [decodedToast, setDecodedToast] = useState<string | null>(null);
  const decodeRequestIdRef = useRef(0);
  const handleResearch = useCallback(() => {
    submitResearch({});

    // Capture a request id so a fast re-click cancels the older toast
    // path — only the most recent decode call can land a toast.
    decodeRequestIdRef.current += 1;
    const myId = decodeRequestIdRef.current;

    void (async () => {
      try {
        const response = await fetch(
          `/api/inventory/${item.id}/decode-serial`,
          { method: "POST" },
        );
        if (!response.ok) return;
        const body = (await response.json()) as
          | { skipped: "no-serial" }
          | { result: DecodeSerialResult | null };

        if ("skipped" in body) return;
        if (decodeRequestIdRef.current !== myId) return;

        const result = body.result;
        if (!result || result.confidence !== "high" || !result.manufacture_date) {
          return;
        }

        const formatted = formatManufactureDate(
          result.manufacture_date,
          result.precision,
        );
        setDecodedToast(`We decoded your manufacture date: ${formatted}`);
        router.refresh();
      } catch (err) {
        // The toast is a nice-to-have surface — a network failure on the
        // decode call should never break the page or interrupt the
        // research stream that's running in parallel.
        console.warn("[serial-decode] decode call failed:", err);
      }
    })();
  }, [submitResearch, item.id, router]);

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

  // Maintenance plan build/rebuild state. The button is gated on
  // ai_insights.maintenance being populated; the workflow runs in the
  // background and writes hearth.inventory.last_synthesis_run at
  // completion. The Realtime subscription below flips us out of the
  // in-flight state when that write lands.
  const maintenanceInsight =
    typeof (item.ai_insights as { maintenance?: string | null } | null)
      ?.maintenance === "string"
      ? (item.ai_insights as { maintenance: string }).maintenance
      : null;
  const hasMaintenanceInsight = Boolean(
    maintenanceInsight && maintenanceInsight.trim().length > 0,
  );

  const [liveSynthesisRun, setLiveSynthesisRun] =
    useState<SynthesisRunLog | null>(item.last_synthesis_run);
  // Captured the moment the user clicks Build. Tells the realtime
  // listener which trace counts as "the new one" — anything newer than
  // this baseline is a fresh run completing. Null means no baseline
  // captured yet (the user hasn't clicked since the page loaded).
  const synthesisBaselineRef = useRef<string | null>(
    item.last_synthesis_run?.completed_at ?? null,
  );
  const [synthesisInFlight, setSynthesisInFlight] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);

  // Drives the awareness-framed progress line that lives at the bottom of
  // the "What we know" panel (issue #254 relocated it out of the under-
  // button caption slot from #248). One state serves both trigger paths so
  // the in-flight message is identical whether the user clicked Build or
  // the research auto-chain started it:
  //   "building" — synthesis is running; show "Building your plan…".
  //   "idle"     — no run in flight. The persistent completion line at the
  //                panel bottom is driven by `hasPriorPlan`, not by this
  //                machine, so there is no longer a transient "ready" state.
  // This is purely presentational; the workflow runs server-side
  // regardless. The same Realtime / polling completion detection that flips
  // the button out of its in-flight state returns this to "idle".
  const [planMessageState, setPlanMessageState] = useState<
    "idle" | "building"
  >("idle");
  // Set in the research stream's onFinish (defined above, before the
  // synthesis state exists) and consumed in the effect below, mirroring
  // the pendingResearchTriggerRef pattern. The consuming effect reads the
  // freshest liveSynthesisRun for the baseline, avoiding the stale closure
  // the early onFinish callback would otherwise capture.
  const pendingAutoChainRef = useRef(false);

  // Subscribe to UPDATE events on this inventory row so the button
  // can flip out of its in-flight state the moment the workflow
  // finishes. Same pattern as useHouseRealtime, but narrow enough that
  // inlining it here is simpler than extracting a generic hook for a
  // single consumer.
  //
  // Realtime delivery for hearth.inventory is currently unreliable —
  // the channel subscribes cleanly but UPDATE events don't reach the
  // browser in some environments. Issue #128 tracks the investigation.
  // The polling fallback below is what's actually flipping the button
  // today; this subscription remains in place so we get the
  // sub-second response time for free if/when realtime starts
  // delivering.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`inventory:${item.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "hearth",
          table: "inventory",
          filter: `id=eq.${item.id}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const next = payload.new.last_synthesis_run as
            | SynthesisRunLog
            | null
            | undefined;
          if (!next) return;
          setLiveSynthesisRun(next);
          // The trace's completed_at is the load-bearing comparison —
          // if it advanced past our baseline, this is a fresh run
          // finishing and we should flip out of in-flight.
          const baseline = synthesisBaselineRef.current;
          if (!baseline || next.completed_at > baseline) {
            setSynthesisInFlight(false);
            if (next.error) {
              setSynthesisError(next.error);
              setPlanMessageState("idle");
            } else {
              // Return to idle; the persistent completion line at the
              // panel bottom (driven by hasPriorPlan, which flips true
              // once liveSynthesisRun lands error-free) takes over.
              setPlanMessageState("idle");
              // The workflow writes maintenance_tasks rows before
              // persisting the trace, so by the time this fires the new
              // tasks are already in the DB. Re-run the server component
              // so the maintenancePanelSlot picks them up without a
              // manual reload (issue #133 follow-up).
              router.refresh();
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [item.id, router]);

  // Polling fallback for the in-flight state. Active only while a
  // synthesis run is in flight, and torn down the moment we observe a
  // completed trace. This is currently the primary in-flight detection
  // path — see "Realtime delivery for hearth.inventory" comment on the
  // subscription effect above and issue #128 for the open investigation.
  // Polling cadence matches the houses hook (2.5s).
  //
  // A 3-minute safety hatch flips the button back to a usable state if
  // neither realtime nor polling has surfaced a result — the workflow
  // is supposed to finish in 50-60s, so 3 min comfortably covers a slow
  // model call. The button re-enables to a fresh "Build" click without
  // claiming success; the user can retry if needed.
  useEffect(() => {
    if (!synthesisInFlight) return;

    const supabase = createBrowserSupabaseClient();
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (cancelled) return;
      const { data } = await supabase
        .from("inventory")
        .select("last_synthesis_run")
        .eq("id", item.id)
        .single();
      if (cancelled || !data) return;
      const next = data.last_synthesis_run as SynthesisRunLog | null;
      if (next) {
        setLiveSynthesisRun(next);
        const baseline = synthesisBaselineRef.current;
        if (!baseline || next.completed_at > baseline) {
          setSynthesisInFlight(false);
          if (next.error) {
            setSynthesisError(next.error);
            setPlanMessageState("idle");
          } else {
            // Return to idle; the persistent completion line keyed on
            // hasPriorPlan takes over from here.
            setPlanMessageState("idle");
            // Same rationale as the realtime branch — the maintenance
            // panel is server-rendered and won't reflect the new rows
            // without a refresh.
            router.refresh();
          }
          return;
        }
      }
      pollTimer = setTimeout(poll, 2500);
    }

    pollTimer = setTimeout(poll, 2500);

    const safetyTimer = setTimeout(
      () => {
        if (cancelled) return;
        setSynthesisInFlight(false);
        setPlanMessageState("idle");
        setSynthesisError(
          "We didn't hear back from the synthesis run in time. Check the inventory dashboard — your plan may have been written even though this page didn't see it. If not, try again.",
        );
      },
      3 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(safetyTimer);
    };
  }, [item.id, synthesisInFlight, router]);

  const handleBuildMaintenancePlan = useCallback(async () => {
    setSynthesisError(null);
    setPlanMessageState("building");
    setSynthesisInFlight(true);
    synthesisBaselineRef.current =
      liveSynthesisRun?.completed_at ??
      item.last_synthesis_run?.completed_at ??
      null;
    try {
      const result = await buildMaintenancePlanAction(item.id);
      if (!result.ok) {
        setSynthesisInFlight(false);
        setSynthesisError(result.error);
      }
      // On ok we leave in-flight true — the polling fallback above
      // flips it back when last_synthesis_run lands (and the realtime
      // subscription will too, once issue #128 is resolved).
    } catch (err) {
      setSynthesisInFlight(false);
      setSynthesisError(
        err instanceof Error
          ? err.message
          : "Couldn't start the synthesis. Try again in a moment.",
      );
    }
  }, [item.id, item.last_synthesis_run, liveSynthesisRun]);

  // Capture the completion baseline and flip into the in-flight state for
  // the research auto-chain (issue #248). Same body shape as the head of
  // handleBuildMaintenancePlan, but reads the freshest liveSynthesisRun
  // for the baseline rather than the stale value the early research
  // onFinish closure would capture.
  const beginAutoChainInFlight = useCallback(() => {
    setSynthesisError(null);
    synthesisBaselineRef.current =
      liveSynthesisRun?.completed_at ??
      item.last_synthesis_run?.completed_at ??
      null;
    setSynthesisInFlight(true);
    setPlanMessageState("building");
  }, [liveSynthesisRun, item.last_synthesis_run]);

  // Consume the auto-chain flag the research stream's onFinish sets.
  // Mirrors the pendingResearchTriggerRef idiom above: onFinish only sets
  // a ref, and this effect runs after the synthesis state exists. The
  // existing Realtime / polling effects then drive it to completion
  // exactly as they do for a manual click.
  useEffect(() => {
    if (pendingAutoChainRef.current) {
      pendingAutoChainRef.current = false;
      beginAutoChainInFlight();
    }
  });

  // Source-of-truth for "has a successful prior run" — prefer the live
  // trace from realtime (newer than first paint) but fall back to the
  // server-rendered value so refreshes get the right copy on first
  // paint without waiting for a Realtime echo.
  const effectiveSynthesisRun = liveSynthesisRun ?? item.last_synthesis_run;
  const hasPriorPlan = Boolean(
    effectiveSynthesisRun && !effectiveSynthesisRun.error,
  );

  // Gate for the lifted Research button (issue #254 moved it out of the
  // ResearchPanel header into the unified action row). Same rule the panel
  // used: needs a manufacturer + model number to look anything up.
  const canResearch = Boolean(item.manufacturer && item.model_number);

  // Vehicle VIN decode (issue #263). The trigger lives in the unified
  // action row below, so the decode state and handler are lifted out of
  // PropertyDetailsBlock to this parent level — the button can't sit in the
  // row (rendered here) while its state lives in a child. The decode itself
  // POSTs to /api/inventory/[id]/decode-vin and refreshes the view on
  // success; behaviour is unchanged from when it lived in the header.
  const canDecodeVin = isVehicle && Boolean(item.serial_number);
  const hasVinDecode =
    isVehicle && Boolean(parseVehicleMetadata(item.metadata).vin_decode);
  const [vinDecoding, setVinDecoding] = useState(false);
  const [vinDecodeError, setVinDecodeError] = useState<string | null>(null);
  const [vinDecodeToast, setVinDecodeToast] = useState<string | null>(null);

  const handleDecodeVin = useCallback(async () => {
    setVinDecodeError(null);
    setVinDecoding(true);
    try {
      const response = await fetch(`/api/inventory/${item.id}/decode-vin`, {
        method: "POST",
      });
      const body = (await response.json()) as
        | {
            result: { raw: Record<string, string | null> };
            applied: {
              name: string | null;
              manufacturer: string | null;
              model_number: string | null;
              model_year: number | null;
              manufacture_date: string | null;
            };
          }
        | { error: string };
      if (!response.ok || "error" in body) {
        setVinDecodeError(
          "error" in body
            ? body.error
            : "Couldn't reach NHTSA. Try again in a moment.",
        );
        return;
      }
      // Prefer the server-applied name (already title-cased and
      // year-prefixed) when the route rewrote it. Falls back to the raw
      // NHTSA fields when the row's name was already personalized and we
      // left it alone.
      const applied = body.applied;
      const summary =
        applied.name ??
        [
          applied.model_year ? String(applied.model_year) : null,
          applied.manufacturer ?? body.result.raw.Make,
          applied.model_number ?? body.result.raw.Model,
        ]
          .filter(Boolean)
          .join(" ");
      setVinDecodeToast(
        summary ? `We decoded your VIN: ${summary}` : "We decoded your VIN.",
      );
      router.refresh();
    } catch (err) {
      setVinDecodeError(
        err instanceof Error
          ? err.message
          : "Something went wrong decoding the VIN.",
      );
    } finally {
      setVinDecoding(false);
    }
  }, [item.id, router]);

  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  // The Smart Uploader can be opened in two target modes: photo (the
  // existing "Add photo" button) or receipt (the new "Add document"
  // button, issue #117). Tracking the kind alongside the open flag
  // lets us reuse a single uploader instance instead of mounting two.
  const [uploaderKind, setUploaderKind] = useState<"photo" | "receipt" | null>(
    null,
  );
  const addPhotoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addDocumentTriggerRef = useRef<HTMLButtonElement | null>(null);
  // hearth.documents.id of the receipt whose pages are currently open
  // in the page-flip modal. Null when no receipt is selected.
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null);

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
    subtype: item.subtype,
    room_id: item.room_id,
    manufacturer: item.manufacturer,
    model_number: item.model_number,
    serial_number: item.serial_number,
    installed_on: item.installed_on,
    last_serviced_on: item.last_serviced_on,
    next_service_due_on: item.next_service_due_on,
    purchased_on: item.purchased_on,
    estimated_value_cents: item.estimated_value_cents,
    metadata: item.metadata,
    notes: item.notes,
    manufacture_date: item.manufacture_date,
    hero_document_id: item.hero_document_id,
  };

  // The edit modal needs the document id alongside the thumbnail path
  // so it can persist the user's hero selection back to
  // inventory.hero_document_id. The same list the hero / lightbox use,
  // re-shaped to the modal's prop type.
  const photoChoices = item.photos.map((p) => ({
    id: p.id,
    thumbnailPath: p.thumbnailPath,
  }));

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
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <div className="min-w-0">
            <div className="eyebrow">{eyebrow}</div>
            <h1 className="h1" style={{ marginTop: 4 }}>
              {title}
            </h1>
          </div>
          {synthesisError ? (
            <p
              className="text-small"
              role="alert"
              style={{ color: "var(--color-danger, #c44)" }}
            >
              {synthesisError}{" "}
              <button
                type="button"
                onClick={() => setSynthesisError(null)}
                className="underline"
                style={{ color: "inherit" }}
              >
                Dismiss
              </button>
            </p>
          ) : null}

          <StatTiles item={item} />

          <PillCluster item={item} />

          {vinDecodeError ? (
            <p
              className="text-small"
              role="alert"
              style={{ color: "var(--color-danger)" }}
            >
              {vinDecodeError}
            </p>
          ) : null}

          {isPet ? <PetDetails meta={parsePetMetadata(item.metadata)} /> : null}

          {decodedToast ? (
            <Toast
              message={decodedToast}
              onClose={() => setDecodedToast(null)}
            />
          ) : null}
          {vinDecodeToast ? (
            <Toast
              message={vinDecodeToast}
              onClose={() => setVinDecodeToast(null)}
            />
          ) : null}
        </div>
      </section>

      {/*
        Unified action row (issue #254). All applicable actions live in a
        single full-width, equal-width row beneath the item header — order:
        Add photo, Add document, Research, Build/Rebuild plan, Edit details.
        Each button sits in a `flex-1 basis-52` (208px) cell, so widths are
        pinned by the flex distribution rather than by label length: the
        in-flight label swaps (Research → Researching…, Build → Building
        plan…) never shift layout. 208px is the widest basis that still lets
        all five share the ~1168px content width on one row; below ~1100px
        the row wraps to additional equal-width rows, down to one button per
        row on phones. `[&>*]:w-full` forces whatever the cell holds —
        a bare button or a Tooltip-wrapped one — to fill its cell. The
        buttons that don't apply to an item simply omit their cell:
        Research is appliance/system/exterior-only, Build appears once a
        maintenance insight exists, and Decode / Re-decode VIN (issue #263)
        appears only for vehicles — slotted immediately before Edit details.
      */}
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
          <button
            ref={addPhotoTriggerRef}
            type="button"
            onClick={() => setUploaderKind("photo")}
            className="btn btn-ghost"
            aria-label={`Add another photo of ${item.name}`}
          >
            <Icon name="camera" size={16} />
            Add photo
          </button>
        </div>
        <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
          <button
            ref={addDocumentTriggerRef}
            type="button"
            onClick={() => setUploaderKind("receipt")}
            className="btn btn-ghost"
            aria-label={`Add a document or receipt for ${item.name}`}
          >
            <Icon name="file-text" size={16} />
            Add document
          </button>
        </div>
        {isProperty ? null : (
          <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
            <ResearchButton
              disabled={!canResearch}
              loading={researchPending}
              // A research run on an item with a maintenance plan auto-chains
              // into a rebuild, so once synthesis is in flight Research is
              // locked too — both unlock together when the plan lands.
              busy={synthesisInFlight}
              hasResults={Boolean(displayInsights)}
              onClick={handleResearch}
            />
          </div>
        )}
        {hasMaintenanceInsight ? (
          <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
            <BuildMaintenancePlanButton
              hasPriorPlan={hasPriorPlan}
              inFlight={synthesisInFlight}
              // Lock the button while a research run is in flight: research
              // auto-chains into a rebuild on finish, so the user shouldn't
              // (and needn't) trigger one by hand in the meantime. It shows
              // its spinner only once synthesis actually starts (inFlight);
              // during the research window it's a plain disabled state.
              disabled={researchPending || synthesisInFlight}
              onClick={handleBuildMaintenancePlan}
            />
          </div>
        ) : null}
        {isVehicle ? (
          <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
            <DecodeVinButton
              canDecode={canDecodeVin}
              decoding={vinDecoding}
              hasDecoded={hasVinDecode}
              onClick={handleDecodeVin}
            />
          </div>
        ) : null}
        <div className="flex-1 basis-52 min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
          <button
            ref={editTriggerRef}
            type="button"
            onClick={() => setEditOpen(true)}
            className="btn btn-ghost"
            aria-label={`Edit details for ${item.name}`}
          >
            <Icon name="edit" size={14} />
            Edit details
          </button>
        </div>
      </div>

      {isProperty ? null : (
        // Property doesn't use the "Research this model" panel — it's
        // tuned for appliances and systems (service life, maintenance,
        // manufacturer-published spec sheets) and those questions don't
        // apply to a Land Cruiser or a television. The slot is left
        // empty until the property-side lookup module (depreciation /
        // replacement-value / recall) ships; the earlier "What we'll
        // surface for vehicles" placeholder was promising work that
        // isn't queued, which read as filler rather than information.
        <ResearchPanel
          item={item}
          insights={displayInsights}
          isPending={researchPending}
          isRegenerating={isRegenerating}
          error={researchError}
          onResearch={handleResearch}
          planBuilding={planMessageState === "building"}
          hasPriorPlan={hasPriorPlan}
        />
      )}

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
          photos={photoChoices}
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

      {/*
        Same conditional-mount pattern as the edit modal: every open
        is a fresh React mount, so the Smart Uploader's stage state and
        upload hook re-initialize cleanly. The target* props lock the
        Smart Uploader to this inventory item — matching is skipped and
        a successful analyze flows straight to the success stage.
      */}
      {uploaderKind !== null ? (
        <SmartUploader
          open
          onOpenChange={(open) => {
            if (!open) {
              const previousKind = uploaderKind;
              setUploaderKind(null);
              // Return focus to whichever trigger opened the uploader
              // so keyboard users pick up where they left off, matching
              // the edit modal pattern below.
              requestAnimationFrame(() => {
                if (previousKind === "receipt") {
                  addDocumentTriggerRef.current?.focus();
                } else {
                  addPhotoTriggerRef.current?.focus();
                }
              });
            }
          }}
          houseId={item.house_id}
          targetInventoryId={item.id}
          targetInventoryName={item.name}
          targetKind={uploaderKind}
          onSaved={() => {
            // Pull the just-attached document into the photos array so
            // the hero / photo strip surfaces it on the next paint.
            router.refresh();
          }}
        />
      ) : null}

      {/*
        "On your plate" maintenance panel for this inventory item
        (issue #133). Server-rendered slot — the panel runs its own
        RLS-scoped Supabase server client. Sits between the Research
        panel (above) and the Documents / Notes grid (below), matching
        the layout decision documented in the issue. Per-use practices
        (issue #135) render as a dedicated "Every time you use it" tier
        inside this same panel.

        While synthesis is in flight the tasks below are being rewritten,
        so a semi-opaque refresh overlay sits over the whole section to
        reinforce that the plan beneath is reloading (issue #254 testing
        feedback). It blocks interaction with the soon-to-be-stale rows
        and clears itself the moment the run completes.
      */}
      <section className="relative">
        {maintenancePanelSlot}
        {synthesisInFlight ? <MaintenanceRefreshOverlay /> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <DocumentsPanel
          receipts={receipts}
          itemName={item.name}
          onOpenReceipt={setOpenReceiptId}
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

      <ReceiptPageFlipModal
        open={openReceiptId !== null}
        documentId={openReceiptId}
        altPrefix={`${item.name} receipt`}
        onClose={() => setOpenReceiptId(null)}
      />

      <section>
        <SectionHeader
          eyebrow="Everything that's happened"
          title="History"
        />
        <ol className="surface p-4 sm:p-5">
          {historyEvents.length === 0 ? (
            <TimelineItem
              icon="info"
              title="No history yet"
              detail="Completed maintenance tasks, install dates, and other milestones will appear here as they're recorded."
            />
          ) : (
            historyEvents.map((event) => (
              <TimelineItem
                key={event.id}
                icon={historyEventIcon(event)}
                title={event.title}
                meta={formatLongDate(event.date)}
                detail={
                  event.kind === "completed_task"
                    ? event.detail ?? undefined
                    : undefined
                }
              />
            ))
          )}
        </ol>
      </section>

      <PanelRowStyles />
    </div>
  );
}

function StatTiles({ item }: { item: InventoryDetailItem }) {
  // Property items don't have service schedules — the Last serviced /
  // Next due slots get replaced with Purchased / Estimated value, both
  // of which are user-entered and feed the insurance-inventory report.
  // Vehicles also drop the "Manufactured" decode fallback (it doesn't
  // apply — the model year is in metadata, not the manufacture-date
  // pipeline), so the first tile is always Purchased for property.
  const isProperty = item.type === "property";

  if (isProperty) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <MetricCard
          eyebrow="Purchased"
          value={
            item.purchased_on ? (
              formatYearMonth(item.purchased_on)
            ) : (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                Unknown
              </span>
            )
          }
          meta={item.purchased_on ? formatRelativeYears(item.purchased_on) : null}
          icon="calendar"
        />
        <MetricCard
          eyebrow="Estimated value"
          value={
            item.estimated_value_cents !== null ? (
              formatUsd(item.estimated_value_cents)
            ) : (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                Unknown
              </span>
            )
          }
          meta={null}
          icon="dollar-sign"
        />
        <MetricCard
          eyebrow={item.subtype === "vehicle" ? "Model year" : "Acquired"}
          value={renderPropertyThirdTile(item)}
          meta={null}
          icon={item.subtype === "vehicle" ? "car" : "package"}
        />
      </div>
    );
  }

  // Always render all three tiles. The first tile uses the
  // installed-vs-manufactured-vs-unknown selector (issue #77): when
  // installed_on is null AND a high-confidence manufacture date is
  // present, the tile flips its eyebrow to "Manufactured" and renders
  // the decoded date. Otherwise it shows "Installed" with either the
  // real value or the "Unknown" placeholder. Layout stays stable.
  const firstTile = pickFirstDateTile({
    installedOn: item.installed_on,
    manufactureDate: item.manufacture_date,
    manufactureDatePrecision: item.manufacture_date_precision,
    manufactureDateConfidence: item.manufacture_date_confidence,
  });

  const firstTileEyebrow =
    firstTile.kind === "manufactured" ? "Manufactured" : "Installed";

  const firstTileValue: ReactNode = (() => {
    if (firstTile.kind === "installed") {
      return formatYearMonth(firstTile.isoDate);
    }
    if (firstTile.kind === "manufactured") {
      return formatManufactureDate(
        firstTile.manufactureDate,
        firstTile.precision,
      );
    }
    return (
      <span style={{ color: "var(--color-text-tertiary)" }}>Unknown</span>
    );
  })();

  // Relative-time meta only makes sense for a known date. The
  // manufactured branch could in theory compute a "12 years ago" line,
  // but unit age isn't the same conceptual axis as install age, and
  // mixing them in the same slot would be misleading. Keep the meta
  // line empty for the manufactured branch.
  const firstTileMeta =
    firstTile.kind === "installed" ? formatRelativeYears(firstTile.isoDate) : null;

  const secondaryTiles: {
    eyebrow: string;
    isoDate: string | null;
    icon: IconName;
  }[] = [
    {
      eyebrow: "Last serviced",
      isoDate: item.last_serviced_on,
      icon: "tool",
    },
    { eyebrow: "Next due", isoDate: item.next_service_due_on, icon: "clock" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <MetricCard
        eyebrow={firstTileEyebrow}
        value={firstTileValue}
        meta={firstTileMeta}
        icon="calendar"
      />
      {secondaryTiles.map((t) => (
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

function renderPropertyThirdTile(item: InventoryDetailItem): ReactNode {
  if (item.subtype === "vehicle") {
    const vmeta = parseVehicleMetadata(item.metadata);
    if (vmeta.model_year) return String(vmeta.model_year);
    return (
      <span style={{ color: "var(--color-text-tertiary)" }}>Unknown</span>
    );
  }
  // For pets and generic property we fall back to "Acquired" as a
  // distinct date from purchase — adoption date for pets, gifted
  // date for inherited items. metadata.adopted_on is the pet-specific
  // version; non-pet property uses purchased_on for both slots, but
  // when adopted_on isn't present we lean on the value being Unknown
  // rather than duplicating purchased_on across two tiles.
  if (item.subtype === "pet") {
    const pmeta = parsePetMetadata(item.metadata);
    if (pmeta.adopted_on) return formatYearMonth(pmeta.adopted_on);
  }
  return <span style={{ color: "var(--color-text-tertiary)" }}>Unknown</span>;
}

// Format a cents-precision integer as a USD currency string. cents
// stay in bigint at the DB layer; the application reads them as
// JavaScript numbers, which is safe for any realistic household
// inventory value (well inside Number.MAX_SAFE_INTEGER).
function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function PillCluster({ item }: { item: InventoryDetailItem }) {
  const aiPills = item.ai_pills ?? [];
  const isVehicle = item.type === "property" && item.subtype === "vehicle";
  const vmeta = isVehicle ? parseVehicleMetadata(item.metadata) : null;
  const hasVehiclePlate = Boolean(vmeta?.license_plate);
  // Decoded NHTSA facts now flow into this same cluster (issue #263) rather
  // than rendering as a separate row beneath a header button. With the VIN
  // button moved into the action row, the VIN/SN identifier pill and the
  // decoded facts read as one wrapping group instead of the VIN sitting
  // alone on its own row above the facts.
  const vinFacts = vmeta?.vin_decode ? vinDecodeFactRows(vmeta.vin_decode) : [];

  if (
    !item.serial_number &&
    aiPills.length === 0 &&
    !hasVehiclePlate &&
    vinFacts.length === 0
  ) {
    return null;
  }

  // Visual hierarchy: the serial number is the load-bearing identifier
  // (uniquely identifies this physical unit), so it gets the brighter
  // accent treatment. For vehicles the same column carries the VIN,
  // which is even more clearly "the identifier" — relabel the chip
  // accordingly. The AI-extracted spec pills and the decoded NHTSA facts
  // are reference facts and use the muted base chip so they don't compete
  // with the SN for attention. License plate sits between the two —
  // second-most-identifying for a vehicle, but not a unique-forever
  // identity.
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {item.serial_number ? (
        <span className="chip chip-ai chip-mono">
          {isVehicle ? "VIN" : "SN"} {item.serial_number}
        </span>
      ) : null}
      {isVehicle && vmeta?.license_plate ? (
        <span className="chip chip-mono">
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {vmeta.license_plate_state
              ? `${vmeta.license_plate_state} Plate`
              : "Plate"}
          </span>
          <span>{vmeta.license_plate}</span>
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
      {vinFacts.map((r) => (
        <span key={r.label} className="chip">
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {r.label}
          </span>
          <span>{r.value}</span>
        </span>
      ))}
    </div>
  );
}

// Cherry-pick the handful of NHTSA variables a homeowner actually cares
// about from the ~130 returned per VIN — most are blank or industry-internal
// (NCSA body type code, trim-level data, etc.). Returns the decoded facts as
// {label, value} rows; PillCluster folds them in alongside the VIN identifier
// and spec pills (issue #263) so everything reads as one wrapping group.
function vinDecodeFactRows(
  decode: NonNullable<VehicleMetadata["vin_decode"]>,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const raw = decode.raw;
  const pick = (key: string, label: string) => {
    const v = raw[key];
    if (v) rows.push({ label, value: v });
  };
  pick("BodyClass", "Body class");
  pick("VehicleType", "Vehicle type");
  pick("EngineCylinders", "Engine cylinders");
  pick("FuelTypePrimary", "Fuel");
  pick("DriveType", "Drive");
  pick("PlantCountry", "Built in");
  return rows;
}

// VIN decode trigger for the unified action row (issue #263). Mirrors the
// other action-row cells: btn btn-ghost, equal-width via the cell wrapper,
// refresh-cw / sparkles glyph, and the Decoding… / Re-decode VIN / Decode
// VIN label logic the header button used. When the vehicle has no VIN yet
// the button renders disabled (consistent with how Research disables) — the
// inline "Add the VIN above" helper sentence has no home in the equal-width
// row, so the reason moves to a tooltip.
function DecodeVinButton({
  canDecode,
  decoding,
  hasDecoded,
  onClick,
}: {
  canDecode: boolean;
  decoding: boolean;
  hasDecoded: boolean;
  onClick: () => void;
}) {
  const inactive = !canDecode || decoding;
  const label = decoding
    ? "Decoding…"
    : hasDecoded
      ? "Re-decode VIN"
      : "Decode VIN";

  const button = (
    <button
      type="button"
      disabled={inactive}
      onClick={onClick}
      className="btn btn-ghost w-full"
      aria-disabled={inactive ? "true" : "false"}
      aria-label={label}
      data-loading={decoding ? "true" : "false"}
      style={inactive ? { opacity: 0.55 } : undefined}
    >
      <Icon name={hasDecoded ? "refresh-cw" : "sparkles"} size={14} />
      {label}
    </button>
  );

  if (canDecode) return button;

  return (
    <Tooltip content="Add the VIN above to decode this vehicle." side="bottom">
      {button}
    </Tooltip>
  );
}

function PetDetails({
  meta,
}: {
  meta: ReturnType<typeof parsePetMetadata>;
}) {
  const rows: { label: string; value: string }[] = [];
  if (meta.species) rows.push({ label: "Species", value: meta.species });
  if (meta.breed) rows.push({ label: "Breed", value: meta.breed });
  if (meta.color) rows.push({ label: "Color", value: meta.color });
  if (meta.sex)
    rows.push({
      label: "Sex",
      value: meta.sex.charAt(0).toUpperCase() + meta.sex.slice(1),
    });
  if (meta.microchip_number)
    rows.push({ label: "Microchip", value: meta.microchip_number });
  if (meta.vet_name) rows.push({ label: "Vet", value: meta.vet_name });

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => (
        <span key={r.label} className="chip">
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {r.label}
          </span>
          <span>{r.value}</span>
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
  planBuilding,
  hasPriorPlan,
}: {
  item: InventoryDetailItem;
  insights: PanelInsights | null;
  isPending: boolean;
  isRegenerating: boolean;
  error: string | null;
  // The Research action now lives in the unified row above the panel
  // (issue #254); the panel keeps `onResearch` only for the inline
  // "Try again?" retry on the error path.
  onResearch: () => void;
  // Maintenance synthesis progress + completion now render at the bottom
  // of this panel rather than beneath the Build button (issue #254).
  // `planBuilding` is the in-flight line; `hasPriorPlan` drives the
  // persistent completion line on every load.
  planBuilding: boolean;
  hasPriorPlan: boolean;
}) {
  const itemTypeLabel = TYPE_EYEBROW_LABEL[item.type].toLowerCase();
  const itemTypePlural = pluralizeTypeLabel(item.type, item.subtype);

  // Always show the model's headline when insights are present, even
  // when found_specific_model is false — the headline is the model's
  // best one-line description of the category, and pairing it with the
  // category-level disclaimer below is more useful than burying it.
  const eyebrow = `What we know about ${itemTypePlural} like yours`;

  // First-time run with nothing on screen: show the loading overlay
  // until the first chunk arrives. For regenerate-with-prior-insights,
  // the overlay would cover the existing content unhelpfully — we use
  // the dim + "Regenerating…" indicator instead, owned by isRegenerating.
  const showOverlay =
    isPending && !insights?.headline && !insights?.overview;

  return (
    <section className="surface-ai p-4 sm:p-5">
      <div className="mb-3">
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
        Maintenance synthesis progress + completion (issue #254). Lives at
        the very bottom of the panel — beneath the Maintenance section and
        the Sources subsection — rather than under the Build button. While a
        run is in flight it shows the animated "Building/Rebuilding your plan
        — about 30s" line; once a successful run exists it settles into a
        persistent completion line that points the user at the maintenance
        panel directly below. Rendered outside the dim-on-regenerate wrapper
        so a research re-run never dims it. `researchInFlight` hides the
        stale prior-run completion line the moment a fresh research stream
        starts — it reappears on its own once the auto-chained rebuild
        begins (building) and then completes.
      */}
      <MaintenancePlanPanelMessage
        building={planBuilding}
        hasPriorPlan={hasPriorPlan}
        researchInFlight={isPending}
        itemTypeWord={itemTypeLabel}
      />

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
  busy,
  hasResults,
  onClick,
}: {
  // `disabled` is the can't-research gate (missing manufacturer/model) and
  // is the only state that surfaces the explanatory tooltip. `busy` is the
  // research-auto-chains-into-a-rebuild lock — it disables the button while
  // synthesis runs but carries no tooltip, since the reason isn't missing
  // fields. `loading` is this button's own in-flight research stream.
  disabled: boolean;
  loading: boolean;
  busy: boolean;
  hasResults: boolean;
  onClick: () => void;
}) {
  // Loading state needs to look obviously inactive — otherwise users
  // (rightly) keep clicking when nothing visible happens for the first
  // ~15s before stream content starts arriving. Opacity drop + the
  // refresh-cw icon spinning gives an immediate "I heard you" signal,
  // and the disabled attribute already prevents repeat submissions.
  const inactive = disabled || loading || busy;

  const button = (
    <button
      type="button"
      disabled={inactive}
      onClick={onClick}
      className="btn btn-ghost research-button w-full"
      aria-disabled={inactive ? "true" : "false"}
      aria-label={
        loading
          ? hasResults
            ? "Regenerating…"
            : "Researching…"
          : hasResults
            ? "Research again"
            : "Research this model"
      }
      data-loading={loading ? "true" : "false"}
      style={inactive ? { opacity: 0.55 } : undefined}
    >
      <span
        className={loading && hasResults ? "research-button-icon-spin" : ""}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {/* The re-run state earns the more expressive wand-sparkles glyph
            (issue #254); the first-run state keeps the plain sparkles. */}
        <Icon name={hasResults ? "wand-sparkles" : "sparkles"} size={14} />
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

function BuildMaintenancePlanButton({
  hasPriorPlan,
  inFlight,
  disabled,
  onClick,
}: {
  hasPriorPlan: boolean;
  // `inFlight` is this button's own synthesis run — it shows the spinner +
  // in-flight label. `disabled` is the broader lock that also covers the
  // research window before the auto-chained rebuild starts: the button is
  // non-clickable but stays in its resting label (no spinner) until
  // synthesis actually begins. `inFlight` always implies disabled.
  inFlight: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isDisabled = disabled || inFlight;
  // First build is a call-to-action — surface it with the primary
  // accent treatment so a user with research insights actually notices
  // the next step. After a successful build the action drops to ghost:
  // the work is done, rebuild is a maintenance affordance rather than
  // a "do this next" pointer.
  const variantClass = hasPriorPlan ? "btn btn-ghost" : "btn btn-primary";
  // The rebuild state earns the more expressive wand-sparkles glyph (issue
  // #254); the first build keeps the plain sparkles call-to-action icon.
  const iconName: IconName = hasPriorPlan ? "wand-sparkles" : "sparkles";

  // Resting and in-flight labels. The "maintenance" word is abbreviated to
  // "maint" rather than dropped — it keeps the button specific ("Rebuild
  // maint" reads as maintenance, not a generic "plan") while staying narrow
  // enough for the equal-width five-button row to share the ~1168px content
  // width (the verbose "Rebuild maintenance plan" was the one label too wide
  // to fit). The resting copy and the in-flight copy are stacked in a single
  // grid cell (below) so the visible text stays centered when it flips.
  const restingLabel = hasPriorPlan ? "Rebuild maint" : "Build maint";
  const inFlightLabel = hasPriorPlan ? "Rebuilding maint…" : "Building maint…";

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      className={`${variantClass} build-plan-button`}
      aria-disabled={isDisabled ? "true" : "false"}
      aria-label={inFlight ? inFlightLabel : restingLabel}
      data-loading={inFlight ? "true" : "false"}
      style={isDisabled ? { opacity: inFlight ? 0.65 : 0.55 } : undefined}
    >
      <span
        className={inFlight ? "build-plan-icon-spin" : ""}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <Icon name={iconName} size={14} />
      </span>
      {/*
        Same-cell label stack. Both the resting and in-flight strings
        occupy grid cell 1/1, so the track sizes to the wider label and the
        text stays centered when it flips in-flight. The hidden label keeps
        its box via visibility:hidden rather than display:none.
      */}
      <span className="grid build-plan-label-stack" aria-hidden="true">
        <span className="build-plan-label-cell" data-on={!inFlight}>
          {restingLabel}
        </span>
        <span className="build-plan-label-cell" data-on={inFlight}>
          {inFlightLabel}
        </span>
      </span>
      <style>{`
        .build-plan-label-stack { justify-items: center; }
        .build-plan-label-cell {
          grid-column: 1;
          grid-row: 1;
          white-space: nowrap;
        }
        .build-plan-label-cell[data-on="false"] { visibility: hidden; }
        @keyframes build-plan-icon-rotate { to { transform: rotate(360deg); } }
        .build-plan-icon-spin {
          animation: build-plan-icon-rotate 0.9s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .build-plan-icon-spin { animation: none; }
        }
      `}</style>
    </button>
  );
}

// Maintenance synthesis progress + completion message that lives at the
// bottom of the "What we know" panel (issue #254 relocated it out of the
// under-button caption slot from #248). Two states drive its copy:
//   - `building` — a run is in flight (manual click or research auto-chain).
//     Shows the awareness-framed "Building/Rebuilding your plan — about 30s"
//     line with a spinning glyph; the ~30s estimate is a deliberate product
//     choice (the run itself takes ~50-60s).
//   - else `hasPriorPlan` — a successful run exists. Shows a persistent
//     completion line that stays on every load and points the user at the
//     "On your plate" maintenance panel rendered directly below this one.
// Nothing renders before a plan has ever been built, and a latest run that
// errored is handled by the inline error path, not here. Unlike the old
// caption there is no transient "ready" state — completion is persistent.
function MaintenancePlanPanelMessage({
  building,
  hasPriorPlan,
  researchInFlight,
  itemTypeWord,
}: {
  building: boolean;
  hasPriorPlan: boolean;
  // True while a fresh research stream is running. The prior run's
  // completion line is stale the instant a re-research starts, so we hide
  // it immediately; the auto-chained rebuild then re-surfaces the in-flight
  // line (building) and, on finish, the new completion line — all on their
  // own. The in-flight line itself is never suppressed.
  researchInFlight: boolean;
  // The item-type label ("appliance" / "system" / "exterior"), lowercased
  // for inline use in the completion sentence.
  itemTypeWord: string;
}) {
  if (researchInFlight && !building) return null;
  if (!building && !hasPriorPlan) return null;

  const text = building
    ? hasPriorPlan
      ? "Rebuilding your plan — about 30s"
      : "Building your plan — about 30s"
    : `We've finished generating maintenance events for this ${itemTypeWord}. Please review those below.`;

  return (
    <div
      className="maintenance-plan-panel-message insights-appear"
      aria-live="polite"
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid var(--color-border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: 500,
        color: building
          ? "var(--color-text-secondary)"
          : "var(--color-accent)",
      }}
    >
      <span
        className={building ? "maintenance-plan-panel-message-spin" : ""}
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          color: "var(--color-accent)",
        }}
        aria-hidden
      >
        <Icon name={building ? "refresh-cw" : "circle-check"} size={14} />
      </span>
      <span>{text}</span>
      <style>{`
        @keyframes maintenance-plan-panel-message-rotate { to { transform: rotate(360deg); } }
        .maintenance-plan-panel-message-spin {
          animation: maintenance-plan-panel-message-rotate 0.9s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .maintenance-plan-panel-message-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}

// Semi-opaque "refreshing" overlay laid over the whole "On your plate"
// maintenance section while synthesis is in flight (issue #254 testing
// feedback). The tasks beneath are being rewritten, so the overlay frosts
// + dims them, runs an accent shimmer sweep to read as "reloading," and
// blocks clicks on the soon-to-be-stale rows. It's purely decorative
// (`aria-hidden`) — the panel-bottom progress line already announces state
// via aria-live — and clears itself the moment the run completes.
function MaintenanceRefreshOverlay() {
  return (
    <div
      className="maintenance-refresh-overlay"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 52,
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 58%, transparent)",
        backdropFilter: "blur(1.5px)",
        WebkitBackdropFilter: "blur(1.5px)",
      }}
    >
      <span className="maintenance-refresh-shimmer" aria-hidden />
      <span
        className="maintenance-refresh-badge"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-accent)",
          backgroundColor: "var(--color-bg-surface-raised)",
          border: "1px solid var(--color-border-subtle)",
          boxShadow: "0 6px 18px rgba(0, 0, 0, 0.25)",
        }}
      >
        <span
          className="maintenance-refresh-spin"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <Icon name="refresh-cw" size={14} />
        </span>
        Refreshing your maintenance plan…
      </span>
      <style>{`
        .maintenance-refresh-overlay {
          animation: maintenance-refresh-fade 200ms ease-out both;
        }
        @keyframes maintenance-refresh-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .maintenance-refresh-shimmer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            105deg,
            transparent 35%,
            color-mix(in oklab, var(--color-accent) 14%, transparent) 50%,
            transparent 65%
          );
          background-size: 220% 100%;
          animation: maintenance-refresh-shimmer-move 1.6s linear infinite;
        }
        @keyframes maintenance-refresh-shimmer-move {
          from { background-position: 130% 0; }
          to { background-position: -130% 0; }
        }
        @keyframes maintenance-refresh-spin-kf { to { transform: rotate(360deg); } }
        .maintenance-refresh-spin {
          animation: maintenance-refresh-spin-kf 0.9s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .maintenance-refresh-overlay,
          .maintenance-refresh-shimmer,
          .maintenance-refresh-spin { animation: none; }
        }
      `}</style>
    </div>
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

function DocumentsPanel({
  receipts,
  itemName,
  onOpenReceipt,
}: {
  receipts: InventoryReceipt[];
  itemName: string;
  onOpenReceipt: (documentId: string) => void;
}) {
  // Device-appropriate peek entry gesture (issue #259). On hover-capable
  // pointers (desktop / laptop) the peek opens on tile hover; on touch it
  // gets an explicit "What we found" affordance instead. We branch on the
  // pointer capability, never on viewport width — a touch laptop and a
  // desktop both deserve the correct behaviour. Defaults to hover-capable so
  // the desktop majority sees no first-paint flicker; the effect corrects to
  // the explicit affordance on touch right after mount.
  const [hoverCapable, setHoverCapable] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHoverCapable(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="eyebrow">What we have on file</div>
          <div className="h3 mt-0.5">Documents</div>
        </div>
      </div>
      {receipts.length === 0 ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          No receipts attached yet. Tap <strong>Add document</strong>{" "}
          above to capture one — a service receipt, invoice, or other
          paperwork — and we&apos;ll read the details for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {receipts.map((r) => (
            <li key={r.id}>
              <ReceiptListRow
                receipt={r}
                itemName={itemName}
                hoverCapable={hoverCapable}
                onOpen={() => onOpenReceipt(r.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Intent + grace delays for the desktop hover peek. The open delay keeps the
// panel from firing on cursor pass-through; the close delay is the hoverable
// bridge that lets the cursor cross the gap from tile into the floating panel
// without dismissing it.
const PEEK_OPEN_DELAY_MS = 400;
const PEEK_CLOSE_DELAY_MS = 160;

function ReceiptListRow({
  receipt,
  itemName,
  hoverCapable,
  onOpen,
}: {
  receipt: InventoryReceipt;
  itemName: string;
  hoverCapable: boolean;
  onOpen: () => void;
}) {
  // 96-thumb is plenty at the list row size; same sessionStorage-cached
  // signed URL helper everything else uses.
  const thumbUrl = useCachedSignedUrl(
    "hearth-documents",
    receipt.thumbnailPath,
    null,
  );
  const title =
    receipt.vendorName ??
    receipt.transactionType
      ?.replace(/\b\w/g, (c) => c.toUpperCase()) ??
    "Receipt";
  const dateLabel = receipt.transactionDate
    ? formatReceiptDate(receipt.transactionDate)
    : null;
  const totalLabel = formatReceiptTotal(
    receipt.totalCents,
    receipt.currency,
  );
  const pageLabel =
    receipt.pageCount > 1 ? `${receipt.pageCount} pages` : null;

  // The extraction peek is independent of the tile-click → page-flip modal:
  // tile click still opens the original pages (onOpen); the peek is the
  // "what we found" surface. The tile is the anchor for the desktop popover.
  const [peekOpen, setPeekOpen] = useState(false);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = undefined;
    }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  // Tear down any pending timers on unmount.
  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearOpenTimer, clearCloseTimer],
  );

  const closePeek = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setPeekOpen(false);
  }, [clearOpenTimer, clearCloseTimer]);

  // Desktop hover handlers — only attached when the device is hover-capable.
  const handleTileEnter = useCallback(() => {
    clearCloseTimer();
    if (peekOpen) return;
    clearOpenTimer();
    openTimerRef.current = setTimeout(
      () => setPeekOpen(true),
      PEEK_OPEN_DELAY_MS,
    );
  }, [peekOpen, clearOpenTimer, clearCloseTimer]);
  const handleTileLeave = useCallback(() => {
    clearOpenTimer();
    if (!peekOpen) return;
    closeTimerRef.current = setTimeout(
      () => setPeekOpen(false),
      PEEK_CLOSE_DELAY_MS,
    );
  }, [peekOpen, clearOpenTimer]);
  // Hoverable bridge: re-entering the floating panel cancels the close;
  // leaving it schedules one.
  const cancelClose = useCallback(() => clearCloseTimer(), [clearCloseTimer]);
  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(
      () => setPeekOpen(false),
      PEEK_CLOSE_DELAY_MS,
    );
  }, []);

  const handleViewOriginal = useCallback(() => {
    closePeek();
    onOpen();
  }, [closePeek, onOpen]);

  return (
    <div
      ref={tileRef}
      className="overflow-hidden"
      style={{
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
      onMouseEnter={hoverCapable ? handleTileEnter : undefined}
      onMouseLeave={hoverCapable ? handleTileLeave : undefined}
    >
      <button
        type="button"
        onClick={() => {
          closePeek();
          onOpen();
        }}
        aria-label={`Open ${title} receipt for ${itemName}`}
        className="flex w-full items-center gap-3 p-2 text-left transition-colors"
        style={{ backgroundColor: "transparent" }}
      >
        <span
          className="shrink-0 overflow-hidden"
          style={{
            height: 56,
            width: 42,
            borderRadius: 6,
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface-raised)",
          }}
        >
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-cover"
              aria-hidden
            />
          ) : (
            <span className="block h-full w-full" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontSize: 14, fontWeight: 500 }}
          >
            {title}
          </span>
          <span
            className="block truncate text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {[dateLabel, pageLabel].filter(Boolean).join(" · ") ||
              "Receipt"}
          </span>
        </span>
        {totalLabel ? (
          <span
            className="shrink-0"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {totalLabel}
          </span>
        ) : null}
      </button>

      {/* Touch devices have no hover, and the tile-tap is taken by the
          page-flip modal — so they get an explicit, labeled path into the
          peek. Gated off the same hover:hover signal so exactly one entry
          gesture is live per device. */}
      {!hoverCapable ? (
        <button
          type="button"
          onClick={() => setPeekOpen(true)}
          aria-label={`See what we found in the ${title} receipt`}
          className="flex w-full items-center justify-center gap-1.5 p-2 transition-colors"
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            color: "var(--color-accent)",
            backgroundColor: "transparent",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Icon name="sparkles" size={13} />
          What we found
        </button>
      ) : null}

      {peekOpen ? (
        <ReceiptExtractionPeek
          metadata={receipt.metadata}
          variant={hoverCapable ? "popover" : "sheet"}
          anchorRef={tileRef}
          itemName={itemName}
          onClose={closePeek}
          onViewOriginal={handleViewOriginal}
          onPointerEnter={hoverCapable ? cancelClose : undefined}
          onPointerLeave={hoverCapable ? scheduleClose : undefined}
        />
      ) : null}
    </div>
  );
}

function formatReceiptDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatReceiptTotal(
  cents: number | null,
  currency: string | null,
): string | null {
  if (cents === null) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
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

// Icon chosen so the History timeline reads at a glance: milestones use
// a circle-dot (timeline anchor); completed tasks pick up the same
// kind→icon mapping the maintenance panel rows use, but rendered through
// the "done" timeline state so they all share the green circle treatment.
const COMPLETED_TASK_ICON: Record<
  "renewal" | "service" | "inspection" | "consumable" | "seasonal",
  IconName
> = {
  renewal: "car",
  service: "tool",
  inspection: "search",
  consumable: "refresh-cw",
  seasonal: "leaf",
};

function historyEventIcon(event: HistoryEvent): IconName {
  if (event.kind === "milestone") return "circle-dot";
  return COMPLETED_TASK_ICON[event.taskKind];
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
