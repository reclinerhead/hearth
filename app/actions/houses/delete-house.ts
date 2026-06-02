"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  documentDirectoryPath,
  HEARTH_DOCUMENTS_BUCKET,
} from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action behind the danger-zone "Delete this property" flow
 * (issue #110). Backs the address-typing confirmation modal inside the
 * Property Details edit modal.
 *
 * Most of the cascade is owned by the database via existing
 * `ON DELETE CASCADE` foreign keys on `hearth.rooms`, `hearth.inventory`,
 * `hearth.documents`, and `hearth.habitat_findings`. Day One Briefing
 * lifecycle data lives on `hearth.houses` itself so it disappears with
 * the row. Two things don't cascade and the action handles them
 * explicitly:
 *
 *   1. Storage objects in the `hearth-documents` bucket — Supabase
 *      storage isn't tied to the DB row, so the document rows being
 *      cascade-deleted doesn't remove their bytes. We collect the doc
 *      ids BEFORE the cascade fires (RLS-scoped), then best-effort
 *      `storage.remove(paths)` after the row delete succeeds. Same
 *      trade-off as `deleteInventoryItemAction`: orphaned bytes from a
 *      transient storage failure are deferred to a future periodic
 *      sweep rather than blocking the delete.
 *
 *   2. `public.profiles.active_house_id` reassignment — the FK is
 *      declared `on delete set null` (a safety net to prevent FK
 *      violations), but the *primary* behavior we want when deleting
 *      the active house is to explicitly move the user to their next
 *      property so cross-device state stays consistent and post-delete
 *      navigation doesn't depend on whatever the resolver's fallback
 *      rule happens to be. If the user is deleting a non-active
 *      property, no profile write happens. If they're deleting their
 *      only property, we leave the column alone and let the FK cascade
 *      null it out — the layout's onboarding gate catches the
 *      zero-house state on the next request and bounces to /onboarding.
 *
 * Authorization is RLS-scoped: every SELECT/DELETE here is bound to
 * `owner_id = auth.uid()` on `hearth.houses`, so the action doesn't
 * re-check ownership itself. A bad id or someone else's property
 * surfaces as "Property not found" via the missing-row branch.
 */

export type DeleteHouseResult = { ok: true } | { ok: false; error: string };

export async function deleteHouseAction(
  houseId: string,
): Promise<DeleteHouseResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to do that." };
  }

  // Confirm the property exists and the user owns it. RLS scopes the
  // read to their houses, so a missing row here means a bad id or
  // someone else's. We need the id either way; the SELECT also acts
  // as the authorization check.
  const { data: house, error: loadError } = await supabase
    .from("houses")
    .select("id")
    .eq("id", houseId)
    .maybeSingle();

  if (loadError) {
    console.error("deleteHouseAction load failed", loadError);
    return { ok: false, error: "We couldn't load that property. Try again." };
  }
  if (!house?.id) {
    return { ok: false, error: "We couldn't find that property." };
  }

  // Read the user's profile to know whether the property being
  // deleted is the active one. `active_house_id` is the only column
  // the user can mutate from the browser today (see "Capability gate"
  // in TechnicalGuide.md) — we use it both for the reassignment
  // decision below and to know whether a profile write is required.
  const { data: profile, error: profileError } = await supabase
    .schema("public")
    .from("profiles")
    .select("active_house_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("deleteHouseAction profile load failed", profileError);
    return { ok: false, error: "We couldn't load your profile. Try again." };
  }

  const isActiveHouse = profile?.active_house_id === houseId;

  // If they're deleting their active property, pre-pick the next one
  // they own (ordered by created_at desc, excluding the one being
  // deleted) and write it to profiles.active_house_id BEFORE the
  // house row goes away. This keeps the column semantically meaningful
  // — when the next request lands on the layout, the resolver sees an
  // explicitly-chosen active house rather than the null the FK cascade
  // would have left behind. When the deleted house is the user's only
  // property, we leave the column alone and let the FK cascade null it.
  if (isActiveHouse) {
    const { data: nextHouse, error: nextError } = await supabase
      .from("houses")
      .select("id")
      .neq("id", houseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (nextError) {
      console.error("deleteHouseAction next-house lookup failed", nextError);
      return {
        ok: false,
        error: "We couldn't pick your next property. Try again.",
      };
    }

    if (nextHouse?.id) {
      const { error: updateError } = await supabase
        .schema("public")
        .from("profiles")
        .update({ active_house_id: nextHouse.id })
        .eq("id", user.id);

      if (updateError) {
        console.error(
          "deleteHouseAction active_house_id reassignment failed",
          updateError,
        );
        return {
          ok: false,
          error: "We couldn't switch to your next property. Try again.",
        };
      }
    }
  }

  // Collect every document id for the house BEFORE the cascade fires —
  // once the houses row is deleted, the documents rows are gone too
  // and we'd have no way to compute their storage paths. RLS scopes
  // this read through `hearth.documents.house_id` → houses.owner_id.
  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id")
    .eq("house_id", houseId);

  if (docsError) {
    console.error("deleteHouseAction docs load failed", docsError);
    return {
      ok: false,
      error: "We couldn't load this property's documents. Try again.",
    };
  }

  const documentIds = (docs ?? []).map((d) => d.id);

  // Authoritative delete. The cascading FKs on rooms / inventory /
  // documents / habitat_findings fire as part of the same transaction.
  const { error: deleteError } = await supabase
    .from("houses")
    .delete()
    .eq("id", houseId);

  if (deleteError) {
    console.error("deleteHouseAction delete failed", deleteError);
    return {
      ok: false,
      error: "We couldn't delete this property. Try again.",
    };
  }

  // Best-effort storage cleanup AFTER the row delete succeeds. A
  // storage hiccup here doesn't undo the delete; orphaned bytes get
  // picked up by a future periodic sweep, matching the trade-off in
  // `cleanupDocumentAction` and `deleteInventoryItemAction`. Sweep each
  // document's directory rather than enumerating optimized.jpg /
  // thumb.jpg — a multi-page receipt also has page-{N}-*.jpg objects
  // that filename enumeration would leave orphaned. The storage objects
  // survive the row cascade (storage isn't tied to the DB rows), so the
  // directory listing still works after the houses row is gone.
  if (documentIds.length > 0) {
    try {
      await Promise.all(
        documentIds.map(async (documentId) => {
          const directory = documentDirectoryPath({ houseId, documentId });
          const { data: files } = await supabase.storage
            .from(HEARTH_DOCUMENTS_BUCKET)
            .list(directory);
          if (files && files.length > 0) {
            await supabase.storage
              .from(HEARTH_DOCUMENTS_BUCKET)
              .remove(files.map((f) => `${directory}/${f.name}`));
          }
        }),
      );
    } catch (err) {
      console.warn("deleteHouseAction storage cleanup failed", err);
    }
  }

  // Layout-wide revalidation so the property switcher's house list,
  // the active-house resolver, and any downstream server components
  // all see the new state. revalidatePath("/", "layout") is the
  // documented pattern for invalidating the whole tree (matches
  // setActiveHouseAction's revalidation).
  revalidatePath("/", "layout");

  // redirect throws NEXT_REDIRECT — function never returns past this
  // point. The resolver picks up the explicitly-reassigned next house
  // (or the layout's onboarding gate catches the zero-house case and
  // bounces to /onboarding).
  redirect("/dashboard");
}
