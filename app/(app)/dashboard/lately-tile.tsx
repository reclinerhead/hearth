"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import type { ActivityEntry } from "@/lib/dashboard/recent-activity";

// Floor so a 1- or 2-entry panel doesn't produce a stunted tile; tiles
// otherwise `flex-1` to fill the column to rough parity with the photo.
// The square thumbnail tracks this height, so it doubles as the thumb size.
const TILE_MIN_HEIGHT = 84;

/**
 * Dashboard "Lately" activity tile (issue #279). A square thumbnail of the
 * item/document on the left (or the radial-gradient fallback wash + type
 * icon), with the event eyebrow + entity title stacked to its right,
 * wrapped in a Link to the item. The earlier full-bleed-photo-under-scrim
 * treatment zoomed each photo too far to read; a contained square thumbnail
 * shows the whole frame and keeps the detail text on the surface where it's
 * cleanly legible.
 *
 * Client component because the thumbnail is signed via
 * `useCachedSignedUrl` — same contract as `InventoryThumbnail`: the URL
 * string caches in `sessionStorage` so the browser HTTP-cache hits the
 * immutable `hearth-documents` bytes across navigations.
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
      // `flex items-stretch` so the square thumbnail tracks the tile height;
      // `flex-1` so the tiles share the panel height. Same hover/focus chrome
      // as InventoryTile — a subtle accent ring, no movement.
      className="group relative flex w-full flex-1 items-stretch overflow-hidden transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
      style={{
        minHeight: TILE_MIN_HEIGHT,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <div
        // Square thumbnail flush to the left edge. `self-stretch aspect-square`
        // makes its width track the tile's (row-stretched) height, so the
        // thumb stays square at whatever height the grid hands the tile.
        className="relative aspect-square shrink-0 self-stretch overflow-hidden"
        style={{
          borderRight: "1px solid var(--color-border-subtle)",
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

        {/*
          Completed-maintenance badge. Only task_completed entries get the
          green check — it reads at a glance as "done," distinguishing these
          from the upcoming/overdue maintenance in the panel below. The
          surface-colored ring lifts it off busy photos.
        */}
        {entry.kind === "task_completed" && (
          <span
            aria-hidden
            className="absolute bottom-1 right-1 flex items-center justify-center rounded-full text-white"
            style={{
              width: 18,
              height: 18,
              backgroundColor: "var(--color-success)",
              boxShadow: "0 0 0 1.5px var(--color-bg-surface-raised)",
            }}
          >
            <Icon name="check" size={11} strokeWidth={3} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3.5 py-2">
        <div
          className="truncate"
          style={{
            color: "var(--color-text-tertiary)",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {entry.eyebrow}
        </div>
        <div
          // Two lines max — the text column is narrower than the old full-bleed
          // overlay, so a single line truncated most titles to uselessness.
          className="line-clamp-2"
          style={{
            color: "var(--color-text-primary)",
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.3,
          }}
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
          <Icon name={icon} size={26} />
        </span>
      </div>
    </>
  );
}
