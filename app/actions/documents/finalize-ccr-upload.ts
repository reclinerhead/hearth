"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CCR_EXTRACTION_VERSION } from "@/lib/documents/ccr-extraction-version";
import { decideCcrDedupReason } from "@/lib/documents/ccr-dedup";
import type {
  CcrDedupReason,
  CcrExtraction,
  DocumentRow,
} from "@/types/document";

export type FinalizeCcrUploadInput = {
  /**
   * The hearth.documents row to finalize. Must already be
   * status='analyzed' with `ai_extraction.mode = 'ccr'` (the
   * `analyzeCcrAction` step ran successfully).
   */
  documentId: string;
  /**
   * Edition discriminator. Almost every CCR is 'primary'; the
   * Smart Uploader exposes 'supplement' / 'correction' only in the
   * rare cases the user knows the utility republished. Defaults to
   * 'primary'.
   */
  edition?: "primary" | "supplement" | "correction";
  /**
   * Optional override for the coverage year when the user explicitly
   * picks it in the Smart Uploader (e.g. when the model couldn't
   * read the year cleanly). Falls back to `extraction.report_year`.
   */
  reportYearOverride?: number;
};

export type FinalizeCcrUploadResult =
  | {
      data: {
        document: DocumentRow;
        reportId: string;
        dedupReason: CcrDedupReason;
      };
      error: null;
    }
  | { data: null; error: string };

/**
 * Finalize a CCR upload: orchestrate the shared-cache dedup, persist
 * the canonical extraction when needed, record the contributor row,
 * and flip the document to 'attached'.
 *
 * Issue #176 (WQA-3). The dedup decision is two-stage:
 *
 *   1. Byte-identical check — look in
 *      `hearth.water_system_report_contributors` for an existing row
 *      with this document's `content_hash` against any report for
 *      the same PWSID. A hit short-circuits the rest of the action
 *      (no model call, no new contributor row); the existing
 *      extraction is reused.
 *
 *   2. Same-(PWSID, year, edition) check — when no contributor match,
 *      look in `hearth.water_system_reports`. A hit reuses the
 *      existing extraction and adds a contributor row recording this
 *      distinct upload. A miss inserts a new report row with the
 *      analyzed extraction as the canonical one, then records the
 *      first contributor row.
 *
 * Writes go through the service-role client because the shared-cache
 * tables intentionally have no insert/update/delete policies for end
 * users. The action's own authorization checks happen via the RLS-
 * scoped read of `hearth.documents` — the caller can only finalize a
 * document they own.
 *
 * Returns `{ reportId, dedupReason }` so the Smart Uploader review-
 * stage can pivot the acknowledgment copy without an extra query.
 */
