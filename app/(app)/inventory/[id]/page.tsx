// Inventory item detail page (phase 1.5). Lives at /inventory/[id] —
// the route the dashboard's inventory tiles link into. Real Next.js
// page (not a modal): deep-linkable, refresh-safe, and the natural home
// for both the structured-pills surface and the "Research this model"
// AI lookup.
//
// Data fetch happens in this server component; the interactive surfaces
// (Research button with loading/error states, future edit flows) live
// in the client-side InventoryDetailView. RLS does the authorization
// work — the same ownership chain the dashboard uses.

import { notFound } from "next/navigation";
import type {
  ManufactureDateConfidence,
  ManufactureDatePrecision,
} from "@/lib/inventory/first-date-tile";
import type { SynthesisRunLog } from "@/lib/maintenance/types";
import { deriveIsFirstUnresearchedItem } from "@/lib/inventory/first-unresearched";
import { orderPhotosHeroFirst } from "@/lib/inventory/hero-photo";
import {
  parseReceiptMetadata,
  type ReceiptMetadata,
} from "@/lib/documents/metadata-schemas";
import { createClient } from "@/lib/supabase/server";
import type { InventorySubtype } from "@/types/document";
import { InventoryDetailView, type HistoryEvent } from "./inventory-detail-view";
import { MaintenancePanelItem } from "./maintenance-panel-item";

type InventoryType = "appliance" | "system" | "exterior" | "property";

// Hand-typed mirror of lib/inventory-insights/research.ts insightsSchema,
// plus the persistence fields the server action adds (generated_at,
// model_used). Each section is independently nullable so the model can
// be honest about a section it couldn't ground.
//
// Old rows written before the three-section shape landed still carry a
// `body` string. The detail page reads only the new fields, so the
// legacy shape renders as if no sections are populated — the user
// clicks "Research again" to regenerate.
export type InventoryInsights = {
  headline: string;
  overview: string | null;
  service_life: string | null;
  maintenance: string | null;
  source_urls: string[];
  found_specific_model: boolean;
  generated_at: string;
  model_used: string | null;
};

export type InventoryPhoto = {
  // hearth.documents.id — the same id the edit modal uses to set
  // hero_document_id when the user picks this photo as the hero.
  id: string;
  storagePath: string;
  thumbnailPath: string;
};

// Renewal document rendered by the inventory detail page's Documents
// section (issue #280). A registration/insurance card photographed
// through the create-from-document path is a `nameplate`/`photo` row
// (so it doubles as the item's hero photo) that carries an extracted
// `metadata.expiration_date`. The Documents panel lists these alongside
// receipts so the scan is previewable as a document, matching the
// add-document-to-existing flow. The `id` matches an entry in `photos`,
// which is how the panel opens the scan in the shared lightbox.
export type InventoryRenewalDocument = {
  id: string;
  thumbnailPath: string;
  storagePath: string;
  createdAt: string;
  // Issuing authority / vendor (metadata.vendor_name) — the row title.
  // Null falls back to a generic "Renewal document" label in the view.
  title: string | null;
  // Validated YYYY-MM-DD expiration the renewal task was anchored to.
  expirationDate: string;
};

// Receipt rendered by the inventory detail page's Documents section.
// Issue #117 — multi-page receipt attachment. The list view uses just
// the page-1 thumbnail and a few high-value metadata fields; the
// page-flip modal lazy-loads every page on demand.
export type InventoryReceipt = {
  id: string;
  thumbnailPath: string;
  createdAt: string;
  vendorName: string | null;
  transactionDate: string | null;
  totalCents: number | null;
  currency: string | null;
  transactionType: string | null;
  /** Total pages = 1 (parent storage_path) + N (document_pages rows). */
  pageCount: number;
  // Full parsed extraction metadata (issue #259). The thin fields above
  // drive the list-row tile; this carries everything Hearth read off the
  // receipt — line items, vendor contact, cost breakdown, identifiers — for
  // the extraction peek panel to render. Parsed server-side via
  // parseReceiptMetadata so the panel is a pure render of props with no
  // client Supabase round-trip.
  metadata: ReceiptMetadata;
};

