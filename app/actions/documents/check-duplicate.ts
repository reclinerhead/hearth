"use server";

import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/types/document";

export type CheckDocumentDuplicateInput = {
  houseId: string;
  contentHash: string;
};

export type CheckDocumentDuplicateResult =
  | { exists: false; existingDocument: null }
  | { exists: true; existingDocument: DocumentRow };

/**
 * Returns the existing document in the given house that matches the
 * provided content hash, or { exists: false } if none. RLS scopes the
 * lookup to houses the caller owns; the partial unique index on
 * (house_id, content_hash) makes the maybeSingle() result at most one row.
 */
export async function checkDocumentDuplicateAction(
  input: CheckDocumentDuplicateInput,
): Promise<
  | { data: CheckDocumentDuplicateResult; error: null }
  | { data: null; error: string }
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("house_id", input.houseId)
    .eq("content_hash", input.contentHash)
    .maybeSingle();

  if (error) return { data: null, error: error.message };

  if (!data) {
    return {
      data: { exists: false, existingDocument: null },
      error: null,
    };
  }

  return {
    data: { exists: true, existingDocument: data as DocumentRow },
    error: null,
  };
}
