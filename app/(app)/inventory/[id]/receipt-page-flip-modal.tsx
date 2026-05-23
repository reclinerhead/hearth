"use client";

// Lightweight page-flip modal for a multi-page receipt (issue #117).
// Mirrors the photo-lightbox shape: when opened with a documentId, it
// loads the parent document's page-1 storage_path plus every
// document_pages row in ascending order, signs each, and hands the
// slides to yet-another-react-lightbox.
//
// Per the issue's open-question lean, this is the v1 surface for
// looking at a captured receipt — a dedicated /documents/[id] route is
// a deferred follow-up.

import { useEffect, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import { createCachedSignedUrl } from "@/lib/house-image/signed-url";
import { createClient } from "@/lib/supabase/client";

type Slide = { src: string; alt: string };

export function ReceiptPageFlipModal({
  open,
  documentId,
  altPrefix,
  onClose,
}: {
  open: boolean;
  documentId: string | null;
  altPrefix: string;
  onClose: () => void;
}) {
  const [slides, setSlides] = useState<Slide[]>([]);

  useEffect(() => {
    if (!open || !documentId) {
      setSlides([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Fetch the parent document's page-1 storage_path and every
      // document_pages entry in order. Two reads in parallel.
      const [docResult, pagesResult] = await Promise.all([
        supabase
          .from("documents")
          .select("storage_path")
          .eq("id", documentId)
          .single(),
        supabase
          .from("document_pages")
          .select("page_number, storage_path")
          .eq("document_id", documentId)
          .order("page_number", { ascending: true }),
      ]);

      if (cancelled) return;
      if (!docResult.data) {
        setSlides([]);
        return;
      }

      const orderedPaths: string[] = [
        docResult.data.storage_path,
        ...((pagesResult.data ?? []) as { storage_path: string }[]).map(
          (p) => p.storage_path,
        ),
      ];

      const urls = await Promise.all(
        orderedPaths.map((p) =>
          createCachedSignedUrl(supabase, "hearth-documents", p, null),
        ),
      );
      if (cancelled) return;
      setSlides(
        urls.map((url, i) => ({
          src: url ?? "",
          alt: `${altPrefix} — page ${i + 1} of ${orderedPaths.length}`,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, documentId, altPrefix]);

  if (!open || slides.length === 0) return null;

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={0}
      slides={slides}
      plugins={[Counter]}
      carousel={{ finite: true }}
      // Same chrome theme as PhotoLightbox — Hearth's surface palette
      // and ghost-button restraint.
      styles={{
        root: {
          ["--yarl__color_backdrop" as string]:
            "color-mix(in oklab, var(--color-bg-surface) 92%, black)",
          ["--yarl__color_button" as string]: "var(--color-text-secondary)",
          ["--yarl__color_button_active" as string]:
            "var(--color-text-primary)",
          ["--yarl__color_button_disabled" as string]:
            "var(--color-text-tertiary)",
          ["--yarl__slide_captions_container_background" as string]:
            "transparent",
        },
        container: { backdropFilter: "blur(2px)" },
        button: { filter: "none" },
      }}
      counter={{ separator: " of " }}
    />
  );
}
