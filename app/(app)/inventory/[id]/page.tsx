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
import { createClient } from "@/lib/supabase/server";
import { InventoryDetailView } from "./inventory-detail-view";

type InventoryType = "appliance" | "system" | "exterior";

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
  storagePath: string;
  thumbnailPath: string;
};

export type InventoryDetailItem = {
  id: string;
  house_id: string;
  room_id: string;
  name: string;
  type: InventoryType;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_on: string | null;
  last_serviced_on: string | null;
  next_service_due_on: string | null;
  notes: string | null;
  roomName: string;
  // Every attached photo for this item, most-recent first. Empty for
  // items with no photos yet. The hero uses photos[0]'s thumbnail; the
  // lightbox steps through all of them at full resolution.
  photos: InventoryPhoto[];
  ai_pills: { label: string; value: string }[] | null;
  ai_insights: InventoryInsights | null;
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
      manufacturer,
      model_number,
      serial_number,
      installed_on,
      last_serviced_on,
      next_service_due_on,
      notes,
      ai_pills,
      ai_insights,
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
    manufacturer: string | null;
    model_number: string | null;
    serial_number: string | null;
    installed_on: string | null;
    last_serviced_on: string | null;
    next_service_due_on: string | null;
    notes: string | null;
    ai_pills: { label: string; value: string }[] | null;
    ai_insights: InventoryInsights | null;
    room: { name: string } | { name: string }[] | null;
  };

  const roomEntry = Array.isArray(row.room) ? row.room[0] : row.room;
  const roomName = roomEntry?.name ?? "Unknown";

  // Three independent follow-up queries against the same Supabase
  // connection. All three only need `row.house_id` / `row.id`, which we
  // already have, so we run them in parallel rather than paying for
  // three sequential round-trips on the user-visible first paint:
  //   - rooms list powers the "Room" select in the edit modal
  //   - document count drives the delete-confirm "Also delete N linked
  //     documents" copy (actual deletion still walks the rows server-side)
  //   - every attached photo for the item (`kind` filtered to actual
  //     photos so receipts / manuals stay out), ordered by analyzed_at
  //     desc with created_at as the tiebreaker. photos[0] is the hero;
  //     the full set feeds the click-to-expand lightbox.
  const [roomsResult, docCountResult, heroDocsResult] = await Promise.all([
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
      .select("storage_path, thumbnail_path")
      .eq("inventory_id", row.id)
      .eq("status", "attached")
      .in("kind", ["nameplate", "photo"])
      .order("analyzed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  const roomOptions: RoomOption[] = (roomsResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));

  const linkedDocumentCount = docCountResult.count ?? 0;

  // Every attached photo for the item, most-recent first. The detail
  // view's hero uses photos[0].thumbnailPath (600px is plenty for the
  // 260px slot, well above 2x DPR); the lightbox steps through all
  // photos at storagePath (1920px) on user click. Both URL sources
  // are signed client-side via the shared sessionStorage-cached
  // helper — see "Signed URL caching" in the Technical Guide.
  const photos: InventoryPhoto[] = (heroDocsResult.data ?? [])
    .filter(
      (d): d is { storage_path: string; thumbnail_path: string } =>
        typeof d.storage_path === "string" &&
        typeof d.thumbnail_path === "string",
    )
    .map((d) => ({
      storagePath: d.storage_path,
      thumbnailPath: d.thumbnail_path,
    }));

  const detail: InventoryDetailItem = {
    id: row.id,
    house_id: row.house_id,
    room_id: row.room_id,
    name: row.name,
    type: row.type,
    manufacturer: row.manufacturer,
    model_number: row.model_number,
    serial_number: row.serial_number,
    installed_on: row.installed_on,
    last_serviced_on: row.last_serviced_on,
    next_service_due_on: row.next_service_due_on,
    notes: row.notes,
    roomName,
    photos,
    ai_pills: row.ai_pills,
    ai_insights: row.ai_insights,
  };

  return (
    <InventoryDetailView
      item={detail}
      rooms={roomOptions}
      linkedDocumentCount={linkedDocumentCount}
    />
  );
}
