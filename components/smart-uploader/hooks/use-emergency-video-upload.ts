"use client";

import { useCallback, useRef, useState } from "react";
import { saveEmergencyVideoAction } from "@/app/actions/documents/save-emergency-video";
import {
  processVideo,
  ProcessVideoError,
  validateVideoSize,
} from "@/lib/documents/process-video";
import { uploadEmergencyVideoFiles } from "@/lib/documents/upload";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow, EmergencyCategory } from "@/types/document";

/**
 * Orchestration hook for the emergency-procedure-video path of the
 * Smart Uploader (issue #139). Distinct from useDocumentUpload and
 * useReceiptUpload because the pipeline is different — there is no
 * AI extraction step, the storage bucket is different, and the
 * row carries video-specific columns.
 *
 * State machine:
 *   idle → category-picked → label-set → compressing → compressed → saving → done
 *                                              ↓
 *                                          error (per-stage)
 *
 * The Smart Uploader owns the user-facing stage tag; this hook owns
 * the upload pipeline and exposes its phase + the compressed blob /
 * poster for the review stage to preview before save.
 */

export type EmergencyVideoPhase =
  | "idle"
  | "compressing"
  | "compressed"
  | "saving"
  | "done"
  | "error";

export type EmergencyVideoCompressedResult = {
  videoBlob: Blob;
  posterBlob: Blob;
  videoPreviewUrl: string;
  posterPreviewUrl: string;
  durationSeconds: number;
  mimeType: string;
  container: "webm" | "mp4";
  originalSize: number;
  compressedSize: number;
};

export type EmergencyVideoState = {
  phase: EmergencyVideoPhase;
  category: EmergencyCategory | null;
  label: string | null;
  result: EmergencyVideoCompressedResult | null;
  /** Saved DocumentRow after a successful save. */
  saved: DocumentRow | null;
  error: string | null;
};

const INITIAL_STATE: EmergencyVideoState = {
  phase: "idle",
  category: null,
  label: null,
  result: null,
  saved: null,
  error: null,
};

export type UseEmergencyVideoUploadArgs = {
  houseId: string;
};

export type UseEmergencyVideoUploadResult = {
  state: EmergencyVideoState;
  setCategory: (c: EmergencyCategory) => void;
  setLabel: (l: string | null) => void;
  /**
   * Kick off compression on a user-selected or just-recorded file.
   * Caller is responsible for the upstream UI flow (camera capture,
   * file picker, etc.); the hook only knows about the File once it
   * exists.
   */
  startCompression: (file: File) => Promise<void>;
  /** Retake = clear the compressed result, return to compressing-can-restart state. */
  resetForRetake: () => void;
  /**
   * Finalize. Uploads video + poster in parallel, inserts the row,
   * resolves once the saved row is back from the server.
   */
  save: (notes: string | null, originalFilename: string) => Promise<void>;
  reset: () => void;
};

export function useEmergencyVideoUpload(
  args: UseEmergencyVideoUploadArgs,
): UseEmergencyVideoUploadResult {
  const [state, setState] = useState<EmergencyVideoState>(INITIAL_STATE);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    runningRef.current = false;
    setState((prev) => {
      if (prev.result) {
        URL.revokeObjectURL(prev.result.videoPreviewUrl);
        URL.revokeObjectURL(prev.result.posterPreviewUrl);
      }
      return INITIAL_STATE;
    });
  }, []);

  const resetForRetake = useCallback(() => {
    setState((prev) => {
      if (prev.result) {
        URL.revokeObjectURL(prev.result.videoPreviewUrl);
        URL.revokeObjectURL(prev.result.posterPreviewUrl);
      }
      return {
        ...prev,
        phase: "idle",
        result: null,
        error: null,
      };
    });
  }, []);

  const setCategory = useCallback((category: EmergencyCategory) => {
    setState((s) => ({ ...s, category, error: null }));
  }, []);

  const setLabel = useCallback((label: string | null) => {
    setState((s) => ({ ...s, label: label?.trim() ? label : null }));
  }, []);

  const startCompression = useCallback(async (file: File) => {
    if (runningRef.current) return;

    // Pre-flight size check so multi-gigabyte uploads bounce immediately
    // before we burn time on probe + decode. Duration validation runs
    // inside processVideo after the loadedmetadata event.
    const sizeCheck = validateVideoSize(file.size);
    if (!sizeCheck.ok) {
      setState((s) => ({ ...s, phase: "error", error: sizeCheck.message }));
      return;
    }

    runningRef.current = true;
    setState((s) => ({ ...s, phase: "compressing", error: null }));

    try {
      const result = await processVideo(file);
      const videoPreviewUrl = URL.createObjectURL(result.compressed);
      const posterPreviewUrl = URL.createObjectURL(result.poster);
      setState((s) => ({
        ...s,
        phase: "compressed",
        result: {
          videoBlob: result.compressed,
          posterBlob: result.poster,
          videoPreviewUrl,
          posterPreviewUrl,
          durationSeconds: result.durationSeconds,
          mimeType: result.mimeType,
          container: result.container,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
        },
        error: null,
      }));
    } catch (err) {
      const message =
        err instanceof ProcessVideoError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Compression failed.";
      setState((s) => ({ ...s, phase: "error", error: message }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  const save = useCallback(
    async (notes: string | null, originalFilename: string) => {
      if (runningRef.current) return;
      if (!state.result || !state.category) {
        setState((s) => ({
          ...s,
          phase: "error",
          error: "Nothing to save — pick a category and record a video first.",
        }));
        return;
      }
      runningRef.current = true;
      setState((s) => ({ ...s, phase: "saving", error: null }));

      try {
        // Pre-allocate the documentId client-side so the storage
        // upload path can be computed before any server round-trip,
        // same as the photo + receipt flows.
        const documentId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : fallbackUuid();

        const supabase = createClient();
        const { videoPath, posterPath } = await uploadEmergencyVideoFiles({
          supabase,
          houseId: args.houseId,
          documentId,
          video: state.result.videoBlob,
          poster: state.result.posterBlob,
          container: state.result.container,
          videoMimeType: state.result.mimeType,
        });

        const saved = await saveEmergencyVideoAction({
          documentId,
          houseId: args.houseId,
          category: state.category,
          label: state.label,
          storagePath: videoPath,
          posterStoragePath: posterPath,
          mimeType: state.result.mimeType,
          fileSizeBytes: state.result.compressedSize,
          durationSeconds: Math.round(state.result.durationSeconds),
          originalFilename,
          notes,
        });

        if (saved.error !== null) {
          // Best-effort cleanup of just-uploaded bytes since the row
          // never landed.
          await supabase.storage
            .from("hearth-emergency-videos")
            .remove([videoPath, posterPath])
            .catch(() => undefined);
          throw new Error(saved.error);
        }

        setState((s) => ({
          ...s,
          phase: "done",
          saved: saved.data,
          error: null,
        }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Save failed.";
        setState((s) => ({ ...s, phase: "error", error: message }));
      } finally {
        runningRef.current = false;
      }
    },
    [args.houseId, state.result, state.category, state.label],
  );

  return {
    state,
    setCategory,
    setLabel,
    startCompression,
    resetForRetake,
    save,
    reset,
  };
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
