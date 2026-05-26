"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { SmartUploader } from "@/components/smart-uploader/SmartUploader";
import { SectionHeader } from "@/components/ui";
import {
  formatVideoDuration,
  type EmergencyCategoryMeta,
} from "@/lib/documents/emergency-categories";
import type { EmergencyCategory } from "@/types/document";
import { EmergencyVideoModal } from "./emergency-video-modal";

/**
 * Client component for the dashboard's Emergency reference panel
 * (issue #139). Renders one row per category in the fixed order
 * Water → Gas → Electrical → Other.
 *
 * Each category renders one of two layouts:
 *   - Empty: a thin "Add a {label} video" affordance row that opens
 *     the Smart Uploader pre-routed to that category.
 *   - Has videos: a chunky icon-dominant primary tile + a "+N more"
 *     affordance below if secondaries exist. Tapping the primary
 *     opens the modal with all videos in the category.
 *
 * The icons take full background of each populated tile — at-a-glance
 * recognition matters more than peeking at the actual recording (per
 * issue #139's "icon image more prominently" direction from Todd).
 */

export type EmergencyVideoSummary = {
  id: string;
  label: string | null;
  isPrimary: boolean;
  storagePath: string;
  posterStoragePath: string | null;
  mimeType: string;
  durationSeconds: number | null;
  notes: string | null;
  createdAt: string;
};

export type EmergencyReferenceCategoryGroup = {
  category: EmergencyCategory;
  meta: EmergencyCategoryMeta;
  videos: EmergencyVideoSummary[];
};

type OpenState =
  | { kind: "none" }
  | { kind: "uploader" }
  | { kind: "modal"; category: EmergencyCategory; initialVideoId: string };

export function EmergencyReferencePanelClient({
  houseId,
  groups,
}: {
  houseId: string;
  groups: EmergencyReferenceCategoryGroup[];
}) {
  const [open, setOpen] = useState<OpenState>({ kind: "none" });

  const totalCount = groups.reduce((sum, g) => sum + g.videos.length, 0);

  // Populated tiles run 1-up on mobile and 2-up on desktop (where the
  // panel sits next to maintenance and the full-bleed icon tile is
  // otherwise too large). Empty categories no longer get their own
  // row — one combined "Add another emergency video" affordance opens
  // the Smart Uploader at the category-picker stage instead, since
  // four per-category rows are noisy when most categories are empty.
  const populated = groups.filter((g) => g.videos.length > 0);

  function openUploader() {
    setOpen({ kind: "uploader" });
  }
  function openVideo(category: EmergencyCategory, videoId: string) {
    setOpen({ kind: "modal", category, initialVideoId: videoId });
  }

  // Icons shown on the combined affordance — three distinct images
  // (Water / Gas / Electrical). The "Other" category's icon is currently
  // a re-use of the electrical one, so we deduplicate visually.
  const affordanceIcons = [
    "/document_icons/emergency_water.jpg",
    "/document_icons/emergency_gas_meter.jpg",
    "/document_icons/emergency_electric.jpg",
  ];

  return (
    <>
      <div>
        <SectionHeader
          eyebrow="If something goes wrong"
          title="Emergencies"
          trailing={
            totalCount > 0 ? (
              <span
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {totalCount} saved
              </span>
            ) : null
          }
        />

        <div className="flex flex-col gap-3">
          {populated.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {populated.map((group) => (
                <PopulatedCategoryCell
                  key={group.category}
                  group={group}
                  onOpenVideo={(videoId) => openVideo(group.category, videoId)}
                />
              ))}
            </div>
          ) : null}
          <AddAnotherAffordance
            hasExisting={populated.length > 0}
            iconSrcs={affordanceIcons}
            onClick={openUploader}
          />
        </div>
      </div>

      {open.kind === "uploader" ? (
        <SmartUploader
          open
          onOpenChange={(o) => {
            if (!o) setOpen({ kind: "none" });
          }}
          houseId={houseId}
          initialEmergencyEntry="category-picker"
        />
      ) : null}

      {open.kind === "modal"
        ? (() => {
            const group = groups.find((g) => g.category === open.category);
            if (!group) return null;
            return (
              <EmergencyVideoModal
                group={group}
                initialVideoId={open.initialVideoId}
                onClose={() => setOpen({ kind: "none" })}
              />
            );
          })()
        : null}
    </>
  );
}

