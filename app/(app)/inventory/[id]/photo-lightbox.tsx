"use client";

// Fullscreen photo viewer for the inventory detail page. The hero on
// /inventory/[id] is a small thumbnail; clicking it opens this lightbox
// over the page, paginated through every attached photo for the item.
// Wraps `yet-another-react-lightbox` — the library handles keyboard
// navigation, swipe gestures, focus trap, and ARIA plumbing, and we
// theme it via CSS variables to match Hearth's surfaces.
//
// Signed URLs for the full-resolution `storage_path` (1920px) are
// resolved on open through the same `createCachedSignedUrl` helper the
// hero thumbnail uses (see TechnicalGuide → "Signed URL caching"), so
// re-opening the same photo serves from the sessionStorage URL cache
// and the browser's HTTP cache hits the immutable bucket bytes.

import { useEffect, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import { createCachedSignedUrl } from "@/lib/house-image/signed-url";
import { createClient } from "@/lib/supabase/client";
import type { InventoryPhoto } from "./page";

type Slide = { src: string; alt: string };

export function PhotoLightbox({
  open,
  index,
  photos,
  altPrefix,
  onClose,
}: {
  open: boolean;
  index: number;
  photos: InventoryPhoto[];
  altPrefix: string;
  onClose: () => void;
}) {
  // Slides resolve lazily when the lightbox opens. Until they arrive
  // the library renders empty slides — we hold off mounting until the
  // first batch resolves to avoid a brief flash of broken images.
  const [slides, setSlides] = useState<Slide[]>([]);

  useEffect(() => {
    if (!open || photos.length === 0) {
      // Drop slides when the lightbox closes so a future open with a
      // different photo set doesn't briefly render stale URLs.
      setSlides([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    Promise.all(
      photos.map((p) =>
        createCachedSignedUrl(
          supabase,
          "hearth-documents",
          p.storagePath,
          null,
        ),
      ),
    ).then((urls) => {
      if (cancelled) return;
      // Preserve photo order; missing URLs fall back to empty src so
      // the carousel keeps index alignment with the photos array. The
      // library renders its built-in error state for empty/broken src.
      setSlides(
        urls.map((url, i) => ({
          src: url ?? "",
          alt: photos.length > 1
            ? `${altPrefix} — photo ${i + 1} of ${photos.length}`
            : altPrefix,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, photos, altPrefix]);

  // Don't mount the library until URLs are ready. On the second open
  // for the same photo set the sessionStorage hit is synchronous
  // enough that this gate is invisible; on a cold open it holds for
  // the brief signing round trip.
  if (!open || slides.length === 0) return null;

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      // Counter ("2 / 5") only renders when there's more than one
      // slide, per the library's default behavior. Single-photo case
      // stays clean.
      plugins={[Counter]}
      // Disable wrap-around: at the end of the list, the next arrow
      // hides. Feels right for a small photo set (1-6 typically); a
      // wraparound implies a longer carousel.
      carousel={{ finite: true }}
      // Themed chrome via the library's CSS custom properties. The
      // backdrop matches Hearth's deep-surface palette and the chrome
      // (buttons, counter) uses the project's text-secondary token so
      // the controls feel native rather than library-stock.
      styles={{
        root: {
          // YARL custom props are typed as plain CSS-var strings on
          // this slot. They control the entire lightbox chrome.
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
        // Soften the navigation buttons and toolbar to match Hearth's
        // ghost-button restraint instead of the library's default
        // shadowed pill chrome.
        button: { filter: "none" },
      }}
      // Hearth-flavored counter copy. Library default is "1 / 5"; we
      // use "1 of 5" to match the rest of the product's voice.
      counter={{ separator: " of " }}
    />
  );
}
