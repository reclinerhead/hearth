"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useHouseRealtime } from "@/lib/hooks/use-house-realtime";
import { Icon, type IconName } from "@/components/icon";
import { AICard, MetricCard, PlaceholderImage } from "@/components/ui";
import { diffHouseFacts } from "@/lib/briefing/diff";
import type { MergeableHouseFacts } from "@/lib/briefing/merge";
import { downscaleImage } from "@/lib/house-image/downscale";
import {
  createCachedSignedUrl,
  HOUSE_IMAGE_CACHE_CONTROL,
  type CachedSignedUrlBucket,
} from "@/lib/house-image/signed-url";
import { createClient } from "@/lib/supabase/client";
import type { BriefingStatus, House } from "@/types/house";
import { refreshBriefing, regenerateHouseImage } from "./actions";
import { OnboardingDiscoveryModal } from "./onboarding-discovery-modal";

// 15 MB. Modern phone photos can hit 8-12 MB, so this gives headroom
// for the original file. We downscale to ~1200 px wide and re-encode
// as JPEG before uploading (see lib/house-image/downscale), so the
// bytes that actually leave the browser are typically a few hundred KB.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_MB = 15;
const USER_PHOTO_PATH = "photo";

// While the briefing is finishing up, the image step is kicked off but
// hasn't written generated_image_url yet. Keep the skeleton visible for
// a short window after briefing_generated_at lands so we don't flash the
// placeholder before the image arrives. Image generation typically lands
// well inside this window; anything past it we assume failed silently
// and surface the placeholder + regenerate affordance.
const IMAGE_GENERATION_GRACE_MS = 90_000;

type RefreshSummary =
  | { kind: "updated"; fields: string[] }
  | { kind: "nothing_new" };

// Aggressive polling cadence while a manual refresh is in flight. Faster
// than the hook's idle polling because the user is actively watching the
// page and a fresh briefing typically resolves in 10-30 seconds.
const REFRESH_POLL_INTERVAL_MS = 2000;
// Hard cap on the active refresh window. Two minutes is well past the
// typical workflow runtime — if we hit it, something is wedged and the
// user should know the spinner isn't reliable.
const REFRESH_POLL_TIMEOUT_MS = 120_000;

function snapshotFacts(house: House): MergeableHouseFacts {
  return {
    year_built: house.year_built,
    living_area_sqft: house.living_area_sqft,
    lot_size_sqft: house.lot_size_sqft,
    lot_size_acres: house.lot_size_acres,
    bedrooms: house.bedrooms,
    bathrooms: house.bathrooms,
    heating_summary: house.heating_summary,
    cooling_summary: house.cooling_summary,
    parcel_id: house.parcel_id,
    description: house.description,
    description_source: house.description_source,
  };
}

type HouseFact = {
  eyebrow: string;
  icon: IconName;
  value: string | null;
  meta?: string | null;
};

const EMPTY = "—";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatBuilt(year: number | null): HouseFact {
  if (year === null) return { eyebrow: "Built", icon: "calendar", value: null };
  const age = new Date().getFullYear() - year;
  return {
    eyebrow: "Built",
    icon: "calendar",
    value: String(year),
    meta: age > 0 ? `${age} years old` : undefined,
  };
}

function formatLivingArea(sqft: number | null): HouseFact {
  if (sqft === null)
    return { eyebrow: "Living area", icon: "ruler", value: null };
  return {
    eyebrow: "Living area",
    icon: "ruler",
    value: `${formatNumber(sqft)} sf`,
  };
}

function formatLot(sqft: number | null): HouseFact {
  if (sqft === null) return { eyebrow: "Lot", icon: "map-pin", value: null };
  // Surface acres alongside square feet once the lot crosses ~quarter-acre,
  // since that's the unit listings usually quote at that size.
  const acres = sqft / 43_560;
  if (acres >= 0.1) {
    return {
      eyebrow: "Lot",
      icon: "map-pin",
      value: `${acres.toFixed(2)} ac`,
      meta: `${formatNumber(sqft)} sf`,
    };
  }
  return {
    eyebrow: "Lot",
    icon: "map-pin",
    value: `${formatNumber(sqft)} sf`,
  };
}

function formatBedrooms(n: number | null): HouseFact {
  if (n === null) return { eyebrow: "Bedrooms", icon: "bed", value: null };
  return {
    eyebrow: "Bedrooms",
    icon: "bed",
    value: Number.isInteger(n) ? String(n) : n.toFixed(1),
  };
}