function PopulatedCategoryCell({
  group,
  onOpenVideo,
}: {
  group: EmergencyReferenceCategoryGroup;
  onOpenVideo: (videoId: string) => void;
}) {
  const primary = group.videos.find((v) => v.isPrimary) ?? group.videos[0];
  if (!primary) return null;
  const secondaryCount = group.videos.length - 1;

  return (
    <div className="flex flex-col gap-2">
      <PrimaryTile
        group={group}
        video={primary}
        onClick={() => onOpenVideo(primary.id)}
      />
      {secondaryCount > 0 ? (
        <button
          type="button"
          onClick={() => onOpenVideo(primary.id)}
          className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-small"
          style={{
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-secondary)",
            backgroundColor: "var(--color-bg-surface)",
          }}
        >
          <span>
            +{secondaryCount} more {group.meta.label.toLowerCase()} video
            {secondaryCount === 1 ? "" : "s"}
          </span>
          <Icon name="chevron-right" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AddAnotherAffordance({
  hasExisting,
  iconSrcs,
  onClick,
}: {
  hasExisting: boolean;
  iconSrcs: string[];
  onClick: () => void;
}) {
  // One combined affordance instead of per-category empty rows. Tapping
  // opens the Smart Uploader directly at the emergency category-picker
  // stage so the user picks Water / Gas / Electrical / Other in the
  // modal — which already has the icon-dominant 2x2 grid they liked.
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left transition-colors"
      style={{
        border: "1px dashed var(--color-border-emphasis)",
        backgroundColor: "var(--color-bg-surface)",
      }}
    >
      <span
        className="flex shrink-0 items-center -space-x-2"
        aria-hidden
      >
        {iconSrcs.map((src, i) => (
          <span
            key={src + i}
            className="relative overflow-hidden rounded-md"
            style={{
              width: 36,
              height: 36,
              border: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-surface-raised)",
              zIndex: iconSrcs.length - i,
            }}
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="36px"
              style={{ objectFit: "cover" }}
            />
          </span>
        ))}
      </span>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          {hasExisting ? "Add another emergency video" : "Add an emergency video"}
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Water shutoffs, gas meter, breaker panel, alarm panel, or anything else
          future-you should know how to operate.
        </div>
      </div>
      <span
        aria-hidden
        style={{ color: "var(--color-text-tertiary)" }}
        className="self-center"
      >
        <Icon name="plus" size={18} />
      </span>
    </button>
  );
}

function PrimaryTile({
  group,
  video,
  onClick,
}: {
  group: EmergencyReferenceCategoryGroup;
  video: EmergencyVideoSummary;
  onClick: () => void;
}) {
  // The icon takes the full background of the tile — at-a-glance
  // category recognition matters more than peeking at the recorded
  // frame. The bottom scrim carries the category eyebrow + label +
  // duration. No separate play affordance — the duration line is the
  // signal that this is a video.
  return (
    <button
      type="button"
      onClick={onClick}
      // `block w-full` is required so the button stretches to fill its
      // flex/grid parent. Without it, `<button>` defaults to
      // `display: inline-block` and the aspect-ratio + min-height combo
      // computes an intrinsic size that overflows the viewport on iOS
      // Safari. Same pattern as the inventory list tile.
      className="group relative block w-full overflow-hidden text-left transition-transform"
      style={{
        aspectRatio: "16 / 10",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
        minHeight: 180,
      }}
    >
      <Image
        src={group.meta.iconSrc}
        alt=""
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
        style={{ objectFit: "cover" }}
        priority={group.category === "water"}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, #000 78%, transparent), transparent)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-4 pb-3 pt-6">
        <div className="min-w-0 flex-1">
          <div
            className="text-small"
            style={{
              color: "color-mix(in oklab, #fff 78%, transparent)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            {group.meta.label}
          </div>
          <div
            className="truncate"
            style={{ color: "#fff", fontSize: 18, fontWeight: 500 }}
          >
            {video.label || `${group.meta.label} emergency`}
          </div>
          {video.durationSeconds != null && video.durationSeconds > 0 ? (
            <div
              className="text-small mt-0.5 tabular-nums"
              style={{
                color: "color-mix(in oklab, #fff 70%, transparent)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {formatVideoDuration(video.durationSeconds)}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// Re-export so the server panel can import the type from one place.
export type { EmergencyCategoryMeta };
