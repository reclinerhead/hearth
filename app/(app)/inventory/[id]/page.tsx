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
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/server";
import { InventoryDetailView } from "./inventory-detail-view";

const HERO_SIGNED_URL_TTL_SECONDS = 60 * 60;

type InventoryType = "appliance" | "system" | "exterior";

export type InventoryInsights = {
  headline: string;
  body: string;
  source_urls: string[];
  found_specific_model: boolean;
  generated_at: string;
  model_used: string | null;
};

export type InventoryDetailItem = {
  id: string;
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
  heroSignedUrl: string | null;
  ai_pills: { label: string; value: string }[] | null;
  ai_insights: InventoryInsights | null;
};

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

  // Most-recent attached document for the hero photo. Matches the
  // dashboard's inventory-preview pattern: "attached" status, ordered by
  // analyzed_at desc with created_at as the tiebreaker, take the top one.
  const { data: heroDocs } = await supabase
    .from("documents")
    .select("storage_path, thumbnail_path")
    .eq("inventory_id", row.id)
    .eq("status", "attached")
    .order("analyzed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const heroDoc = heroDocs?.[0] ?? null;
  let heroSignedUrl: string | null = null;
  if (heroDoc) {
    // The detail page's hero is larger than the dashboard's 48px tile,
    // so prefer the optimized 1920px version when available and fall
    // back to the thumbnail if not.
    const path = heroDoc.storage_path ?? heroDoc.thumbnail_path;
    if (path) {
      const { data: signed } = await supabase.storage
        .from(HEARTH_DOCUMENTS_BUCKET)
        .createSignedUrl(path, HERO_SIGNED_URL_TTL_SECONDS);
      heroSignedUrl = signed?.signedUrl ?? null;
    }
  }

  const detail: InventoryDetailItem = {
    id: row.id,
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
    heroSignedUrl,
    ai_pills: row.ai_pills,
    ai_insights: row.ai_insights,
  };

  return <InventoryDetailView item={detail} />;
}