function formatBathrooms(n: number | null): HouseFact {
  if (n === null) return { eyebrow: "Bathrooms", icon: "bath", value: null };
  return {
    eyebrow: "Bathrooms",
    icon: "bath",
    value: Number.isInteger(n) ? String(n) : n.toFixed(1),
  };
}

function buildFacts(house: House): HouseFact[] {
  return [
    formatBuilt(house.year_built),
    formatLivingArea(house.living_area_sqft),
    formatLot(house.lot_size_sqft),
    formatBedrooms(house.bedrooms),
    formatBathrooms(house.bathrooms),
  ];
}

function HeroAddress({
  house,
  onRefresh,
  refreshing,
}: {
  house: House;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const display = house.nickname ?? house.address_line1;
  const region = `${house.city}, ${house.state}`;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="eyebrow">Your house</div>
        <h1 className="h1" style={{ marginTop: 4 }}>
          {display}
        </h1>
        <p
          className="text-small mt-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {region}
        </p>
      </div>
      <RefreshBriefingButton onClick={onRefresh} refreshing={refreshing} />
    </div>
  );
}

/**
 * Re-runs the Day One Briefing on demand. Sonar's results are stochastic,
 * so a second run usually fills in fields the first run missed. The merge
 * step (lib/briefing/merge.ts) guarantees a null from a fresh run never
 * clobbers an existing non-null value, so re-rolling is always safe.
 */
function RefreshBriefingButton({
  onClick,
  refreshing,
}: {
  onClick: () => void;
  refreshing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-label="Refresh house facts"
      title={refreshing ? "Refreshing house facts…" : "Refresh house facts"}
      className="btn btn-ghost shrink-0"
      style={{
        opacity: refreshing ? 0.75 : 1,
        cursor: refreshing ? "default" : "pointer",
      }}
    >
      <span
        aria-hidden
        className={refreshing ? "animate-spin" : undefined}
        style={{ display: "inline-flex" }}
      >
        <Icon name="refresh-cw" size={14} />
      </span>
      <span className="hidden sm:inline">
        {refreshing ? "Refreshing…" : "Refresh"}
      </span>
    </button>
  );
}

/**
 * Renders a metric value in one of three states depending on briefing
 * progress and whether we got a real value back:
 *  - running + no value: a small pulsing skeleton inline
 *  - completed + no value: an em-dash in tertiary text
 *  - any state with a value: render the value
 */
function FactValue({
  value,
  status,
}: {
  value: string | null;
  status: BriefingStatus;
}) {
  if (value !== null) return <span>{value}</span>;
  if (status === "running" || status === "pending") {
    return (
      <span
        aria-label="Discovering"
        className="inline-block animate-pulse rounded-sm align-middle"
        style={{
          width: "3.5rem",
          height: "1em",
          backgroundColor: "var(--color-bg-surface-raised)",
        }}
      />
    );
  }
  return <span style={{ color: "var(--color-text-tertiary)" }}>{EMPTY}</span>;
}

function FactMeta({
  meta,
  hasValue,
  status,
}: {
  meta: string | null | undefined;
  hasValue: boolean;
  status: BriefingStatus;
}) {
  if (meta) return <>{meta}</>;
  if (!hasValue && status === "completed") return <>Not found</>;
  return null;
}

/**
 * Summarizes the result of a manual refresh. Uses the surface-ai treatment
 * so it visually reads as an AI-driven update, matching the AICard pattern
 * used elsewhere for assistant output.
 */
function RefreshSummaryBanner({
  summary,
  onDismiss,
}: {
  summary: RefreshSummary;
  onDismiss: () => void;
}) {
  const isUpdated = summary.kind === "updated";
  const title = isUpdated
    ? `Refresh found ${summary.fields.length} new ${
        summary.fields.length === 1 ? "fact" : "facts"
      } about your house.`
    : "We couldn't find anything new — your house facts are up to date.";

  return (
    <div
      className="surface-ai flex items-start gap-3 p-3 sm:p-4"
      style={{ borderRadius: "var(--radius-lg)" }}
      role="status"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 16%, transparent)",
          color: "var(--color-accent)",
        }}
      >
        <Icon name={isUpdated ? "sparkles" : "circle-check"} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {title}
        </div>
        {isUpdated ? (
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {summary.fields.join(" · ")}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="btn btn-ghost btn-icon shrink-0"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/**
 * Skeleton shown in place of the generated illustration while it's
 * being produced — both during the very first generation (after a new
 * house is created) and during an explicit regenerate when no prior
 * image exists. The sparkles dot + "Generating illustration…" copy
 * makes it clear that something is actively happening, rather than
 * looking like a permanent empty state.
 */
function GeneratingIllustrationSkeleton() {
  return (
    <div className="surface-raised absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 55%), radial-gradient(circle at 70% 75%, color-mix(in oklab, var(--color-info) 10%, transparent), transparent 60%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-3 text-center px-4">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 items-center justify-center rounded-full animate-pulse"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 22%, transparent)",
            color: "var(--color-accent)",
          }}
        >
          <Icon name="sparkles" size={16} />
        </span>
        <span
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Generating illustration…
        </span>
      </div>
    </div>
  );
}

