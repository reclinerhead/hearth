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
  | { kind: "uploader"; category: EmergencyCategory }
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
          {groups.map((group) => (
            <CategoryRow
              key={group.category}
              group={group}
              onOpenUploader={() =>
                setOpen({ kind: "uploader", category: group.category })
              }
              onOpenVideo={(videoId) =>
                setOpen({
                  kind: "modal",
                  category: group.category,
                  initialVideoId: videoId,
                })
              }
            />
          ))}
        </div>
      </div>

      {open.kind === "uploader" ? (
        <SmartUploader
          open
          onOpenChange={(o) => {
            if (!o) setOpen({ kind: "none" });
          }}
          houseId={houseId}
          initialEmergencyCategory={open.category}
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

function CategoryRow({
  group,
  onOpenUploader,
  onOpenVideo,
}: {
  group: EmergencyReferenceCategoryGroup;
  onOpenUploader: () => void;
  onOpenVideo: (videoId: string) => void;
}) {
  const primary = group.videos.find((v) => v.isPrimary) ?? group.videos[0];
  const secondaryCount = group.videos.length - (primary ? 1 : 0);

  if (!primary) {
    return <EmptyCategoryAffordance group={group} onClick={onOpenUploader} />;
  }

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
          className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-small"
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

function EmptyCategoryAffordance({
  group,
  onClick,
}: {
  group: EmergencyReferenceCategoryGroup;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left transition-colors"
      style={{
        border: "1px dashed var(--color-border-emphasis)",
        backgroundColor: "var(--color-bg-surface)",
      }}
    >
      <span
        className="relative shrink-0 overflow-hidden rounded-md"
        style={{
          width: 44,
          height: 44,
          border: "1px solid var(--color-border-subtle)",
          opacity: 0.55,
        }}
      >
        <Image
          src={group.meta.iconSrc}
          alt=""
          fill
          sizes="44px"
          style={{ objectFit: "cover" }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          Add a {group.meta.label.toLowerCase()} video
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {group.meta.description}
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
  // frame. The bottom scrim carries label + duration + play affordance.
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden text-left transition-transform"
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
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-3 pt-6">
        <div className="min-w-0">
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
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 52,
            height: 52,
            borderRadius: 9999,
            backgroundColor: "color-mix(in oklab, #fff 92%, transparent)",
            color: "var(--color-text-primary)",
          }}
        >
          <Icon name="play" size={22} strokeWidth={1.5} />
        </span>
      </div>
    </button>
  );
}

// Re-export so the server panel can import the type from one place.
export type { EmergencyCategoryMeta };
