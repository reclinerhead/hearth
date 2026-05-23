"use server";

import { createClient } from "@/lib/supabase/server";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { analyzeReceipt } from "@/lib/documents/ai/analyze";
import { parseReceiptMetadata } from "@/lib/documents/metadata-schemas";
import type { DocumentRow, ReceiptExtraction } from "@/types/document";

export type AnalyzeReceiptInput = {
  documentId: string;
};

// Same TTL as analyzeNameplateAction. Long enough for a multi-page
// Grok call to chew through 1-5 images; short enough that a leaked
// signed URL has narrow blast radius.
const SIGNED_URL_TTL_SECONDS = 60 * 5;

/**
 * Multi-page receipt extraction. Loads the parent document row plus
 * every page-row, signs each storage_path for Grok, runs the
 * receipt-shaped generateObject call once across all pages in order,
 * persists the structured result into both `ai_extraction` (raw model
 * output for provenance) and `metadata` (application-curated shape
 * read by the inventory documents list and the page-flip modal), and
 * flips status to 'analyzed'.
 *
 * On any AI failure the row flips to status='failed' and the action
 * returns the error message — the Smart Uploader surfaces this as the
 * "couldn't read that, try again?" branch with the captured pages
 * still intact so the user can retry without recapture.
 *
 * RLS scopes the document SELECT/UPDATE and the page SELECT through
 * house ownership — no service-role escape hatch.
 */
export async function analyzeReceiptAction(
  input: AnalyzeReceiptInput,
): Promise<
  | { data: DocumentRow; error: null }
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

  // Page 1 lives on the parent row; pages 2+ in document_pages, in
  // ascending order. The order matters — the receipt prompt is told to
  // treat the images as ordered pages, and vendor/total inferences
  // assume "page 1 first."
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

  // Sign all pages up front. createSignedUrls returns one URL per
  // input path, in the same order. Five-minute TTL — plenty for the
  // single multi-image generateObject call, short enough that a leak
  // would have to be caught within the call's lifetime to matter.
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

  let extraction: ReceiptExtraction;
  try {
    const result = await analyzeReceipt({ pageUrls });
    extraction = {
      mode: "receipt",
      vendor_name: result.vendor_name,
      vendor_address: result.vendor_address,
      vendor_phone: result.vendor_phone,
      transaction_date: result.transaction_date,
      transaction_type: result.transaction_type,
      subtotal_cents: result.subtotal_cents,
      tax_cents: result.tax_cents,
      total_cents: result.total_cents,
      currency: result.currency,
      payment_method: result.payment_method,
      line_items: result.line_items,
      referenced_serials: result.referenced_serials,
      referenced_model_numbers: result.referenced_model_numbers,
      notes: result.notes,
      ai_confidence: result.ai_confidence,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analyze call failed";
    await supabase
      .from("documents")
      .update({ status: "failed" })
      .eq("id", input.documentId);
    return { data: null, error: message };
  }

  // Mirror the model output into a parsed metadata shape. parseReceipt
  // Metadata's safeParse + empty-fallback is defensive against schema
  // drift — if the AI SDK ever returns a partial match the renderer
  // never sees an undefined field.
  const metadata = parseReceiptMetadata({
    vendor_name: extraction.vendor_name,
    vendor_address: extraction.vendor_address,
    vendor_phone: extraction.vendor_phone,
    transaction_date: extraction.transaction_date,
    transaction_type: extraction.transaction_type,
    subtotal_cents: extraction.subtotal_cents,
    tax_cents: extraction.tax_cents,
    total_cents: extraction.total_cents,
    currency: extraction.currency,
    payment_method: extraction.payment_method,
    line_items: extraction.line_items,
    referenced_serials: extraction.referenced_serials,
    referenced_model_numbers: extraction.referenced_model_numbers,
    notes: extraction.notes,
  });

  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({
      ai_extraction: extraction,
      ai_model: process.env.NAMEPLATE_PRIMARY_MODEL ?? null,
      ai_confidence: extraction.ai_confidence,
      analyzed_at: new Date().toISOString(),
      status: "analyzed",
      metadata,
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