/**
 * The hero image surface. Renders, in priority order:
 *  - the user-uploaded photo (when one exists for this house)
 *  - the generated illustration (when a signed URL is in hand)
 *  - the "Generating illustration…" skeleton (while we're still waiting
 *    on the first sketch to land, or a regenerate is in flight with no
 *    prior image to keep on screen)
 *  - the original placeholder (terminal state with no image — failure
 *    or pre-briefing; surfaces the regenerate button as the way out)
 *
 * The figcaption disclaimer + action row swaps based on which image is
 * showing:
 *   - generated → "Stylized illustration — not a photo of your home."
 *     plus an "Upload your own photo" affordance.
 *   - user photo → "Your photo." plus "Replace" / "Remove" affordances.
 *
 * The "not a photo of your home" framing is load-bearing whenever the
 * generated illustration is on screen — see TechnicalGuide.md
 * ("Generated house illustration"). The disclaimer is intentionally
 * dropped only when a real user photo replaces the sketch.
 *
 * The regenerate affordance is a floating icon button overlaid on the
 * image bottom-right. Shown only when displaying the generated image;
 * regenerating a user photo doesn't make sense, so the button hides
 * once a user photo is in place.
 */
function HouseImageSurface({
  house,
  imageUrl,
  isUserPhoto,
  briefingJustFinished,
  regenerating,
  regenerateDisabled,
  onRegenerate,
  onSelectFile,
  onRemoveUserPhoto,
  uploading,
  removing,
}: {
  house: House;
  imageUrl: string | null;
  isUserPhoto: boolean;
  // Whether the briefing finished recently enough that we're still
  // expecting the image step to land — derived in DashboardLive via a
  // setTimeout-driven effect so the value updates without depending on
  // an impure Date.now() read during render.
  briefingJustFinished: boolean;
  regenerating: boolean;
  regenerateDisabled: boolean;
  onRegenerate: () => void;
  onSelectFile: (file: File) => void;
  onRemoveUserPhoto: () => void;
  uploading: boolean;
  removing: boolean;
}) {
  const altLabel = house.nickname ?? house.address_line1;
  const hasImage = imageUrl !== null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const briefingActive =
    house.briefing_status === "pending" || house.briefing_status === "running";

  // "Generating illustration…" skeleton is specific to the generated
  // illustration flow — user-photo uploads have their own overlay and
  // the briefing's image step has no bearing on them. Suppress the
  // skeleton during the (brief) user-photo signed-URL fetch so the
  // copy doesn't lie about what's happening.
  const showSkeleton =
    !isUserPhoto &&
    !hasImage &&
    (regenerating || briefingActive || briefingJustFinished);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so re-selecting the same file fires onChange.
    e.target.value = "";
    if (file) onSelectFile(file);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  const altText = isUserPhoto
    ? `Photo of ${altLabel}`
    : `Stylized architectural illustration for ${altLabel}`;

  // The regenerate overlay is only meaningful while we're showing the
  // generated illustration — replacing a user photo happens via the
  // file picker, not via re-running the image workflow.
  const showRegenerateOverlay = !isUserPhoto && !(showSkeleton && !hasImage);

  return (
    <figure className="surface overflow-hidden flex flex-col">
      <div className="relative" style={{ aspectRatio: "4 / 3" }}>
        {hasImage ? (
          // next/image would gain us little here — the URL is per-signed
          // (it changes when the path/stamp changes) and the bytes are
          // already cache-friendly via the bucket's immutable
          // Cache-Control header + sessionStorage URL stability.
          //
          // width/height declare the image's intrinsic 4:3 ratio so the
          // browser's preload scanner can prioritize it before layout
          // resolves. Values match the upload downscale target in
          // lib/house-image/downscale.ts; the rendered size is still
          // driven by the parent's aspect-ratio + h-full w-full.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl ?? ""}
            alt={altText}
            width={1200}
            height={900}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : showSkeleton ? (
          <GeneratingIllustrationSkeleton />
        ) : (
          <PlaceholderImage ratio="4 / 3" label={altLabel} icon="home" />
        )}

        {uploading || removing ? (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-bg-base) 60%, transparent)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
            }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="animate-spin inline-flex"
              >
                <Icon name="refresh-cw" size={16} />
              </span>
              <span
                className="text-small"
                style={{ color: "var(--color-text-primary)" }}
              >
                {uploading ? "Uploading photo…" : "Removing photo…"}
              </span>
            </div>
          </div>
        ) : null}

        {showRegenerateOverlay ? (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerateDisabled}
            aria-label="Regenerate illustration"
            title={
              regenerating
                ? "Regenerating illustration…"
                : "Regenerate illustration"
            }
            className="btn btn-ghost btn-icon absolute bottom-2 right-2"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-bg-base) 70%, transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              opacity: regenerateDisabled ? 0.7 : 1,
            }}
          >
            <span
              aria-hidden
              className={regenerating ? "animate-spin" : undefined}
              style={{ display: "inline-flex" }}
            >
              <Icon name="refresh-cw" size={14} />
            </span>
          </button>
        ) : null}
      </div>
      <figcaption
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 sm:px-4 sm:py-2.5"
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-surface)",
        }}
      >
        {/*
          accept="image/*" gives mobile browsers a native picker that
          offers both Camera and Photo Library — no `capture` attribute
          is set, so the user can choose either path. Re-used by both
          "Upload" and "Replace" affordances via a ref-driven click.
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />
        {isUserPhoto ? (
          <>
            <p
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Your photo.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={openFilePicker}
                disabled={uploading || removing}
                className="text-small inline-flex items-center gap-1 underline underline-offset-2"
                style={{
                  color: "var(--color-text-secondary)",
                  opacity: uploading || removing ? 0.6 : 1,
                }}
              >
                <Icon name="upload" size={12} />
                Replace
              </button>
              <button
                type="button"
                onClick={onRemoveUserPhoto}
                disabled={uploading || removing}
                className="text-small inline-flex items-center gap-1 underline underline-offset-2"
                style={{
                  color: "var(--color-text-secondary)",
                  opacity: uploading || removing ? 0.6 : 1,
                }}
              >
                <Icon name="x" size={12} />
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Stylized illustration — not a photo of your home.
            </p>
            <button
              type="button"
              onClick={openFilePicker}
              disabled={uploading || removing}
              className="text-small inline-flex items-center gap-1 underline underline-offset-2"
              style={{
                color: "var(--color-text-secondary)",
                opacity: uploading || removing ? 0.6 : 1,
              }}
            >
              <Icon name="upload" size={12} />
              Upload your own photo
            </button>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function BriefingErrorBanner({ message }: { message: string | null }) {
  return (
    <div
      className="surface flex items-start gap-3 p-3 sm:p-4"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-danger) 10%, var(--color-bg-surface))",
        borderColor:
          "color-mix(in oklab, var(--color-danger) 28%, var(--color-border-subtle))",
      }}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 16%, transparent)",
          color: "var(--color-danger)",
        }}
      >
        <Icon name="alert-triangle" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          We had trouble pulling all the public data for your house.
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Use Refresh above to try again.
          {message ? (
            <>
              {" "}
              <span title={message}>{message}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * First-run discovery modal mount decision.
 *
 * The modal renders on the very first dashboard visit after onboarding —
 * specifically when both of these are true:
 *   1. house.briefing_generated_at IS NULL OR briefing is still
 *      pending / running (the briefing hasn't yet completed once).
 *   2. No completed habitat_findings rows exist for this house.
 *
 * The combination is sufficient — once either flips false, the modal is
 * gone for good even on subsequent visits / logout-login / refresh, which
 * is exactly the spec.
 *
 * sessionStorage acts as a belt-and-suspenders dismissal flag against
 * re-mount loops within a single tab; the data conditions remain the
 * source of truth. Returns `undefined` while we're still checking
 * habitat_findings — the modal mounts only once we've confirmed it
 * should — so a stale "no findings yet" race doesn't briefly flash the
 * modal for a returning user.
 */
function useFirstRunDiscoveryModal(house: House | null): {
  ready: boolean;
  show: boolean;
} {
  const [hasCompletedHabitatRows, setHasCompletedHabitatRows] = useState<
    boolean | null
  >(null);
  const [dismissedInSession, setDismissedInSession] = useState(false);

  // sessionStorage check has to live in an effect — it's client-only and
  // we're SSR-safe by default.
  useEffect(() => {
    if (!house) return;
    const flag = sessionStorage.getItem(
      `onboardingDiscoveryDismissed:${house.id}`,
    );
    if (flag === "1") setDismissedInSession(true);
  }, [house]);

  useEffect(() => {
    if (!house) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from("habitat_findings")
        .select("id", { count: "exact", head: true })
        .eq("house_id", house.id)
        .eq("status", "completed");
      if (cancelled) return;
      setHasCompletedHabitatRows((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [house]);

  if (!house) return { ready: false, show: false };
  if (hasCompletedHabitatRows === null) return { ready: false, show: false };
  if (dismissedInSession) return { ready: true, show: false };

  const briefingNotFinished =
    house.briefing_generated_at === null ||
    house.briefing_status === "pending" ||
    house.briefing_status === "running";

  const show = briefingNotFinished && !hasCompletedHabitatRows;
  return { ready: true, show };
}

export function DashboardLive({
  houseId,
  initialHouse,
}: {
  houseId: string;
  // Server-rendered snapshot of the house row. Seeding the hook with
  // this skips the client-side initial fetch and lets first paint be
  // the final dashboard layout — no "Loading your house" flicker. The
  // hook's Realtime subscription, polling fallback, and same-tab
  // refresh listener still run normally on top of the seed.
  initialHouse: House;
}) {
  const { house, loading, error, refetch } = useHouseRealtime(
    houseId,
    initialHouse,
  );
  const [isPending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [modalManuallyDismissed, setModalManuallyDismissed] = useState(false);
  const firstRun = useFirstRunDiscoveryModal(house);

  // The image surface shows the user's uploaded photo when one exists,
  // and falls back to the generated illustration. Either way the
  // dashboard fetches a signed URL for the active bucket+path, keyed by
  // a stamp (uploaded_at or generated_at) so a replace / regenerate
  // forces a refetch.
  const userImagePath = house?.user_image_url ?? null;
  const userImageStamp = house?.user_image_uploaded_at ?? null;
  const generatedImagePath = house?.generated_image_url ?? null;
  const generatedImageStamp = house?.generated_image_created_at ?? null;
  const isUserPhoto = userImagePath !== null;
  const activeBucket: CachedSignedUrlBucket = isUserPhoto
    ? "house-photos"
    : "house-images";
  const activePath = isUserPhoto ? userImagePath : generatedImagePath;
  const activeStamp = isUserPhoto ? userImageStamp : generatedImageStamp;

  // Signed URL for whichever image is active. Stored as a
  // (bucket, path, stamp, url) tuple so a stale URL (any field doesn't
  // match the current row) never renders. The createCachedSignedUrl
  // helper itself caches per (bucket, path, stamp) in sessionStorage,
  // so nav-away-and-back reuses the same URL and the browser HTTP
  // cache actually hits.
  const [imageUrlEntry, setImageUrlEntry] = useState<{
    bucket: CachedSignedUrlBucket;
    path: string;
    stamp: string | null;
    url: string;
  } | null>(null);
  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const url = await createCachedSignedUrl(
        supabase,
        activeBucket,
        activePath,
        activeStamp,
      );
      if (cancelled || !url) return;
      setImageUrlEntry({
        bucket: activeBucket,
        path: activePath,
        stamp: activeStamp,
        url,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBucket, activePath, activeStamp]);
  const imageUrl =
    imageUrlEntry &&
    imageUrlEntry.bucket === activeBucket &&
    imageUrlEntry.path === activePath &&
    imageUrlEntry.stamp === activeStamp
      ? imageUrlEntry.url
      : null;

  // "Briefing just finished" — true for IMAGE_GENERATION_GRACE_MS after
  // briefing_generated_at lands, which is the window during which we
  // expect the image step to be running. Driven by a timer so the value
  // updates without an impure Date.now() call during render.
  const briefingGeneratedAt = house?.briefing_generated_at ?? null;
  const [briefingJustFinished, setBriefingJustFinished] = useState(false);
  useEffect(() => {
    if (!briefingGeneratedAt) {
      setBriefingJustFinished(false);
      return;
    }
    const elapsed = Date.now() - new Date(briefingGeneratedAt).getTime();
    if (elapsed >= IMAGE_GENERATION_GRACE_MS) {
      setBriefingJustFinished(false);
      return;
    }
    setBriefingJustFinished(true);
    const remaining = IMAGE_GENERATION_GRACE_MS - elapsed;
    const t = setTimeout(() => setBriefingJustFinished(false), remaining);
    return () => clearTimeout(t);
  }, [briefingGeneratedAt]);

  // Regenerate state. We snapshot the generated_image_created_at at
  // click time so we can detect when the realtime row advances past it
  // — that's the moment we know the new image landed and we can drop
  // the "regenerating" indicator. The transition handles the in-flight
  // span of the server action call itself.
  const [isRegeneratePending, startRegenerateTransition] = useTransition();
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateSnapshot, setRegenerateSnapshot] = useState<string | null>(
    null,
  );
  const regenerateRowStamp = house?.generated_image_created_at ?? null;
  useEffect(() => {
    if (regenerateSnapshot === null) return;
    // Row stamp moved past the snapshot — the new image landed and we
    // can clear the "regenerating" indicator. This is the legitimate
    // "synchronize with external system (row updated)" pattern that
    // useEffect+setState exists for.
    if (regenerateRowStamp && regenerateRowStamp !== regenerateSnapshot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegenerateSnapshot(null);
    }
  }, [regenerateRowStamp, regenerateSnapshot]);
  const regenerating = isRegeneratePending || regenerateSnapshot !== null;
  function handleRegenerate() {
    if (!house) return;
    setRegenerateError(null);
    setRegenerateSnapshot(house.generated_image_created_at);
    startRegenerateTransition(async () => {
      const result = await regenerateHouseImage(houseId);
      if (!result.ok) {
        setRegenerateError(result.error);
        setRegenerateSnapshot(null);
      }
    });
  }

  // Drive the image swap even when Realtime is dead. The hook's status-
  // based polling fallback only activates while briefing_status is non-
  // terminal — regenerate doesn't touch briefing_status, so nothing
  // would otherwise pick up the new generated_image_created_at on a
  // browser blocking the realtime websocket. Mirrors the briefing-
  // refresh polling loop. Bounded so a stuck workflow doesn't pin the
  // spinner forever.
  useEffect(() => {
    if (regenerateSnapshot === null) return;

    const startTime = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      if (Date.now() - startTime > REFRESH_POLL_TIMEOUT_MS) {
        setRegenerateError(
          "Regeneration is taking longer than expected. You can try again.",
        );
        setRegenerateSnapshot(null);
        return;
      }
      await refetch();
      if (cancelled) return;
      timer = setTimeout(tick, REFRESH_POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, 800);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [regenerateSnapshot, refetch]);

  // User-photo upload + remove state. We do the storage upload from the
  // browser via the RLS-bound client and follow with the
  // hearth.houses UPDATE in the same handler. RLS on storage.objects
  // and hearth.houses is the load-bearing ownership check; nothing
  // here trusts the browser to identify the user.
  const [imageActionState, setImageActionState] = useState<
    "idle" | "uploading" | "removing"
  >("idle");
  const [imageError, setImageError] = useState<string | null>(null);

  async function handleUploadFile(file: File) {
    setImageError(null);
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setImageError(
        `Photo is too large — please choose one under ${MAX_UPLOAD_MB} MB.`,
      );
      return;
    }
    setImageActionState("uploading");
    try {
      const supabase = createClient();
      const path = `${houseId}/${USER_PHOTO_PATH}`;
      const { blob, contentType } = await downscaleImage(file);
      const { error: uploadError } = await supabase.storage
        .from("house-photos")
        .upload(path, blob, {
          contentType,
          upsert: true,
          cacheControl: HOUSE_IMAGE_CACHE_CONTROL,
        });
      if (uploadError) {
        setImageError(
          uploadError.message ||
            "We couldn't upload that photo. Please try again.",
        );
        return;
      }
      const uploadedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("houses")
        .update({
          user_image_url: path,
          user_image_uploaded_at: uploadedAt,
        })
        .eq("id", houseId);
      if (updateError) {
        setImageError(
          "Your photo uploaded but we couldn't save it on your house. Try again.",
        );
        return;
      }
      await refetch();
    } catch (err) {
      console.error("user photo upload failed", err);
      setImageError("Something went wrong uploading your photo. Try again.");
    } finally {
      setImageActionState("idle");
    }
  }

  async function handleRemoveUserPhoto() {
    if (!house?.user_image_url) return;
    setImageError(null);
    setImageActionState("removing");
    try {
      const supabase = createClient();
      // Storage delete is best-effort — the hearth.houses UPDATE is
      // the authoritative "stop pointing at this photo" signal. If
      // delete fails we still clear the row so the UI reverts.
      await supabase.storage
        .from("house-photos")
        .remove([house.user_image_url]);
      const { error: updateError } = await supabase
        .from("houses")
        .update({ user_image_url: null, user_image_uploaded_at: null })
        .eq("id", houseId);
      if (updateError) {
        setImageError("We couldn't remove your photo. Try again.");
        return;
      }
      await refetch();
    } catch (err) {
      console.error("user photo remove failed", err);
      setImageError("Something went wrong removing your photo. Try again.");
    } finally {
      setImageActionState("idle");
    }
  }

  // Same polling-fallback story for the first-time generation. Once the
  // briefing flips to 'completed', the hook's status-based polling shuts
  // off — but the image step is still running for another 10-30s, and a
  // browser with a blocked Realtime socket would otherwise not pick up
  // the row's eventual generated_image_url stamp. Polls while we're in
  // the post-briefing grace window AND no image has landed yet; the
  // briefingJustFinished timer naturally stops this when the window
  // expires, and the image landing flips the condition false the moment
  // a refetch() returns the populated row.
  const isAwaitingFirstImage =
    briefingJustFinished && generatedImagePath === null;
  useEffect(() => {
    if (!isAwaitingFirstImage) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      if (cancelled) return;
      await refetch();
      if (cancelled) return;
      timer = setTimeout(tick, REFRESH_POLL_INTERVAL_MS);
    }
    timer = setTimeout(tick, 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAwaitingFirstImage, refetch]);

  // One-shot latch for the discovery modal. The first-run detection in
  // useFirstRunDiscoveryModal computes `show` from live data conditions —
  // but those conditions flip false the moment the briefing workflow
  // completes (briefing_generated_at gets set in the same write that
  // marks status='completed'), which would unmount the modal mid-narration
  // and never let the user see the radon line or click the button. The
  // data conditions are the right gate for "should this open?" but once
  // open, the button is the only thing that closes it (per spec).
  const [hasOpenedDiscoveryModal, setHasOpenedDiscoveryModal] = useState(false);
  useEffect(() => {
    if (firstRun.ready && firstRun.show) setHasOpenedDiscoveryModal(true);
  }, [firstRun.ready, firstRun.show]);
  // Snapshot of the row at click time, kept until the workflow reaches a
  // terminal state so we can diff before vs after and tell the user what
  // the refresh actually changed. We also capture briefing_generated_at
  // so we can tell "the workflow has actually completed a new run" apart
  // from "briefing_status is still 'completed' from the previous run."
  // Without that guard the effect below would fire immediately on click.
  const [pendingRefresh, setPendingRefresh] = useState<{
    snapshot: MergeableHouseFacts;
    generatedAt: string | null;
  } | null>(null);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);

  // Refresh is "in flight" while we're waiting for a new run to finish OR
  // the realtime row currently shows a non-terminal status. pendingRefresh
  // is the authoritative signal for "we clicked Refresh and haven't seen
  // it complete yet" — using it (instead of only briefingInFlight) means
  // the spinner stays on even if Realtime is blocked and we haven't yet
  // observed the status flip to 'running'.
  const briefingInFlight =
    house?.briefing_status === "running" ||
    house?.briefing_status === "pending";
  const refreshing = isPending || briefingInFlight || pendingRefresh !== null;

  function handleRefresh() {
    if (!house) return;
    setRefreshError(null);
    setSummary(null);
    setPendingRefresh({
      snapshot: snapshotFacts(house),
      generatedAt: house.briefing_generated_at,
    });
    startTransition(async () => {
      const result = await refreshBriefing(houseId);
      if (!result.ok) {
        setRefreshError(result.error);
        // The workflow never started, so there's nothing to diff against.
        setPendingRefresh(null);
      }
    });
  }

  // Watch for the workflow reaching a terminal state. On 'completed', diff
  // the snapshot we captured at click time against the current row and
  // surface a summary — but only when briefing_generated_at has actually
  // moved forward, so the click itself doesn't fire the summary against
  // the still-stale 'completed' from the previous run. On 'failed', drop
  // the snapshot — the failed banner already covers the error case.
  useEffect(() => {
    if (!house || !pendingRefresh) return;
    if (house.briefing_status === "completed") {
      if (house.briefing_generated_at === pendingRefresh.generatedAt) return;
      const changes = diffHouseFacts(
        pendingRefresh.snapshot,
        snapshotFacts(house),
      );
      setSummary(
        changes.length > 0
          ? { kind: "updated", fields: changes }
          : { kind: "nothing_new" },
      );
      setPendingRefresh(null);
    } else if (house.briefing_status === "failed") {
      setPendingRefresh(null);
    }
  }, [house, pendingRefresh]);

  // Drive the page through a manual refresh even when Realtime is dead.
  // The hook's own status-based polling can't help here because at click
  // time the row still shows briefing_status='completed' from the previous
  // run, so the hook has nothing to react to. We poll aggressively for the
  // whole pending-refresh window, which (a) discovers the transition to
  // 'running' so briefingInFlight flips and skeletons appear, and (b)
  // discovers the eventual transition back to 'completed' with a fresh
  // generated_at, which is what fires the summary banner.
  //
  // Bounded at REFRESH_POLL_TIMEOUT_MS so a stuck workflow can't pin the
  // spinner forever — on timeout we surface a soft error and let the user
  // try again.
  useEffect(() => {
    if (!pendingRefresh) return;

    const start = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      if (Date.now() - start > REFRESH_POLL_TIMEOUT_MS) {
        setRefreshError(
          "Refresh is taking longer than expected. You can try again.",
        );
        setPendingRefresh(null);
        return;
      }
      await refetch();
      if (cancelled) return;
      timer = setTimeout(tick, REFRESH_POLL_INTERVAL_MS);
    }

    // Fire the first poll quickly — the workflow's startBriefing step
    // typically flips status within a second or two and we want the
    // skeletons to appear without a long visual lag.
    timer = setTimeout(tick, 800);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingRefresh, refetch]);

  if (loading) {
    return (
      <div className="surface p-6">
        <div className="eyebrow mb-2">Loading your house</div>
        <div
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          One moment…
        </div>
      </div>
    );
  }

  if (error || !house) {
    return (
      <div
        className="surface p-6"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
        }}
      >
        <div className="eyebrow mb-2">Couldn&apos;t load your house</div>
        <div
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {error ?? "House not found."}
        </div>
      </div>
    );
  }

  const facts = buildFacts(house);
  const status = house.briefing_status;

  function handleDiscoveryModalDismiss() {
    // sessionStorage is a re-mount safety net — the data conditions stay
    // the source of truth, but we want a freshly mounted DashboardLive
    // (e.g. fast nav back) to not flash the modal back open between
    // when the user clicks Start and when the habitat row reads land.
    try {
      sessionStorage.setItem(`onboardingDiscoveryDismissed:${houseId}`, "1");
    } catch {
      // sessionStorage can throw in incognito with quota disabled; the
      // local state alone still hides the modal for the current view.
    }
    setModalManuallyDismissed(true);
  }

  // Mount the modal iff we've ever opened it AND the user hasn't yet
  // clicked Start Managing my Home. Live data-condition changes do not
  // close it — see hasOpenedDiscoveryModal above.
  const showDiscoveryModal = hasOpenedDiscoveryModal && !modalManuallyDismissed;

  return (
    <>
      <section className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <HouseImageSurface
            house={house}
            imageUrl={imageUrl}
            isUserPhoto={isUserPhoto}
            briefingJustFinished={briefingJustFinished}
            regenerating={regenerating}
            regenerateDisabled={
              regenerating || isPending || imageActionState !== "idle"
            }
            onRegenerate={handleRegenerate}
            onSelectFile={handleUploadFile}
            onRemoveUserPhoto={handleRemoveUserPhoto}
            uploading={imageActionState === "uploading"}
            removing={imageActionState === "removing"}
          />
          {imageError ? (
            <div
              className="text-small"
              style={{ color: "var(--color-danger)" }}
              role="status"
            >
              {imageError}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          {summary ? (
            <RefreshSummaryBanner
              summary={summary}
              onDismiss={() => setSummary(null)}
            />
          ) : null}

          <HeroAddress
            house={house}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />

          {status === "failed" ? (
            <BriefingErrorBanner message={house.briefing_error} />
          ) : null}

          {refreshError ? (
            <div
              className="text-small"
              style={{ color: "var(--color-danger)" }}
              role="status"
            >
              {refreshError}
            </div>
          ) : null}

          {regenerateError ? (
            <div
              className="text-small"
              style={{ color: "var(--color-danger)" }}
              role="status"
            >
              {regenerateError}
            </div>
          ) : null}

          <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-3">
            {facts.map((f) => (
              <MetricCard
                key={f.eyebrow}
                eyebrow={f.eyebrow}
                icon={f.icon}
                value={<FactValue value={f.value} status={status} />}
                meta={
                  <FactMeta
                    meta={f.meta}
                    hasValue={f.value !== null}
                    status={status}
                  />
                }
              />
            ))}
          </div>

          {house.description ? (
            <AICard eyebrow="About your house">{house.description}</AICard>
          ) : status === "running" || status === "pending" ? (
            <div
              className="surface p-4 text-small flex items-center gap-2"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
              Discovering details about your house…
            </div>
          ) : null}
        </div>
      </section>
      {showDiscoveryModal ? (
        <OnboardingDiscoveryModal
          house={house}
          onDismiss={handleDiscoveryModalDismiss}
        />
      ) : null}
    </>
  );
}
