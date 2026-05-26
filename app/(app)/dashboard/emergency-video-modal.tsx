"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteEmergencyVideoAction } from "@/app/actions/documents/delete-emergency-video";
import { promoteEmergencyVideoAction } from "@/app/actions/documents/promote-emergency-video";
import { updateEmergencyVideoAction } from "@/app/actions/documents/update-emergency-video";
import { Icon } from "@/components/icon";
import { VideoPlayer } from "@/components/video-player";
import { formatVideoDuration } from "@/lib/documents/emergency-categories";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import type {
  EmergencyReferenceCategoryGroup,
  EmergencyVideoSummary,
} from "./emergency-reference-panel.client";

/**
 * Modal for playing an emergency-procedure-video and managing the
 * other videos in the same category (issue #139). Full-screen on
 * mobile, centred modal on desktop.
 *
 * Mounts the custom <VideoPlayer>. The secondary-strip switches the
 * player to a different video on tap. The per-video menu surfaces
 * Promote / Edit label / Edit notes / Delete actions.
 */

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

type EditMode =
  | { kind: "view" }
  | { kind: "edit-label"; value: string }
  | { kind: "edit-notes"; value: string };

export function EmergencyVideoModal({
  group,
  initialVideoId,
  onClose,
}: {
  group: EmergencyReferenceCategoryGroup;
  initialVideoId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const [activeId, setActiveId] = useState(initialVideoId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active =
    group.videos.find((v) => v.id === activeId) ?? group.videos[0];
  const isPrimary = active?.isPrimary ?? false;
  const requiresLabel = group.category === "other";

  // Signed URLs for the active video + poster. Cached by path in
  // sessionStorage so navigating between videos in the same modal
  // session reuses URLs and the bytes hit the browser cache. stamp=null
  // because path includes the documentId which is the version key.
  const videoUrl = useCachedSignedUrl(
    "hearth-emergency-videos",
    active?.storagePath ?? null,
    null,
  );
  const posterUrl = useCachedSignedUrl(
    "hearth-emergency-videos",
    active?.posterStoragePath ?? null,
    null,
  );

  // Modal mechanics: scroll-lock, focus trap, ESC.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");

    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (
          e.shiftKey &&
          (activeEl === first || !dialogRef.current.contains(activeEl))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
    };
  }, [onClose]);

  const refreshAfterMutation = useCallback(() => {
    // Server action's revalidatePath('/dashboard') marks the cache;
    // router.refresh pulls the new server-component render into the
    // current view so the panel reflects the change immediately.
    router.refresh();
  }, [router]);

  const handlePromote = useCallback(async () => {
    if (!active || isPrimary || busy) return;
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    const result = await promoteEmergencyVideoAction({
      documentId: active.id,
    });
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    refreshAfterMutation();
  }, [active, isPrimary, busy, refreshAfterMutation]);

  const handleSaveEdit = useCallback(async () => {
    if (!active || editMode.kind === "view" || busy) return;
    if (
      editMode.kind === "edit-label" &&
      requiresLabel &&
      !editMode.value.trim()
    ) {
      setError("Label is required for 'Other' category videos.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload =
      editMode.kind === "edit-label"
        ? { documentId: active.id, label: editMode.value }
        : { documentId: active.id, notes: editMode.value };
    const result = await updateEmergencyVideoAction(payload);
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setEditMode({ kind: "view" });
    refreshAfterMutation();
  }, [active, editMode, requiresLabel, busy, refreshAfterMutation]);

  const handleDelete = useCallback(async () => {
    if (!active || busy) return;
    const confirmed = window.confirm(
      "Delete this video? This can't be undone.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    const result = await deleteEmergencyVideoAction({
      documentId: active.id,
    });
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    // If there's another video in the category, switch to it before
    // refresh so the user lands on something. Otherwise close.
    const remaining = group.videos.filter((v) => v.id !== active.id);
    if (remaining.length > 0) {
      setActiveId(remaining[0].id);
      refreshAfterMutation();
    } else {
      refreshAfterMutation();
      onClose();
    }
  }, [active, busy, group.videos, refreshAfterMutation, onClose]);

  if (!active) {
    // Defensive — group could become empty between render and a
    // delete that propagates through router.refresh. Close instead
    // of rendering an empty modal shell.
    onClose();
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 85%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="surface relative w-full sm:max-w-2xl sm:h-auto max-h-[100dvh] sm:max-h-[92dvh] flex flex-col overflow-hidden"
        style={{
          borderRadius: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">{group.meta.label} emergency</div>
            <h2 id={titleId} className="h3" style={{ marginTop: 0 }}>
              {active.label || `${group.meta.label} emergency`}
            </h2>
            <div
              className="text-small mt-1 flex items-center gap-2"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {isPrimary ? (
                <span className="inline-flex items-center gap-1">
                  <Icon name="star" size={12} />
                  Primary
                </span>
              ) : (
                <span>Secondary</span>
              )}
              {active.durationSeconds != null &&
              active.durationSeconds > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {formatVideoDuration(active.durationSeconds)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="relative flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="btn btn-ghost btn-icon"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
            >
              <Icon name="dots-vertical" size={18} />
            </button>
            {menuOpen ? (
              <PerVideoMenu
                isPrimary={isPrimary}
                onPromote={handlePromote}
                onEditLabel={() => {
                  setEditMode({
                    kind: "edit-label",
                    value: active.label ?? "",
                  });
                  setMenuOpen(false);
                }}
                onEditNotes={() => {
                  setEditMode({
                    kind: "edit-notes",
                    value: active.notes ?? "",
                  });
                  setMenuOpen(false);
                }}
                onDelete={handleDelete}
                onClose={() => setMenuOpen(false)}
              />
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon"
              aria-label="Close"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 flex-1">
          {videoUrl ? (
            <VideoPlayer src={videoUrl} poster={posterUrl} />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                aspectRatio: "16 / 9",
                backgroundColor: "#000",
                borderRadius: "var(--radius-lg)",
                color: "color-mix(in oklab, #fff 75%, transparent)",
              }}
            >
              <span className="text-small">Loading…</span>
            </div>
          )}

          {group.videos.length > 1 ? (
            <div>
              <div className="eyebrow mb-2">All {group.meta.label} videos</div>
              <div className="flex gap-2 overflow-x-auto">
                {group.videos.map((v) => (
                  <SecondaryThumb
                    key={v.id}
                    video={v}
                    isActive={v.id === activeId}
                    onPick={() => setActiveId(v.id)}
                    iconSrc={group.meta.iconSrc}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {editMode.kind === "edit-label" ? (
            <EditField
              label="Label"
              value={editMode.value}
              onChange={(value) => setEditMode({ kind: "edit-label", value })}
              placeholder={group.meta.labelPlaceholder}
              required={requiresLabel}
              multiline={false}
              busy={busy}
              onCancel={() => setEditMode({ kind: "view" })}
              onSave={handleSaveEdit}
            />
          ) : null}

          {editMode.kind === "edit-notes" ? (
            <EditField
              label="Notes"
              value={editMode.value}
              onChange={(value) => setEditMode({ kind: "edit-notes", value })}
              placeholder="Anything that's not obvious from the clip."
              required={false}
              multiline
              busy={busy}
              onCancel={() => setEditMode({ kind: "view" })}
              onSave={handleSaveEdit}
            />
          ) : null}

          {editMode.kind === "view" && active.notes ? (
            <div>
              <div className="eyebrow mb-1">Notes</div>
              <p
                className="text-small whitespace-pre-wrap"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {active.notes}
              </p>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-[var(--radius-md)] p-3 text-small"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
                border: "1px solid var(--color-border-subtle)",
                color: "var(--color-text-primary)",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PerVideoMenu({
  isPrimary,
  onPromote,
  onEditLabel,
  onEditNotes,
  onDelete,
  onClose,
}: {
  isPrimary: boolean;
  onPromote: () => void;
  onEditLabel: () => void;
  onEditNotes: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Lightweight dropdown. Outer container catches outside-click via
  // a sibling overlay so we don't have to wire global event listeners.
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0"
        style={{ zIndex: 51 }}
        onClick={onClose}
      />
      <div
        role="menu"
        className="absolute right-0 top-full mt-2 w-52 surface-raised p-1 shadow-lg"
        style={{
          borderRadius: "var(--radius-md)",
          zIndex: 52,
          minWidth: 200,
        }}
      >
        {!isPrimary ? (
          <MenuItem icon="star" label="Promote to primary" onClick={onPromote} />
        ) : null}
        <MenuItem icon="edit" label="Edit label" onClick={onEditLabel} />
        <MenuItem icon="note" label="Edit notes" onClick={onEditNotes} />
        <MenuItem
          icon="trash"
          label="Delete video"
          onClick={onDelete}
          danger
        />
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left"
      style={{
        fontSize: 14,
        color: danger
          ? "var(--color-danger)"
          : "var(--color-text-primary)",
        backgroundColor: "transparent",
      }}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

function SecondaryThumb({
  video,
  isActive,
  onPick,
  iconSrc,
}: {
  video: EmergencyVideoSummary;
  isActive: boolean;
  onPick: () => void;
  iconSrc: string;
}) {
  // The strip mirrors the primary tile's "icon-as-background" treatment
  // at a smaller scale. Active thumb gets an accent border so the
  // user can see which one's playing.
  return (
    <button
      type="button"
      onClick={onPick}
      className="relative shrink-0 overflow-hidden text-left"
      style={{
        width: 132,
        height: 80,
        borderRadius: "var(--radius-md)",
        border: isActive
          ? "2px solid var(--color-accent)"
          : "1px solid var(--color-border-subtle)",
      }}
      aria-pressed={isActive}
    >
      <Image
        src={iconSrc}
        alt=""
        fill
        sizes="132px"
        style={{ objectFit: "cover" }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, #000 75%, transparent), transparent 60%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-2 pb-1.5">
        <span
          className="truncate"
          style={{ color: "#fff", fontSize: 12, fontWeight: 500 }}
        >
          {video.label || "Untitled"}
        </span>
        {video.isPrimary ? (
          <Icon name="star" size={12} />
        ) : null}
      </div>
    </button>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  required,
  multiline,
  busy,
  onCancel,
  onSave,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required: boolean;
  multiline: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave = !required || value.trim().length > 0;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {label}
        </span>
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="rounded-[var(--radius-md)] px-3 py-2"
            style={{
              backgroundColor: "var(--color-bg-surface)",
              border: "1px solid var(--color-border-subtle)",
              fontSize: 14,
              resize: "vertical",
              minHeight: 90,
            }}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={120}
            className="rounded-[var(--radius-md)] px-3 py-2"
            style={{
              backgroundColor: "var(--color-bg-surface)",
              border: "1px solid var(--color-border-subtle)",
              fontSize: 15,
            }}
          />
        )}
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn btn-ghost"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !canSave}
          className="btn btn-primary"
          style={{ opacity: busy || !canSave ? 0.6 : 1 }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