export async function finalizeCcrUploadAction(
  input: FinalizeCcrUploadInput,
): Promise<FinalizeCcrUploadResult> {
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
      error: `finalizeCcrUploadAction: document.kind is '${doc.kind}', expected 'water_quality_report'`,
    };
  }

  const ai = doc.ai_extraction as CcrExtraction | null;
  if (!ai || ai.mode !== "ccr") {
    return {
      data: null,
      error:
        "finalizeCcrUploadAction: document.ai_extraction is missing or not a CCR extraction — run analyzeCcrAction first",
    };
  }

  const contentHash = doc.content_hash;
  if (typeof contentHash !== "string" || contentHash.length === 0) {
    return {
      data: null,
      error:
        "finalizeCcrUploadAction: document.content_hash is missing — the upload step should have populated it",
    };
  }

  const reportYear = input.reportYearOverride ?? ai.report_year;
  if (typeof reportYear !== "number" || !Number.isInteger(reportYear)) {
    return {
      data: null,
      error:
        "finalizeCcrUploadAction: couldn't resolve a coverage year for this CCR. The extraction's header didn't include one and no override was provided.",
    };
  }

  const edition = input.edition ?? "primary";
  const pwsid = ai.pwsid.trim().toUpperCase();
  const publishedDate =
    ai.extracted.header_metadata?.publication_date ?? null;

  // Writes go through the service-role client. The shared-cache
  // tables (water_system_reports, water_system_report_contributors)
  // have RLS but no write policies for end users — every write is a
  // service-role write inside this action.
  const service = createServiceClient();

  // ---------------------------------------------------------------
  // Stage 1 — find or insert the canonical water_system_reports row.
  // ---------------------------------------------------------------

  const { data: existingReport, error: reportLookupError } = await service
    .from("water_system_reports")
    .select("id, content_hash")
    .eq("pwsid", pwsid)
    .eq("report_year", reportYear)
    .eq("edition", edition)
    .maybeSingle();

  if (reportLookupError) {
    return {
      data: null,
      error: `report lookup failed: ${reportLookupError.message}`,
    };
  }

  let reportId: string;
  let reportExists: boolean;
  if (existingReport) {
    reportId = existingReport.id as string;
    reportExists = true;
  } else {
    const { data: inserted, error: insertError } = await service
      .from("water_system_reports")
      .insert({
        pwsid,
        report_year: reportYear,
        edition,
        source_document_id: input.documentId,
        content_hash: contentHash,
        uploaded_by: doc.uploaded_by ?? null,
        extracted_data: ai.extracted,
        ai_model: doc.ai_model ?? "(unknown)",
        extraction_version: CCR_EXTRACTION_VERSION,
        published_date: publishedDate,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return {
        data: null,
        error:
          insertError?.message ?? "Failed to insert water_system_reports row",
      };
    }
    reportId = inserted.id as string;
    reportExists = false;
  }

  // ---------------------------------------------------------------
  // Stage 2 — check whether this exact content_hash is already
  // recorded as a contributor on this report. The unique constraint
  // on (report_id, content_hash) lets the database enforce this too,
  // but reading first lets us return the right dedup reason without
  // burning a failed insert.
  // ---------------------------------------------------------------

  const { data: existingContributor, error: contribLookupError } =
    await service
      .from("water_system_report_contributors")
      .select("id")
      .eq("report_id", reportId)
      .eq("content_hash", contentHash)
      .maybeSingle();

  if (contribLookupError) {
    return {
      data: null,
      error: `contributor lookup failed: ${contribLookupError.message}`,
    };
  }

  const contributorExists = existingContributor !== null;
  const dedupReason = decideCcrDedupReason({
    contributorExists,
    reportExists,
  });

  // ---------------------------------------------------------------
  // Stage 3 — record the contributor row when this upload contributes
  // new bytes. Skipped on the identical-bytes path (the existing
  // contributor row already covers this content_hash).
  // ---------------------------------------------------------------

  if (!contributorExists) {
    const { error: contribInsertError } = await service
      .from("water_system_report_contributors")
      .insert({
        report_id: reportId,
        content_hash: contentHash,
        document_id: input.documentId,
        contributed_by: doc.uploaded_by ?? null,
        contributed_for_house_id: doc.house_id,
      });
    if (contribInsertError) {
      return {
        data: null,
        error: `contributor insert failed: ${contribInsertError.message}`,
      };
    }
  }

  // ---------------------------------------------------------------
  // Stage 4 — finalize the document row. Overwrites ai_extraction
  // with the typed `{ mode: 'ccr', report_id, dedup_reason, ... }`
  // shape now that the dedup decision is known, and flips status to
  // 'attached'.
  // ---------------------------------------------------------------

  const finalExtraction: CcrExtraction = {
    mode: "ccr",
    report_id: reportId,
    pwsid,
    report_year: reportYear,
    dedup_reason: dedupReason,
    extracted: ai.extracted,
  };

  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({
      ai_extraction: finalExtraction,
      status: "attached",
    })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return {
      data: null,
      error: updateError?.message ?? "Failed to finalize document",
    };
  }

  return {
    data: {
      document: updated as DocumentRow,
      reportId,
      dedupReason,
    },
    error: null,
  };
}
