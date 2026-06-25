"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import type {
  ActivityEntry,
  ActivityKind,
} from "@/lib/dashboard/recent-activity";

// Floor so a 1- or 2-entry panel doesn't produce a stunted tile; tiles
// otherwise `flex-1` to fill the column to rough parity with the photo.
// The square thumbnail tracks this height, so it doubles as the thumb size.
const TILE_MIN_HEIGHT = 84;

// Per-kind corner badge on the thumbnail — the at-a-glance "what is this
// tile?" cue. Each kind gets its own icon + color so a completed task, an
// uploaded document, and a newly-added item read distinctly (and none is
// confused with the upcoming/overdue maintenance in the panel below). The
// `label` is the hover tooltip and the badge's accessible name.
const KIND_BADGE: Record<
  ActivityKind,
  { icon: IconName; color: string; strokeWidth: number; label: string }
> = {
  task_completed: {
    icon: "check",
    color: "var(--color-success)",
    strokeWidth: 3,
    label: "Completed maintenance",
  },
  document_attached: {
    icon: "file-text",
    color: "var(--color-info)",
    strokeWidth: 2,
    label: "Document uploaded",
  },
  inventory_added: {
    icon: "plus",
    color: "var(--color-accent)",
    strokeWidth: 3,
    label: "Item added",
  },
};

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
export function LatelyTile({
  entry,
  whenLabel,
}: {
  entry: ActivityEntry;
  /** "Done 1 week ago" / "Uploaded Jun 24" — computed server-side in the
   *  panel so the relative time doesn't drift on the client. */
  whenLabel: string;
}) {
  const url = useCachedSignedUrl(
    entry.thumbnailBucket,
    entry.thumbnailPath,
    null,
  );
  const badge = KIND_BADGE[entry.kind];

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
          Kind badge in the thumbnail corner (see KIND_BADGE). The
          surface-colored ring lifts it off busy photos.
        */}
        <span
          title={badge.label}
          aria-label={badge.label}
          role="img"
          className="absolute bottom-1 right-1 flex items-center justify-center rounded-full text-white"
          style={{
            width: 18,
            height: 18,
            backgroundColor: badge.color,
            boxShadow: "0 0 0 1.5px var(--color-bg-surface-raised)",
          }}
        >
          <Icon name={badge.icon} size={11} strokeWidth={badge.strokeWidth} />
        </span>
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
        {/*
          When line — a dimmer, kind-appropriate "Done / Uploaded / Added
          <time>" beneath the title. Reinforces what happened and fills the
          tile out. Computed server-side (panel) and passed as a prop.
        */}
        <div
          className="truncate"
          style={{
            color: "var(--color-text-tertiary)",
            fontSize: 11,
            fontWeight: 400,
          }}
        >
          {whenLabel}
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
