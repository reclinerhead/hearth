"use client";

import { useEffect, useState } from "react";
import { HEARTH_DOCUMENTS_BUCKET } from "@/lib/documents/paths";
import { createClient } from "@/lib/supabase/client";
import type { DocumentKind, DocumentRow } from "@/types/document";

const SIGNED_URL_TTL_SECONDS = 300;

// The duplicate short-circuit is reached from both the photo path and
// the receipt path, so the copy reads off the existing document's kind
// rather than assuming "photo". nameplate/photo are camera shots of an
// item; everything else (receipts, manuals, permits, …) reads as a
// "document". Falls back to the generic noun for any future kind.
function duplicateNoun(kind: DocumentKind): string {
  return kind === "photo" || kind === "nameplate" ? "photo" : "document";
}

/**
 * Stage 4a — Duplicate short-circuit. Shows the existing document's
 * thumbnail (via a signed URL the browser mints on the fly) and the
 * name of the inventory item it's attached to, if any. Informational
 * only — no edit path in v1.
 */
export function DuplicateStage({
  existingDocument,
  onClose,
}: {
  existingDocument: DocumentRow;
  onClose: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [inventoryName, setInventoryName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Signed URL for the existing thumbnail. Bucket is private — same
      // 5-minute TTL the analyze action uses for the optimized image.
      const { data } = await supabase.storage
        .from(HEARTH_DOCUMENTS_BUCKET)
        .createSignedUrl(existingDocument.thumbnail_path, SIGNED_URL_TTL_SECONDS);
      if (cancelled) return;
      setThumbUrl(data?.signedUrl ?? null);

      if (existingDocument.inventory_id) {
        const { data: inv } = await supabase
          .from("inventory")
          .select("name")
          .eq("id", existingDocument.inventory_id)
          .maybeSingle();
        if (cancelled) return;
        setInventoryName(inv?.name ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existingDocument]);

  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        You&apos;ve already uploaded this {duplicateNoun(existingDocument.kind)}.
        We didn&apos;t add it a second time.
      </p>

      <div
        className="surface overflow-hidden"
        style={{
          aspectRatio: "4 / 3",
          borderRadius: "var(--radius-md)",
        }}
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt="Existing document thumbnail"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ backgroundColor: "var(--color-bg-surface-raised)" }}
            aria-hidden
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="eyebrow">Attached to</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          {inventoryName ?? "Not yet attached to an item."}
        </div>
      </div>

      <div className="flex items-center justify-end mt-2">
        <button type="button" onClick={onClose} className="btn btn-primary">
          Close
        </button>
      </div>
    </div>
  );
}