export type InventoryDetailItem = {
  id: string;
  house_id: string;
  room_id: string;
  name: string;
  type: InventoryType;
  subtype: InventorySubtype | null;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_on: string | null;
  last_serviced_on: string | null;
  next_service_due_on: string | null;
  // Property-friendly columns (issue #23). purchased_on is the
  // acquisition date; estimated_value_cents is user-entered and feeds
  // the future insurance-inventory report's value aggregation.
  purchased_on: string | null;
  estimated_value_cents: number | null;
  // Subtype-specific bag. Parse via lib/inventory/metadata-schemas.
  metadata: Record<string, unknown>;
  notes: string | null;
  roomName: string;
  // Every attached photo for this item, most-recent first — except
  // when `hero_document_id` is set, in which case that photo moves to
  // index 0 so the hero slot / lightbox / preview pickers all read the
  // user's pinned choice. The lightbox steps through all of them at
  // full resolution.
  photos: InventoryPhoto[];
  ai_pills: { label: string; value: string }[] | null;
  ai_insights: InventoryInsights | null;
  // Decoded manufacture date columns (issue #77). Populated by the
  // dedicated /api/inventory/[id]/decode-serial route when the
  // reasoning model returned confidence === "high", or by the edit
  // modal when the user enters a value (issue #105) — same six-column
  // contract with confidence = 'high' / model = 'user-entered'.
  manufacture_date: string | null;
  manufacture_date_precision: ManufactureDatePrecision | null;
  manufacture_date_confidence: ManufactureDateConfidence | null;
  // User-pinned hero photo selection (issue #105). NULL means "use the
  // most-recently-attached photo" — the legacy rule, still applied by
  // the photo ordering above.
  hero_document_id: string | null;
  // Built-in "House" item discriminator (issue #306). True for the one
  // auto-created row per house that represents the property itself — the
  // home for house-level documents (tax, insurance). The row carries an
  // inert `type` ('exterior'); `is_house` is the load-bearing signal that
  // drives the special title, suppressed Research/maintenance, and the
  // non-deletable/non-re-typeable guards. False for every real item.
  is_house: boolean;
  // Most recent maintenance-synthesis run trace (issue #126). NULL when
  // the item has never had a plan built. Drives the inventory detail
  // page's "Build" vs "Rebuild" button copy and gives the future task
  // modal the activity-log slice for "here's what the model considered."
  last_synthesis_run: SynthesisRunLog | null;
};

