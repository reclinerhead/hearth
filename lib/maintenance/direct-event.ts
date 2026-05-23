// Direct-event maintenance pipeline (issue #131).
//
// Reads an attached document and — when the document carries an
// expiration date — creates a renewal task in hearth.maintenance_tasks.
// If a prior open renewal already exists for the same inventory item,
// closes it (with completion linked back to the new document) and
// chains the new task via predecessor_task_id.
//
// Deterministic, no LLM. Runs inside the same server-action request
// lifecycle that wrote `documents.inventory_id` + flipped status to
// 'attached'. The save-receipt action awaits the result so phase 7's
// toast can later be assembled from the {created, closed} return value
// without re-querying.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  classifyGenericRenewal,
  classifyRenewalDocument,
  renderSubtitle,
  type RenewalDocumentClassification,
} from "./renewal-terms";
import type { TaskReasoning } from "./types";
import type { EquipmentType, InventorySubtype } from "@/types/document";

// SupabaseClient generics are invariant; the hearth client is pinned
// to schema "hearth" which defeats the bare `SupabaseClient` annotation.
// Same `AnySupabaseClient` shape as `lib/houses/active-house.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

export type ProcessDirectEventResult = {
  created_task_id: string | null;
  closed_task_id: string | null;
};

type DocumentRow = {
  id: string;
  house_id: string;
  inventory_id: string | null;
  kind: string;
  metadata: Record<string, unknown> | null;
  status: string;
};

type InventoryRow = {
  id: string;
  name: string;
  type: EquipmentType;
  subtype: InventorySubtype | null;
  house_id: string;
};

type HouseRow = {
  id: string;
  state: string | null;
};

/**
 * Pipeline entry point. Called after a document is attached to
 * inventory with status='attached'. Returns the created task's id (and
 * the closed prior task's id, when one was chained) so the caller can
 * surface a precise toast.
 *
 * Uses a service-role client by default because the work spans
 * documents -> inventory -> houses -> maintenance_tasks and the attach
 * action that triggered us has already RLS-verified ownership. Tests
 * pass an injected client to drive a Supabase mock.
 */
export async function processDirectEventTaskFromDocument(
  documentId: string,
  supabaseOverride?: AnySupabaseClient,
): Promise<ProcessDirectEventResult> {
  const supabase = supabaseOverride ?? createServiceClient();
  const empty: ProcessDirectEventResult = {
    created_task_id: null,
    closed_task_id: null,
  };

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, house_id, inventory_id, kind, metadata, status")
    .eq("id", documentId)
    .single();

  if (docError || !doc) return empty;
  const document = doc as DocumentRow;

  // Gate 1: receipts are the only kind that carries metadata.expiration_date today.
  if (document.kind !== "receipt") return empty;

  const expirationDate = extractExpirationDate(document.metadata);
  if (!expirationDate) return empty;

  // Gate 2: must be attached to an inventory item. Documents that were
  // uploaded but never confirmed against an inventory match skip task
  // creation — we shouldn't guess.
  if (!document.inventory_id) return empty;
  if (document.status !== "attached") return empty;

  const [{ data: inv }, { data: house }] = await Promise.all([
    supabase
      .from("inventory")
      .select("id, name, type, subtype, house_id")
      .eq("id", document.inventory_id)
      .single(),
    supabase
      .from("houses")
      .select("id, state")
      .eq("id", document.house_id)
      .single(),
  ]);

  if (!inv || !house) return empty;
  const inventory = inv as InventoryRow;
  const houseRow = house as HouseRow;

  const vendor_name = extractVendorName(document.metadata);
  const classifierInput = {
    vendor_name,
    inventory_type: inventory.type,
    inventory_subtype: inventory.subtype,
    inventory_state: houseRow.state,
  };
  const classification: RenewalDocumentClassification =
    classifyRenewalDocument(classifierInput) ??
    classifyGenericRenewal(classifierInput);

  // Idempotency: close any existing open renewal task on the *same
  // renewal stream* for this inventory item before inserting the new
  // one. "Same stream" is the classifier-produced title — a vehicle has
  // independent registration and insurance streams that share
  // kind='renewal' but should never close each other. Scoping the
  // lookup to `title = classification.task_title` keeps them separate
  // while still chaining a re-upload of the same kind of document to
  // its predecessor for phase 7's toast.
  //
  // The generic fallback ("Renewal") is the one stream where unrelated
  // documents could still collide; that's a known limitation of the
  // catch-all branch — a user uploading two unrelated generic-renewal
  // receipts will see one chain to the other. The fix is for those
  // issuers to earn their own classifier, not to add another column.
  const { data: existingOpen } = await supabase
    .from("maintenance_tasks")
    .select("id")
    .eq("inventory_id", inventory.id)
    .eq("kind", "renewal")
    .eq("title", classification.task_title)
    .eq("status", "open")
    .maybeSingle();

  let closed_task_id: string | null = null;
  if (existingOpen?.id) {
    const { error: closeError } = await supabase
      .from("maintenance_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by_document_id: document.id,
        completion_notes: "Renewed via document upload",
      })
      .eq("id", existingOpen.id);
    if (closeError) {
      // A failed close short-circuits the insert — proceeding would
      // create the duplicate the idempotency check exists to prevent.
      // Caller can retry the attach flow to re-enter cleanly.
      return empty;
    }
    closed_task_id = existingOpen.id as string;
  }

  const cadence =
    classification.renewal_options.length > 0
      ? {
          cadence_kind: "interval" as const,
          // Longest available term is the recurrence pattern between
          // user-driven completions. Phase 6's mark-renewed sheet
          // overrides per-occurrence when the user picks a shorter term.
          cadence_interval_months: Math.max(
            ...classification.renewal_options.map((o) => o.interval_months),
          ),
          cadence_seasonal_anchor: null,
        }
      : {
          cadence_kind: "one_time" as const,
          cadence_interval_months: null,
          cadence_seasonal_anchor: null,
        };

  const reasoning: TaskReasoning = {
    source_kind: "document_expiration",
    cadence_basis: `Expiration date extracted from ${vendor_name ?? "uploaded document"}.`,
    modifiers: [],
    anchor: {
      kind: "document_expiration",
      detail: `Expires ${expirationDate}`,
      document_id: document.id,
    },
  };

  const subtitle = renderSubtitle(classification.task_subtitle_template, {
    vendor_name,
    inventory_name: inventory.name,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("maintenance_tasks")
    .insert({
      house_id: document.house_id,
      inventory_id: inventory.id,
      source: "direct_event",
      kind: "renewal",
      title: classification.task_title,
      subtitle: subtitle.length > 0 ? subtitle : null,
      next_due_at: expirationDate,
      status: "open",
      cadence_kind: cadence.cadence_kind,
      cadence_interval_months: cadence.cadence_interval_months,
      cadence_seasonal_anchor: cadence.cadence_seasonal_anchor,
      renewal_options:
        classification.renewal_options.length > 0
          ? classification.renewal_options
          : null,
      // Persist the per-issuer renewal URL alongside the row (issue
      // #137) so the task detail modal's "Renew now" link can render
      // straight off the task without re-running the classifier. Null
      // for issuers that don't have a portal (most insurance carriers).
      renewal_url: classification.renewal_url_template,
      reasoning,
      predecessor_task_id: closed_task_id,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error(
      "[direct-event] failed to insert renewal task after closing prior:",
      insertError?.message,
    );
    return { created_task_id: null, closed_task_id };
  }

  return { created_task_id: inserted.id as string, closed_task_id };
}

function extractExpirationDate(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).expiration_date;
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function extractVendorName(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).vendor_name;
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}
