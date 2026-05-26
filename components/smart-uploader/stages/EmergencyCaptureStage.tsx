"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  VIDEO_MAX_INPUT_BYTES,
  VIDEO_MAX_INPUT_DURATION_SECONDS,
  VIDEO_MIME_PRIORITY,
  containerForMime,
} from "@/lib/documents/process-video";
import { formatVideoDuration } from "@/lib/documents/emergency-categories";

/**
 * Stage 3 of the emergency-procedure-video flow (issue #139). Two
 * parallel affordances at idle — "Record now" opens the device camera
 * via getUserMedia and runs a MediaRecorder against the live stream;
 * "Upload existing video" opens the file picker.
 *
 * The recorded clip is wrapped as a File and handed to the parent
 * via onFile. The parent advances to compression (Stage 4), which
 * is where the canvas downscale + bitrate pass happens. This stage
 * deliberately does the raw recording at whatever resolution the
 * device gives us — the compression pipeline owns the bitrate /
 * dimension targets so the capture surface stays simple.
 */

type CaptureMode = "idle" | "recording" | "permission-error";

export function EmergencyCaptureStage({
  onFile,
  onBack,
}: {
  onFile: (file: File) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<CaptureMode>("idle");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Always release the camera when this stage unmounts. Forgotten
  // streams keep the device's camera indicator on, which is exactly
  // the kind of trust-eroding bug we never want to ship.
  useEffect(() => {
    return stopStream;
  }, [stopStream]);

  const startRecording = useCallback(async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // facingMode hint is a soft request — desktop browsers ignore it,
        // mobile picks the rear camera which is what people will be
        // pointing at the shutoff valve.
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true; // avoid feedback loop with own audio
        await videoRef.current.play().catch(() => undefined);
      }

      // Pick the highest-priority MIME the browser can record into.
      let mimeType: string | undefined;
      for (const m of VIDEO_MIME_PRIORITY) {
        if (MediaRecorder.isTypeSupported(m)) {
          mimeType = m;
          break;
        }
      }

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const chosenMime = recorder.mimeType || mimeType || "video/webm";
        const container = containerForMime(chosenMime);
        const blob = new Blob(chunksRef.current, { type: chosenMime });
        chunksRef.current = [];
        stopStream();
        const filename = `recording-${Date.now()}.${container}`;
        const file = new File([blob], filename, { type: chosenMime });
        // Auto-cancel the post-stop UI bookkeeping — the parent
        // advances to the compression stage as soon as it receives
        // the File.
        onFile(file);
      };

      startedAtRef.current = performance.now();
      setElapsed(0);
      tickerRef.current = window.setInterval(() => {
        if (startedAtRef.current === null) return;
        const seconds = Math.floor(
          (performance.now() - startedAtRef.current) / 1000,
        );
        setElapsed(seconds);
        // Auto-stop at the duration cap so a user who walks away
        // doesn't accidentally produce a clip the validator will
        // reject. One second over the cap, not exactly at — the cap
        // is inclusive.
        if (seconds > VIDEO_MAX_INPUT_DURATION_SECONDS) {
          recorder.state === "recording" && recorder.stop();
        }
      }, 250);

      recorder.start();
      recorderRef.current = recorder;
      setMode("recording");
    } catch (err) {
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera and microphone access were denied. You can still upload a video from your device, or enable permissions in your browser settings and try again."
          : err instanceof Error
            ? err.message
            : "We couldn't open the camera. Try uploading instead.";
      setPermissionError(message);
      setMode("permission-error");
      stopStream();
    }
  }, [onFile, stopStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const handleFilePicked = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      // Reject obviously oversized files at the picker stage so the
      // compression call never sees them. Duration is validated
      // after metadata loads inside processVideo.
      if (file.size > VIDEO_MAX_INPUT_BYTES) {
        setPermissionError(
          `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — please pick something 200 MB or smaller.`,
        );
        setMode("permission-error");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  if (mode === "recording") {
    return (
      <div className="flex flex-col gap-3">
        <div
          className="relative overflow-hidden rounded-[var(--radius-lg)]"
          style={{
            aspectRatio: "9 / 16",
            maxHeight: "60dvh",
            backgroundColor: "#000",
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            className="h-full w-full object-cover"
          />
          <div
            className="absolute left-3 top-3 flex items-center gap-2 rounded-full px-3 py-1"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-danger) 80%, transparent)",
              color: "#fff",
            }}
          >
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full animate-pulse"
              style={{ backgroundColor: "#fff" }}
            />
            <span style={{ fontSize: 13, fontWeight: 500 }}>REC</span>
          </div>
          <div
            className="absolute right-3 top-3 rounded-full px-3 py-1"
            style={{
              backgroundColor:
                "color-mix(in oklab, #000 60%, transparent)",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 13, fontFamily: "var(--font-mono, monospace)" }}>
              {formatVideoDuration(elapsed)} /{" "}
              {formatVideoDuration(VIDEO_MAX_INPUT_DURATION_SECONDS)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={stopRecording}
          className="w-full rounded-[var(--radius-lg)] px-4 py-4"
          style={{
            backgroundColor: "var(--color-danger)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 500,
            minHeight: 56,
          }}
        >
          Stop and review
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small" style={{ color: "var(--color-text-secondary)" }}>
        Walk over to the thing you&apos;d want someone to know how to
        operate, hit record, and point your camera. Up to{" "}
        {Math.round(VIDEO_MAX_INPUT_DURATION_SECONDS / 60)} minutes.
      </p>

      <button
        type="button"
        onClick={startRecording}
        className="flex items-start gap-3 rounded-[var(--radius-md)] p-4 text-left transition-colors"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 18%, transparent)",
            color: "var(--color-danger)",
          }}
          aria-hidden
        >
          <Icon name="video" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 15, fontWeight: 500 }}>Record now</div>
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Uses your device camera and microphone.
          </div>
        </div>
        <span
          aria-hidden
          style={{ color: "var(--color-text-tertiary)" }}
          className="self-center"
        >
          <Icon name="chevron-right" size={16} />
        </span>
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex items-start gap-3 rounded-[var(--radius-md)] p-4 text-left transition-colors"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 18%, transparent)",
            color: "var(--color-accent)",
          }}
          aria-hidden
        >
          <Icon name="upload" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            Upload existing video
          </div>
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Pick a clip from your camera roll or files.
          </div>
        </div>
        <span
          aria-hidden
          style={{ color: "var(--color-text-tertiary)" }}
          className="self-center"
        >
          <Icon name="chevron-right" size={16} />
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(e) => handleFilePicked(e.target.files?.[0])}
      />

      {permissionError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] p-3 text-small"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-warning) 16%, var(--color-bg-surface))",
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-primary)",
          }}
        >
          {permissionError}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-1">
        <button type="button" onClick={onBack} className="btn btn-ghost">
          <span className="inline-flex items-center gap-1">
            <Icon name="chevron-left" size={16} />
            <span>Back</span>
          </span>
        </button>
      </div>
    </div>
  );
}
