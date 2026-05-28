"use server";

import { createClient } from "@/lib/supabase/server";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { analyzeCcrPdf } from "@/lib/documents/ai/analyze";
import type { CcrExtraction, DocumentRow } from "@/types/document";

/**
 * Sign-URL TTL for the multi-page extraction call. CCRs are typically
 * 4-12 pages; the model call runs across all pages in a single
 * generateObject, so the URLs stay live for the duration of that call.
 * Same TTL as the receipt action.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 5;

export type AnalyzeCcrInput = {
  /** The hearth.documents row holding the CCR upload. Must have kind='water_quality_report'. */
  documentId: string;
  /**
   * PWSID of the utility this CCR is supposed to describe. Resolved
   * by the Smart Uploader from the house's habitat_findings row, OR
   * — for the `cws_unmapped` flow — picked by the user from a
   * utility-name search. Threaded into the prompt so the model can
   * cross-check what the document prints against what we expect.
   */
  pwsid: string;
  /**
   * Display name of the utility, as resolved by Smart Uploader from
   * WQA-1's `water_systems.pws_name`. Optional — the model handles
   * a null gracefully via the prompt's "(unknown)" fallback.
   */
  expectedUtilityName?: string | null;
  /**
   * A short paragraph summarizing what Hearth already knows about the
   * utility (system type, source water, population). Used as
   * grounding context in the user prompt. The user-prompt builder
   * omits the block entirely when null.
   */
  knownSystemContext?: string | null;
};

/**
 * Run the CCR extraction model against a multi-page document upload
 * and persist the raw extraction onto `hearth.documents.ai_extraction`.
 *
 * Issue #176 (WQA-3). The action is intentionally narrow:
 *
 *   * Loads page 1 (parent row) + pages 2+ (document_pages) in order.
 *   * Signs every page's storage path for the AI Gateway call.
 *   * Calls `analyzeCcrPdf` with the PWSID + utility context as the
 *     user-prompt grounding.
 *   * Persists `ai_extraction = { mode: 'ccr', extracted, ... }` with
 *     `report_id` and `dedup_reason` left null — the finalize action
 *     populates those once the shared-cache dedup decision lands.
 *   * Flips `status` from 'analyzing' to 'analyzed'.
 *   * Returns the raw extraction so the caller (the Smart Uploader
 *     hook) can pivot the UI without an extra round-trip.
 *
 * Soft-fail discipline: any error in the model call flips the row to
 * 'failed' and surfaces the error message to the caller. The captured
 * pages stay intact in storage so the user can retry without
 * re-uploading.
 *
 * RLS scopes the SELECT/UPDATE on `documents` and the SELECT on
 * `document_pages` through house ownership.
 */
export async function analyzeCcrAction(
  input: AnalyzeCcrInput,
): Promise<
  | { data: { document: DocumentRow; extraction: CcrExtraction }; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

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

  if (doc.kind !== "water_quality_report") {
    return {
      data: null,
      error: `analyzeCcrAction: document.kind is '${doc.kind}', expected 'water_quality_report'`,
    };
  }

  const { data: extraPages, error: pagesError } = await supabase
    .from("document_pages")
    .select("page_number, storage_path")
    .eq("document_id", input.documentId)
    .order("page_number", { ascending: true });

  if (pagesError) {
    return { data: null, error: pagesError.message };
  }

  const orderedPaths = [
    doc.storage_path,
    ...((extraPages ?? []) as { page_number: number; storage_path: string }[])
      .map((p) => p.storage_path),
  ];

  const { data: signed, error: signError } = await supabase.storage
    .from(HEARTH_DOCUMENTS_BUCKET)
    .createSignedUrls(orderedPaths, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return {
      data: null,
      error: signError?.message ?? "Could not sign storage URLs",
    };
  }

  const pageUrls: string[] = [];
  for (const entry of signed) {
    if (entry.error || !entry.signedUrl) {
      return {
        data: null,
        error: entry.error ?? "Missing signed URL for a page",
      };
    }
    pageUrls.push(entry.signedUrl);
  }

  let extracted;
  try {
    extracted = await analyzeCcrPdf({
      pageUrls,
      context: {
        expected_pwsid: input.pwsid,
        expected_utility_name: input.expectedUtilityName ?? null,
        known_system_context: input.knownSystemContext ?? null,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyze call failed";
    await supabase
      .from("documents")
      .update({ status: "failed" })
      .eq("id", input.documentId);
    return { data: null, error: message };
  }

  // Read the coverage year off the extracted header metadata. The
  // finalize step uses this to look up the (PWSID, year, edition)
  // row in water_system_reports. Null when the model couldn't read
  // the year cleanly; finalize then falls back to the publication
  // date or surfaces an error.
  const reportYear = extracted.header_metadata?.report_year ?? null;

  const extraction: CcrExtraction = {
    mode: "ccr",
    report_id: null,
    pwsid: input.pwsid,
    report_year: reportYear,
    dedup_reason: null,
    extracted,
  };

  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({
      ai_extraction: extraction,
      ai_model: process.env.NAMEPLATE_PRIMARY_MODEL ?? null,
      ai_confidence: extracted.ai_confidence,
      analyzed_at: new Date().toISOString(),
      status: "analyzed",
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

  return {
    data: { document: updated as DocumentRow, extraction },
    error: null,
  };
}
