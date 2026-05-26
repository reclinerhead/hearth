import {
  EMERGENCY_CATEGORY_META,
  EMERGENCY_CATEGORY_ORDER,
} from "@/lib/documents/emergency-categories";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, EmergencyCategory } from "@/types/document";
import {
  EmergencyReferencePanelClient,
  type EmergencyReferenceCategoryGroup,
  type EmergencyVideoSummary,
} from "./emergency-reference-panel.client";

/**
 * Server component for the dashboard's Emergency reference panel
 * (issue #139). Loads every emergency-procedure-video row for the
 * active house, groups them by category, and hands the result to
 * the client panel for icon-dominant tile rendering + modal
 * interactivity.
 *
 * Returns null when no videos exist *and* this is the user's first
 * dashboard visit — caller renders the zero-state surface (the
 * EMERGENCIES placeholder grid) instead. Today the panel always
 * renders because we replace that placeholder unconditionally — the
 * zero-state is the four "Add a {category} video" affordances.
 */
export async function EmergencyReferencePanel({
  houseId,
}: {
  houseId: string;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, house_id, kind, emergency_category, emergency_label, emergency_is_primary, storage_path, poster_storage_path, duration_seconds, mime_type, notes, created_at",
    )
    .eq("house_id", houseId)
    .eq("kind", "emergency_procedure_video")
    .order("emergency_is_primary", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    // Surface the error loud-and-clear rather than rendering a silent
    // zero state — RLS misconfig, schema drift, or transient outages
    // should be visible during this pre-release period. See
    // feedback_surface_loader_errors memory.
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-md)] p-3 text-small"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
          border: "1px solid var(--color-border-subtle)",
          color: "var(--color-text-primary)",
        }}
      >
        Couldn&apos;t load your emergency videos: {error.message}
      </div>
    );
  }

  const rows = (data ?? []) as Pick<
    DocumentRow,
    | "id"
    | "house_id"
    | "kind"
    | "emergency_category"
    | "emergency_label"
    | "emergency_is_primary"
    | "storage_path"
    | "poster_storage_path"
    | "duration_seconds"
    | "mime_type"
    | "notes"
    | "created_at"
  >[];

  // Group by category. The ORDER BY above guarantees primary lands
  // at index 0 within each category, and the secondaries follow in
  // newest-first order. We materialize one EmergencyReferenceCategoryGroup
  // per category in the panel's fixed order, including empty groups
  // (which render the "Add a video" affordance row).
  const byCategory = new Map<EmergencyCategory, EmergencyVideoSummary[]>();
  for (const cat of EMERGENCY_CATEGORY_ORDER) byCategory.set(cat, []);
  for (const row of rows) {
    const cat = row.emergency_category;
    if (!cat) continue;
    const list = byCategory.get(cat as EmergencyCategory);
    if (!list) continue;
    list.push({
      id: row.id,
      label: row.emergency_label,
      isPrimary: Boolean(row.emergency_is_primary),
      storagePath: row.storage_path,
      posterStoragePath: row.poster_storage_path,
      mimeType: row.mime_type,
      durationSeconds: row.duration_seconds,
      notes: row.notes,
      createdAt: row.created_at,
    });
  }

  const groups: EmergencyReferenceCategoryGroup[] =
    EMERGENCY_CATEGORY_ORDER.map((category) => ({
      category,
      meta: EMERGENCY_CATEGORY_META[category],
      videos: byCategory.get(category) ?? [],
    }));

  return <EmergencyReferencePanelClient houseId={houseId} groups={groups} />;
}