export type RoomOption = { id: string; name: string };

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: item, error } = await supabase
    .from("inventory")
    .select(
      `
      id,
      house_id,
      room_id,
      name,
      type,
      subtype,
      manufacturer,
      model_number,
      serial_number,
      installed_on,
      last_serviced_on,
      next_service_due_on,
      purchased_on,
      estimated_value_cents,
      metadata,
      notes,
      ai_pills,
      ai_insights,
      manufacture_date,
      manufacture_date_precision,
      manufacture_date_confidence,
      hero_document_id,
      last_synthesis_run,
      is_house,
      room:rooms!inner(name)
      `,
    )
    .eq("id", id)
    .single();

  if (error || !item) {
    notFound();
  }

  const row = item as unknown as {
    id: string;
    house_id: string;
    room_id: string;
    name: string;
    type: InventoryType;
    subtype: InventorySubtype | null;
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
    last_serviced_on: string | null;
    next_service_due_on: string | null;
    purchased_on: string | null;
    estimated_value_cents: number | null;
    metadata: Record<string, unknown> | null;
    notes: string | null;
    ai_pills: { label: string; value: string }[] | null;
    ai_insights: InventoryInsights | null;
    manufacture_date: string | null;
    manufacture_date_precision: ManufactureDatePrecision | null;
    manufacture_date_confidence: ManufactureDateConfidence | null;
    hero_document_id: string | null;
    last_synthesis_run: SynthesisRunLog | null;
    is_house: boolean;
    room: { name: string } | { name: string }[] | null;
  };

  const roomEntry = Array.isArray(row.room) ? row.room[0] : row.room;
  const roomName = roomEntry?.name ?? "Unknown";

  // Four independent follow-up queries against the same Supabase
  // connection. All four only need `row.house_id` / `row.id`, which we
  // already have, so we run them in parallel rather than paying for
  // four sequential round-trips on the user-visible first paint:
  //   - rooms list powers the "Room" select in the edit modal
  //   - document count drives the delete-confirm "Also delete N linked
  //     documents" copy (actual deletion still walks the rows server-side)
  //   - every attached photo for the item (`kind` filtered to actual
  //     photos so receipts / manuals stay out). orderPhotosHeroFirst
  //     puts the hero at photos[0] (pinned-wins-else-newest, issue #282);
  //     the full set feeds the click-to-expand lightbox.
  //   - attached receipts for the Documents section (issue #117),
  //     selecting the metadata and page-1 thumbnail. Page counts come
  //     from a follow-up query against document_pages once we know
  //     which receipts exist.
  const [
    roomsResult,
    docCountResult,
    heroDocsResult,
    receiptsResult,
    completedTasksResult,
    researchedCountResult,
  ] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, name")
        .eq("house_id", row.house_id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("inventory_id", row.id),
      supabase
        .from("documents")
        .select("id, storage_path, thumbnail_path, metadata, created_at")
        .eq("inventory_id", row.id)
        .eq("status", "attached")
        .in("kind", ["nameplate", "photo"])
        // Ordering is applied authoritatively by orderPhotosHeroFirst
        // below (pinned-wins-else-newest by upload time); created_at desc
        // here just keeps the pre-helper rows in a sensible order.
        .order("created_at", { ascending: false }),
      supabase
        .from("documents")
        .select(
          "id, thumbnail_path, created_at, metadata",
        )
        .eq("inventory_id", row.id)
        .eq("status", "attached")
        .eq("kind", "receipt")
        .order("created_at", { ascending: false }),
      // Real History feed (issue #133) — every completed maintenance task
      // for this item, newest first. installed_on / purchased_on
      // milestones are interleaved client-side. Read uses the partial
      // index maintenance_tasks_inventory_history_idx.
      supabase
        .from("maintenance_tasks")
        .select("id, title, subtitle, kind, completed_at, completion_notes")
        .eq("inventory_id", row.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false }),
      // First-research onboarding signal (issue #262): has *any* item in this
      // house been researched yet? One house-scoped, RLS-bound count of rows
      // carrying non-null ai_insights. head:true so we pay for the count only,
      // not the rows. Combined with this item's own ai_insights state below to
      // decide whether the "Research this model" coachmark teaches.
      supabase
        .from("inventory")
        .select("id", { count: "exact", head: true })
        .eq("house_id", row.house_id)
        .not("ai_insights", "is", null),
    ]);

  const roomOptions: RoomOption[] = (roomsResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));

  const linkedDocumentCount = docCountResult.count ?? 0;

  // Every attached photo for the item, hero-first. The detail view's
  // hero uses photos[0].thumbnailPath (600px is plenty for the 260px
  // slot, well above 2x DPR); the lightbox steps through all photos at
  // storagePath (1920px) on user click. Both URL sources are signed
  // client-side via the shared sessionStorage-cached helper — see
  // "Signed URL caching" in the Technical Guide.
  //
  // orderPhotosHeroFirst (issue #282) applies the shared hero rule: the
  // user's pinned `hero_document_id` (issue #105) leads when present,
  // otherwise the most-recently-uploaded photo leads — so a freshly
  // added photo becomes the hero without the user having to pick it. The
  // FK has ON DELETE SET NULL, so a deleted hero reverts to that newest
  // fallback automatically, and the helper no-ops cleanly when the pinned
  // id isn't in the list (e.g. status change pushed it out of the kind
  // filter). Cast the loosely-typed PostgREST rows once; both the photo
  // list and the renewal-document derivation (issue #280) read this shape.
  const heroDocRows = (heroDocsResult.data ?? []) as Array<{
    id: string;
    storage_path: string;
    thumbnail_path: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  const validDocs = heroDocRows.filter(
    (d) =>
      typeof d.id === "string" &&
      typeof d.storage_path === "string" &&
      typeof d.thumbnail_path === "string",
  );
  const orderedDocs = orderPhotosHeroFirst(validDocs, row.hero_document_id);

  const photos: InventoryPhoto[] = orderedDocs.map((d) => ({
    id: d.id,
    storagePath: d.storage_path,
    thumbnailPath: d.thumbnail_path,
  }));

  // Renewal documents (issue #280). The same attached nameplate/photo
  // rows fetched above, narrowed to those carrying a valid extracted
  // expiration date (written by the #277 create-from-document path).
  // These double as the item's hero photo *and* get a previewable entry
  // in the Documents panel — the registration/insurance card the user
  // photographed to create the vehicle, shown as the document it is.
  // Receipt-kind renewal docs (insurance via "Add document") already
  // surface in that panel as receipts, so they're intentionally not
  // re-listed here. `id` matches a `photos` entry, which is how the view
  // opens the scan in the shared lightbox.
  const renewalDocuments: InventoryRenewalDocument[] = [];
  for (const d of heroDocRows) {
    const md = (d.metadata ?? {}) as Record<string, unknown>;
    const exp = md.expiration_date;
    if (typeof exp !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
    const vendor = md.vendor_name;
    renewalDocuments.push({
      id: d.id,
      thumbnailPath: d.thumbnail_path,
      storagePath: d.storage_path,
      createdAt: d.created_at,
      title:
        typeof vendor === "string" && vendor.length > 0 ? vendor : null,
      expirationDate: exp,
    });
  }

  // Receipt page counts. One follow-up query against document_pages
  // for all attached receipts at once, then we bucket by document_id
  // in-process. Could be a SQL view; not worth it yet — N receipts per
  // inventory item is small.
  const receiptRows = (receiptsResult.data ?? []) as Array<{
    id: string;
    thumbnail_path: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  const receiptIds = receiptRows.map((r) => r.id);
  const pageCountByDocumentId = new Map<string, number>();
  if (receiptIds.length > 0) {
    const { data: pageRows } = await supabase
      .from("document_pages")
      .select("document_id")
      .in("document_id", receiptIds);
    for (const p of (pageRows ?? []) as { document_id: string }[]) {
      pageCountByDocumentId.set(
        p.document_id,
        (pageCountByDocumentId.get(p.document_id) ?? 0) + 1,
      );
    }
  }

  const receipts: InventoryReceipt[] = receiptRows.map((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const total =
      typeof md.total_cents === "number"
        ? md.total_cents
        : null;
    // Page 1 is implicit on the parent row, document_pages holds 2+,
    // so the visible page count is 1 + N.
    const extra = pageCountByDocumentId.get(r.id) ?? 0;
    return {
      id: r.id,
      thumbnailPath: r.thumbnail_path,
      createdAt: r.created_at,
      vendorName:
        typeof md.vendor_name === "string" && md.vendor_name.length > 0
          ? md.vendor_name
          : null,
      transactionDate:
        typeof md.transaction_date === "string" && md.transaction_date.length > 0
          ? md.transaction_date
          : null,
      totalCents: total,
      currency:
        typeof md.currency === "string" && md.currency.length > 0
          ? md.currency
          : null,
      transactionType:
        typeof md.transaction_type === "string"
          ? md.transaction_type
          : null,
      pageCount: 1 + extra,
      metadata: parseReceiptMetadata(r.metadata),
    };
  });

  // Build the history event list — completed maintenance tasks + the
  // installed_on / purchased_on milestones, sorted by date descending.
  // Trivial enough to inline; if the slate of milestone kinds grows
  // (last_serviced_on, warranty registration, etc.) it'll earn a helper.
  const completedTaskRows = (completedTasksResult.data ?? []) as Array<{
    id: string;
    title: string;
    subtitle: string | null;
    kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
    completed_at: string;
    completion_notes: string | null;
  }>;
  const historyEvents: HistoryEvent[] = [];
  for (const t of completedTaskRows) {
    historyEvents.push({
      id: `task:${t.id}`,
      kind: "completed_task",
      taskKind: t.kind,
      date: t.completed_at,
      title: t.title,
      detail: t.completion_notes ?? t.subtitle,
    });
  }
  if (row.installed_on) {
    historyEvents.push({
      id: "milestone:installed",
      kind: "milestone",
      date: row.installed_on,
      title: "Installed",
    });
  }
  if (row.purchased_on) {
    historyEvents.push({
      id: "milestone:purchased",
      kind: "milestone",
      date: row.purchased_on,
      title: "Purchased",
    });
  }
  historyEvents.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Discriminator for the maintenance panel's item-scoped empty state.
  // `ai_insights.maintenance` populated → "build a plan" CTA; missing →
  // "run Research first" message.
  const insights = row.ai_insights;
  const hasActionableInsights = !!(
    insights &&
    typeof insights === "object" &&
    "maintenance" in insights &&
    typeof (insights as { maintenance?: unknown }).maintenance === "string" &&
    ((insights as { maintenance?: string }).maintenance ?? "").length > 0
  );

  // First-research coachmark eligibility (issue #262): true when this item has
  // no ai_insights AND no item in the house has been researched yet. The view
  // applies the remaining surface gates (property has no Research; an item with
  // no manufacturer/model can't be researched) before actually showing it.
  const isFirstUnresearchedItem = deriveIsFirstUnresearchedItem({
    itemHasInsights: !!insights,
    houseHasResearchedItem: (researchedCountResult.count ?? 0) > 0,
  });

  const detail: InventoryDetailItem = {
    id: row.id,
    house_id: row.house_id,
    room_id: row.room_id,
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    manufacturer: row.manufacturer,
    model_number: row.model_number,
    serial_number: row.serial_number,
    installed_on: row.installed_on,
    last_serviced_on: row.last_serviced_on,
    next_service_due_on: row.next_service_due_on,
    purchased_on: row.purchased_on,
    estimated_value_cents: row.estimated_value_cents,
    metadata: row.metadata ?? {},
    notes: row.notes,
    roomName,
    photos,
    ai_pills: row.ai_pills,
    ai_insights: row.ai_insights,
    manufacture_date: row.manufacture_date,
    manufacture_date_precision: row.manufacture_date_precision,
    manufacture_date_confidence: row.manufacture_date_confidence,
    hero_document_id: row.hero_document_id,
    last_synthesis_run: row.last_synthesis_run,
    is_house: row.is_house,
  };

  return (
    <InventoryDetailView
      item={detail}
      rooms={roomOptions}
      linkedDocumentCount={linkedDocumentCount}
      receipts={receipts}
      renewalDocuments={renewalDocuments}
      historyEvents={historyEvents}
      isFirstUnresearchedItem={isFirstUnresearchedItem}
      maintenancePanelSlot={
        // The house item has no maintenance synthesis (issue #306) — it's
        // a document home, not a serviceable thing — so it gets no panel.
        row.is_house ? null : (
          <MaintenancePanelItem
            inventoryId={detail.id}
            hasActionableInsights={hasActionableInsights}
            itemType={detail.type}
            itemSubtype={detail.subtype}
          />
        )
      }
    />
  );
}
