"use server";

import { createClient } from "@/lib/supabase/server";

export type AddDocumentPageInput = {
  documentId: string;
  /** 1-indexed page number; the database CHECK rejects values < 2. */
  pageNumber: number;
  storagePath: string;
  thumbnailPath: string;
  contentHash: string;
  mimeType: string;
  fileSizeBytes: number;
  originalFilename: string;
};

export type DocumentPageRow = {
  id: string;
  document_id: string;
  page_number: number;
  storage_path: string;
  thumbnail_path: string;
  content_hash: string | null;
  mime_type: string;
  file_size_bytes: number;
  original_filename: string;
  created_at: string;
};

/**
 * Inserts a hearth.document_pages row for pages 2+ of a multi-page
 * receipt. The Smart Uploader has already uploaded the storage objects
 * (page-{N}-optimized.jpg + page-{N}-thumb.jpg under the parent
 * document's directory) by the time this runs.
 *
 * RLS scopes the insert through the parent document's house ownership.
 * Page 1 lives on hearth.documents directly — never call this with
 * pageNumber=1 (the database CHECK will reject it, but the type-level
 * check above isn't enforceable).
 */
export async function addDocumentPageAction(
  input: AddDocumentPageInput,
): Promise<
  | { data: DocumentPageRow; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("document_pages")
    .insert({
      document_id: input.documentId,
      page_number: input.pageNumber,
      storage_path: input.storagePath,
      thumbnail_path: input.thumbnailPath,
      content_hash: input.contentHash,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      original_filename: input.originalFilename,
    })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as DocumentPageRow, error: null };
}
