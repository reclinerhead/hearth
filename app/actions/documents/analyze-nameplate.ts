"use server";

import { createClient } from "@/lib/supabase/server";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { classifyImage, deltaImage } from "@/lib/documents/ai/analyze";
import type { AiExtraction, DocumentRow } from "@/types/document";

export type AnalyzeNameplateInput = {
  documentId: string;
  /**
   * When provided, the call runs in delta mode against the existing
   * inventory row's data. Omitted from the dashboard's "new document"
   * flow; supplied by the per-inventory "add another angle" flow that
   * lands in a later phase.
   */
  existingInventoryData?: Record<string, unknown>;
};

// Five minutes is generous for a single AI call but short enough that a
// signed URL leaking into a log is low risk.
const SIGNED_URL_TTL_SECONDS = 60 * 5;

/**
 * Fetches the document's optimized image via a signed storage URL, runs
 * the appropriate Grok call (classify or delta), persists the result
 * back to the document row, and returns the updated row.
 *
 * On any AI failure the row flips to status='failed' and the action
 * returns the error message — the modal in phase 1.4 surfaces this as
 * the "couldn't read that, try again?" branch.
 *
 * The document row's `kind` may be demoted from "nameplate" to "photo"
 * when classification returns "appliance_photo".
 */
export async function analyzeNameplateAction(
  input: AnalyzeNameplateInput,
): Promise<
  | { data: DocumentRow; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  // Load the document row to learn its storage path. RLS scopes the
  // SELECT to houses the caller owns, so a missing row from the user's
  // POV means either a bad id or someone else's document.
  const { data: doc, error: loadError } = await supabase
    .from("documents")
    .select("*")
    .eq("id", input.documentId)
    .single();

  if (loadError || !doc) {
    return {
      data: null,
      error: loadError?.message ?? "Document not found",
    };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(HEARTH_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return {
      data: null,
      error: signError?.message ?? "Could not sign storage URL",
    };
  }

  let aiExtraction: AiExtraction;
  let aiConfidence: number | null;
  let nextKind: DocumentRow["kind"] = doc.kind as DocumentRow["kind"];

  try {
    if (input.existingInventoryData) {
      const result = await deltaImage({
        imageUrl: signed.signedUrl,
        existingInventoryData: input.existingInventoryData,
      });
      aiExtraction = {
        mode: "delta",
        deltas: result.deltas,
        confidence: result.confidence,
      };
      aiConfidence = result.confidence;
    } else {
      const result = await classifyImage({ imageUrl: signed.signedUrl });

      if (result.photo_kind === "nameplate") {
        aiExtraction = {
          mode: "classification",
          photo_kind: "nameplate",
          classification: result.classification,
          extracted: result.extracted,
          room_suggestion: result.room_suggestion,
        };
        aiConfidence = result.classification.confidence;
      } else if (result.photo_kind === "appliance_photo") {
        aiExtraction = {
          mode: "classification",
          photo_kind: "appliance_photo",
          classification: result.classification,
          extracted: null,
          room_suggestion: result.room_suggestion,
        };
        aiConfidence = result.classification.confidence;
        // Demote kind: a row inserted as `nameplate` that the model
        // judges to be a generic equipment photo becomes a `photo`.
        // Rows already inserted as `photo` (the dashboard's generic
        // entry point) stay where they are.
        if (nextKind === "nameplate") nextKind = "photo";
      } else {
        aiExtraction = {
          mode: "classification",
          photo_kind: "not_useful",
          classification: null,
          extracted: null,
          room_suggestion: null,
        };
        // not_useful — confidence is zero by convention; the caller
        // will likely cleanup this document.
        aiConfidence = 0;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyze call failed";
    await supabase
      .from("documents")
      .update({ status: "failed" })
      .eq("id", input.documentId);
    return { data: null, error: message };
  }

  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({
      ai_extraction: aiExtraction,
      ai_model: process.env.NAMEPLATE_PRIMARY_MODEL ?? null,
      ai_confidence: aiConfidence,
      analyzed_at: new Date().toISOString(),
      status: "analyzed",
      kind: nextKind,
    })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return {
      data: null,
      error: updateError?.message ?? "Failed to persist analysis",
    };
  }

  return { data: updated as DocumentRow, error: null };
}
