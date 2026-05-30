"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useHouseRealtime } from "@/lib/hooks/use-house-realtime";
import {
  EditHomeDetailsModal,
  type EditableHouseRow,
} from "@/components/edit-home-details-modal";
import { Icon, type IconName } from "@/components/icon";
import { StaticHouseIllustration } from "@/components/static-house-illustration";
import { Toast } from "@/components/toast";
import { MetricCard } from "@/components/ui";
import { downscaleImage } from "@/lib/house-image/downscale";
import {
  createCachedSignedUrl,
  HOUSE_IMAGE_CACHE_CONTROL,
} from "@/lib/house-image/signed-url";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";
import { refreshBriefing } from "./actions";
import { OnboardingDiscoveryModal } from "./onboarding-discovery-modal";

// 15 MB. Modern phone photos can hit 8-12 MB, so this gives headroom
// for the original file. We downscale to ~1200 px wide and re-encode
// as JPEG before uploading (see lib/house-image/downscale), so the
// bytes that actually leave the browser are typically a few hundred KB.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_MB = 15;
const USER_PHOTO_PATH = "photo";

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

function formatBedroomCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatBedroomsBathroomsMeta(
  bedrooms: number | null,
  bathrooms: number | null,
): string | null {
  const parts: string[] = [];
  if (bedrooms !== null) parts.push(`${formatBedroomCount(bedrooms)}BR`);
  if (bathrooms !== null) parts.push(`${formatBedroomCount(bathrooms)}BA`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatLivingArea(
  sqft: number | null,
  bedrooms: number | null,
  bathrooms: number | null,
): HouseFact {
  const meta = formatBedroomsBathroomsMeta(bedrooms, bathrooms);
  if (sqft === null)
    return { eyebrow: "Living area", icon: "ruler", value: null, meta };
  return {
    eyebrow: "Living area",
    icon: "ruler",
    value: `${formatNumber(sqft)} sf`,
    meta,
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

function buildFacts(house: House): HouseFact[] {
  return [
    formatBuilt(house.year_built),
    formatLivingArea(house.living_area_sqft, house.bedrooms, house.bathrooms),
    formatLot(house.lot_size_sqft),
  ];
}

function HeroAddress({
  house,
  onRefresh,
  refreshing,
  onEdit,
  editTriggerRef,
}: {
  house: House;
  onRefresh: () => void;
  refreshing: boolean;
  onEdit: () => void;
  editTriggerRef: React.RefObject<HTMLButtonElement | null>;
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
      <div className="flex items-center gap-2 shrink-0">
        <EditPropertyButton onClick={onEdit} triggerRef={editTriggerRef} />
        <RefreshBriefingButton onClick={onRefresh} refreshing={refreshing} />
      </div>
    </div>
  );
}

/**
 * Icon-only pencil button that opens the Property Details edit modal.
 * Lives inline with the address row to keep editing one tap away from
 * the surface that displays the value — moved here from the account
 * dropdown per issue #110 (the dropdown is for account-scoped actions;
 * editing property details is direct manipulation of the current
 * property).
 *
 * The `btn-icon` class gives a 36px square; combined with the .btn
 * height (≥36px) this clears the 44px tap-target guideline on touch
 * devices when the user's font scaling is applied, while staying
 * visually balanced next to RefreshBriefingButton on desktop.
 */
function EditPropertyButton({
  onClick,
  triggerRef,
}: {
  onClick: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onClick}
      aria-label="Edit property details"
      title="Edit property details"
      className="btn btn-ghost btn-icon"
    >
      <Icon name="edit" size={14} />
    </button>
  );
}

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
 * Metric value. With Zillow-backed briefing removed (issue #210) these
 * cards no longer pulse a skeleton waiting on a workflow — facts now
 * arrive only from the home-details edit modal, so the empty state IS
 * the default and renders as a tertiary em-dash until the user fills
 * the field in.
 */
function FactValue({ value }: { value: string | null }) {
  if (value !== null) return <span>{value}</span>;
  return <span style={{ color: "var(--color-text-tertiary)" }}>{EMPTY}</span>;
}

function FactMeta({
  meta,
  hasValue,
}: {
  meta: string | null | undefined;
  hasValue: boolean;
}) {
  if (meta) return <>{meta}</>;
  if (!hasValue) return <>Add via edit</>;
  return null;
}

/**
 * The hero image surface. Renders one of two states:
 *   - The user-uploaded photo when `imageUrl` is non-null (we only fetch
 *     a signed URL for the user-photo bucket; the figcaption reads
 *     "Your photo." and surfaces Replace / Remove affordances).
 *   - The static SVG illustration otherwise, with the load-bearing
 *     "Stylized illustration — not a photo of your home." disclaimer
 *     and a prominent "Upload your own photo" CTA.
 *
 * Issue #210 removed the AI-generated architectural sketch. The disclaimer
 * still has to be present whenever the illustration is on screen because
 * the SVG is intentionally generic and does NOT depict the user's actual
 * home — the contract is the same as it was with the generated sketch.
 */
function HouseImageSurface({
  imageUrl,
  isUserPhoto,
  onSelectFile,
  onRemoveUserPhoto,
  uploading,
  removing,
}: {
  imageUrl: string | null;
  isUserPhoto: boolean;
  onSelectFile: (file: File) => void;
  onRemoveUserPhoto: () => void;
  uploading: boolean;
  removing: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so re-selecting the same file fires onChange.
    e.target.value = "";
    if (file) onSelectFile(file);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return (
    <figure className="surface overflow-hidden flex flex-col">
      <div className="relative" style={{ aspectRatio: "4 / 3" }}>
        {isUserPhoto ? (
          imageUrl ? (
            // next/image would gain us little here — the URL is per-signed
            // (it changes when the path/stamp changes) and the bytes are
            // already cache-friendly via the bucket's immutable
            // Cache-Control header + sessionStorage URL stability.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Photo of your home"
              width={1200}
              height={900}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            // Photo IS on the row but the signed URL hasn't resolved
            // client-side yet (SSR / first paint pre-effect). Render a
            // neutral surface — NOT the SVG — so the user doesn't see
            // a stylized illustration of a different house flash in
            // and immediately swap out for their actual photo.
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundColor: "var(--color-bg-surface)" }}
            />
          )
        ) : (
          <StaticHouseIllustration />
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
              <span aria-hidden className="animate-spin inline-flex">
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
              className="btn btn-primary"
              style={{
                opacity: uploading || removing ? 0.6 : 1,
              }}
            >
              <Icon name="upload" size={14} />
              Upload your own photo
            </button>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * First-run discovery modal mount decision.
 *
 * The modal renders on the very first dashboard visit after onboarding —
 * specifically when no habitat_findings rows exist for this house at all.
 * Once any row exists, the modal is gone for good. Issue #210 removed the
 * briefing_status condition that used to gate this — the Zillow-backed
 * briefing pipeline is gone, so habitat row existence is the only signal
 * we still need.
 *
 * The probe checks "any row exists" rather than "any *completed* row
 * exists." The habitat orchestrator's per-module step upserts each row
 * with `status='running'` before the check itself runs, so during a
 * Refresh run every habitat row briefly transitions
 * completed → running → completed. Filtering by `status='completed'`
 * would flip the probe to false in that window and re-open the
 * onboarding modal on top of the refresh modal. "Any row exists" is the
 * right signal: once the orchestrator has *ever* run for this house,
 * rows exist and the user is not a first-run user.
 *
 * sessionStorage acts as a belt-and-suspenders dismissal flag against
 * re-mount loops within a single tab; habitat row existence is still
 * the source of truth. Returns `ready: false` while we're still
 * checking habitat_findings — the modal mounts only once we've
 * confirmed it should — so a stale "no findings yet" race doesn't
 * briefly flash the modal for a returning user.
 */
function useFirstRunDiscoveryModal(house: House | null): {
  ready: boolean;
  show: boolean;
} {
  const [hasHabitatRows, setHasHabitatRows] = useState<boolean | null>(null);
  const [dismissedInSession, setDismissedInSession] = useState(false);
  const houseId = house?.id ?? null;

  useEffect(() => {
    if (!houseId) return;
    const flag = sessionStorage.getItem(
      `onboardingDiscoveryDismissed:${houseId}`,
    );
    if (flag === "1") setDismissedInSession(true);
  }, [houseId]);

  useEffect(() => {
    if (!houseId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from("habitat_findings")
        .select("id", { count: "exact", head: true })
        .eq("house_id", houseId);
      if (cancelled) return;
      setHasHabitatRows((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  if (!house) return { ready: false, show: false };
  if (hasHabitatRows === null) return { ready: false, show: false };
  if (dismissedInSession) return { ready: true, show: false };

  return { ready: true, show: !hasHabitatRows };
}

export function DashboardLive({
  houseId,
  initialHouse,
  lifecycleOutlookSlot,
}: {
  houseId: string;
  // Server-rendered snapshot of the house row. Seeding the hook with
  // this skips the client-side initial fetch and lets first paint be
  // the final dashboard layout — no "Loading your house" flicker. The
  // hook's Realtime subscription and same-tab refresh listener still
  // run normally on top of the seed.
  initialHouse: House;
  // Server-rendered lifecycle outlook panel (issue #212), passed in as a
  // ReactNode slot from page.tsx. DashboardLive is a client component, so
  // the panel — which runs a server Supabase query — is rendered on the
  // server and handed down rather than fetched inside the client tree.
  // Same server-component-inside-client pattern the inventory detail page
  // uses for its maintenance panel slot.
  lifecycleOutlookSlot?: React.ReactNode;
}) {
  const { house, loading, error, refetch } = useHouseRealtime(
    houseId,
    initialHouse,
  );
  const [isPending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [modalManuallyDismissed, setModalManuallyDismissed] = useState(false);
  const firstRun = useFirstRunDiscoveryModal(house);

  // Property Details edit modal — opened from the pencil button next
  // to the address. The delete-property flow lives inside this modal's
  // danger zone; on a failed delete the modal closes itself and
  // bubbles the error up via `setDeleteToast` so the user lands back
  // on the dashboard with a top-center toast.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  // The image surface shows the user's uploaded photo when one exists,
  // and falls back to the static SVG illustration otherwise (issue #210
  // dropped the AI-generated sketch). We only need to resolve a signed
  // URL when there is a user photo — the SVG is inline and stamp-free.
  const userImagePath = house?.user_image_url ?? null;
  const userImageStamp = house?.user_image_uploaded_at ?? null;
  const isUserPhoto = userImagePath !== null;

  const [imageUrlEntry, setImageUrlEntry] = useState<{
    path: string;
    stamp: string | null;
    url: string;
  } | null>(null);
  useEffect(() => {
    if (!userImagePath) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const url = await createCachedSignedUrl(
        supabase,
        "house-photos",
        userImagePath,
        userImageStamp,
      );
      if (cancelled || !url) return;
      setImageUrlEntry({
        path: userImagePath,
        stamp: userImageStamp,
        url,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userImagePath, userImageStamp]);
  const imageUrl =
    imageUrlEntry &&
    imageUrlEntry.path === userImagePath &&
    imageUrlEntry.stamp === userImageStamp
      ? imageUrlEntry.url
      : null;

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

  // One-shot latch for the discovery modal. The first-run detection in
  // useFirstRunDiscoveryModal computes `show` from live data conditions —
  // those conditions flip false the moment the habitat orchestrator
  // writes its first row, which would unmount the modal mid-narration and
  // never let the user see the radon line or click the button. The data
  // conditions are the right gate for "should this open?" but once open,
  // the button is the only thing that closes it (per spec).
  const [hasOpenedDiscoveryModal, setHasOpenedDiscoveryModal] = useState(false);
  useEffect(() => {
    if (firstRun.ready && firstRun.show) setHasOpenedDiscoveryModal(true);
  }, [firstRun.ready, firstRun.show]);

  // Click-time baseline for the refresh-mode discovery modal. Non-null
  // when the modal should mount; cleared when the user dismisses or
  // the refresh action errors. The modal compares habitat-finding
  // `checked_at` timestamps against this baseline to know "this is
  // the new run that just started" vs. "the previous run's terminal
  // status."
  const [refreshModalSessionStartedAt, setRefreshModalSessionStartedAt] =
    useState<string | null>(null);

  // The refresh modal is the user-facing "this is in progress" signal
  // once it mounts — keep the button disabled while it's open so a
  // double-click can't fire a second refresh on top of the first.
  const refreshing = isPending || refreshModalSessionStartedAt !== null;

  function handleRefresh() {
    if (!house) return;
    setRefreshError(null);
    // Capture the click timestamp BEFORE firing the action. The
    // discovery modal in refresh mode uses this as its baseline to
    // tell "this is the new run that just started" apart from "the
    // previous run's still-terminal habitat findings."
    setRefreshModalSessionStartedAt(new Date().toISOString());
    startTransition(async () => {
      const result = await refreshBriefing(houseId);
      if (!result.ok) {
        setRefreshError(result.error);
        // Action never started — tear down the modal, nothing to wait on.
        setRefreshModalSessionStartedAt(null);
      }
    });
  }

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
        {/* min-w-0 on grid items: see comment in app/(app)/dashboard/page.tsx. */}
        <div className="flex flex-col gap-2 min-w-0">
          <HouseImageSurface
            imageUrl={imageUrl}
            isUserPhoto={isUserPhoto}
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
        <div className="flex flex-col gap-3 min-w-0">
          <HeroAddress
            house={house}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            onEdit={() => setEditOpen(true)}
            editTriggerRef={editTriggerRef}
          />

          {refreshError ? (
            <div
              className="text-small"
              style={{ color: "var(--color-danger)" }}
              role="status"
            >
              {refreshError}
            </div>
          ) : null}

          <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-3">
            {facts.map((f) => (
              <MetricCard
                key={f.eyebrow}
                eyebrow={f.eyebrow}
                icon={f.icon}
                value={<FactValue value={f.value} />}
                meta={<FactMeta meta={f.meta} hasValue={f.value !== null} />}
              />
            ))}
          </div>

          {/*
            Lifecycle outlook fills the dead space the removed Zillow
            description left beneath the facts cards (issue #212). It's a
            server-rendered slot — see the prop comment above.
          */}
          {lifecycleOutlookSlot}
        </div>
      </section>
      {showDiscoveryModal ? (
        <OnboardingDiscoveryModal
          house={house}
          onDismiss={handleDiscoveryModalDismiss}
        />
      ) : null}

      {refreshModalSessionStartedAt ? (
        <OnboardingDiscoveryModal
          house={house}
          mode="refresh"
          sessionStartedAt={refreshModalSessionStartedAt}
          onDismiss={() => setRefreshModalSessionStartedAt(null)}
        />
      ) : null}

      {editOpen ? (
        <EditHomeDetailsModal
          open
          house={toEditableHouseRow(house)}
          onClose={() => setEditOpen(false)}
          onDeleteError={(message) => setDeleteToast(message)}
          getReturnFocusElement={() => editTriggerRef.current}
        />
      ) : null}

      {deleteToast ? (
        <Toast
          message={deleteToast}
          icon="alert-triangle"
          onClose={() => setDeleteToast(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Project the live House row into the narrower shape EditHomeDetailsModal
 * expects. Inline rather than going through a hand-cast so excess
 * fields on `House` (briefing lifecycle, generated-image columns, etc.)
 * don't leak into the modal's prop surface — keeps the modal's contract
 * with its callers tight.
 */
function toEditableHouseRow(house: House): EditableHouseRow {
  return {
    id: house.id,
    address_line1: house.address_line1,
    address_line2: house.address_line2,
    city: house.city,
    state: house.state,
    postal_code: house.postal_code,
    year_built: house.year_built,
    living_area_sqft: house.living_area_sqft,
    lot_size_sqft: house.lot_size_sqft,
    bedrooms: house.bedrooms,
    bathrooms: house.bathrooms,
    purchase_date: house.purchase_date,
    water_source: house.water_source,
    basement_present: house.basement_present,
  };
}
