"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import type { ActivityEntry } from "@/lib/dashboard/recent-activity";

// Floor so a 1- or 2-entry panel doesn't produce a stunted tile; tiles
// otherwise `flex-1` to fill the column to rough parity with the photo.
const TILE_MIN_HEIGHT = 84;

/**
 * Dashboard "Lately" activity tile (issue #279). A full-bleed photo (or
 * the radial-gradient fallback wash + type icon) under a bottom scrim
 * that carries the event eyebrow + entity title, wrapped in a Link to the
 * item. Modeled on the inventory list's `InventoryTile` and the Emergency
 * panel's `PrimaryTile` (issues #174 / #139).
 *
 * Client component because the thumbnail is signed via
 * `useCachedSignedUrl` — same contract as `InventoryThumbnail`: the URL
 * string caches in `sessionStorage` so the browser HTTP-cache hits the
 * immutable `hearth-documents` bytes across navigations. The overlay
 * scrim + Link wrap differ enough from the bare `InventoryThumbnail`
 * icon/img to warrant a dedicated tile rather than reusing it.
 */
export function LatelyTile({ entry }: { entry: ActivityEntry }) {
  const url = useCachedSignedUrl(
    entry.thumbnailBucket,
    entry.thumbnailPath,
    null,
  );

  return (
    <Link
      href={entry.href}
      aria-label={`${entry.eyebrow}: ${entry.title}`}
      // `block w-full` so the Link fills its flex parent; `flex-1` so three
      // tiles share the panel height. Same hover/focus chrome as InventoryTile
      // — a subtle accent ring, no movement of the photo itself.
      className="group relative block w-full flex-1 overflow-hidden transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
      style={{
        minHeight: TILE_MIN_HEIGHT,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <TileFallbackArtwork icon={entry.fallbackIcon} />
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5"
        style={{
          // Stronger than InventoryTile's scrim — these tiles run two-up
          // (narrower, busier photos) and the small uppercase eyebrow needs
          // the extra dimming to stay legible on bright images.
          background:
            "linear-gradient(to top, color-mix(in oklab, #000 90%, transparent), color-mix(in oklab, #000 35%, transparent) 55%, transparent)",
        }}
      />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-6">
        <div
          className="truncate"
          style={{
            // Smaller, bolder, and brighter than the inventory eyebrow so
            // the detail line reads cleanly over the photo.
            color: "color-mix(in oklab, #fff 92%, transparent)",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {entry.eyebrow}
        </div>
        <div
          className="truncate"
          style={{ color: "#fff", fontSize: 18, fontWeight: 500 }}
        >
          {entry.title}
        </div>
      </div>
    </Link>
  );
}

// Inline copy of the inventory list's fallback artwork (the same radial
// wash `PlaceholderImage` uses). Kept local rather than extracted — the
// two callers live in different route trees and the block is a few lines;
// the project's rule is no shared abstraction until duplication earns it.
function TileFallbackArtwork({ icon }: { icon: IconName }) {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 55%), radial-gradient(circle at 70% 75%, color-mix(in oklab, var(--color-info) 10%, transparent), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ color: "var(--color-text-tertiary)" }}>
          <Icon name={icon} size={40} />
        </span>
      </div>
    </>
  );
}
