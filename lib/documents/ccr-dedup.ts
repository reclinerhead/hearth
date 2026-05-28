/**
 * CCR upload dedup decision helper. Issue #176 (WQA-3).
 *
 * Pure. Given the two boolean signals the finalize action gathers
 * from Supabase — whether a contributor row already exists for this
 * (report_id, content_hash) combo, and whether a report row already
 * exists for this (pwsid, year, edition) combo — decide which of the
 * three dedup reasons applies:
 *
 *   identical-bytes — A contributor row already exists with this
 *                     content_hash. The user re-uploaded bytes that
 *                     are already on file for this report. No model
 *                     call ran (the finalize action short-circuited);
 *                     no new contributor row is recorded.
 *
 *   same-ccr-different-bytes — No matching contributor, but a report
 *                              row exists for the same (PWSID, year,
 *                              edition). The bytes are different (a
 *                              photo of the same PDF, a re-scanned
 *                              copy) but the underlying document is
 *                              the same. The existing extraction is
 *                              reused; a new contributor row records
 *                              this distinct upload.
 *
 *   first-upload — No matching contributor and no report row. This is
 *                  the canonical extraction for this (PWSID, year,
 *                  edition). The model call ran; the extraction lands
 *                  in water_system_reports; the contributor row
 *                  records the first uploader.
 *
 * The two signals are independent and the function MUST be called
 * with both regardless of which was checked first — passing in
 * `reportExists: false` when `contributorExists: true` would still
 * yield `identical-bytes`, which is the right outcome.
 */

import type { CcrDedupReason } from "@/types/document";

export function decideCcrDedupReason(input: {
  contributorExists: boolean;
  reportExists: boolean;
}): CcrDedupReason {
  if (input.contributorExists) return "identical-bytes";
  if (input.reportExists) return "same-ccr-different-bytes";
  return "first-upload";
}
