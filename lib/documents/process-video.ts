/**
 * Client-side video compression + poster extraction for the Smart
 * Uploader's emergency-procedure-video path (issue #139).
 *
 * Pipeline:
 *   1. Caller validates raw file size up front via validateVideoSize.
 *   2. processVideo loads the source into a hidden <video>, probes
 *      duration via the loadedmetadata event, and runs duration
 *      validation.
 *   3. A canvas is sized to the target dimensions (preserving aspect
 *      ratio, never upscaling). requestVideoFrameCallback (or rAF on
 *      browsers that lack it) draws each decoded frame into the
 *      canvas at the target resolution.
 *   4. canvas.captureStream() yields a downscaled video track;
 *      video.captureStream() yields the source audio track. The two
 *      are combined into a single MediaStream and fed into a
 *      MediaRecorder at the bitrate targets.
 *   5. At the 1s mark (or 50% for clips under 2s) the canvas is
 *      sampled into a JPEG poster frame.
 *   6. The video element is detached and the object URL revoked in a
 *      finally block.
 *
 * Pure helpers below are exported for direct unit testing. The
 * orchestration in processVideo wires them together against browser
 * APIs and is exercised through manual testing in the Smart Uploader.
 *
 * Browser-only — must run in the user's browser, never on the server.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Longest-side cap for the compressed video. 1280×720 in landscape. */
export const VIDEO_MAX_DIMENSION = 1280;

/** Target video bitrate (~2 Mbps). */
export const VIDEO_TARGET_BITRATE_BPS = 2_000_000;

/** Target audio bitrate (96 kbps Opus or AAC). */
export const AUDIO_TARGET_BITRATE_BPS = 96_000;

/** Hard size cap on RAW INPUT (pre-compression), 200 MB. */
export const VIDEO_MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Hard duration cap, 2 minutes (inclusive — exactly 120s passes). */
export const VIDEO_MAX_INPUT_DURATION_SECONDS = 120;

/** Poster sample target — 1.0s for normal clips. */
export const POSTER_TARGET_TIMESTAMP_SECONDS = 1.0;

/** Below this duration the poster falls back to 50% of the clip. */
export const POSTER_SHORT_CLIP_THRESHOLD_SECONDS = 2.0;

/** Longest-side cap for the poster JPEG. */
export const POSTER_MAX_DIMENSION = 1280;

/** JPEG quality for the poster. */
export const POSTER_JPEG_QUALITY = 0.85;

/**
 * MediaRecorder MIME priority. VP9/Opus in WebM is the smallest at a
 * given quality and is widely supported on Chrome/Firefox/Edge. VP8
 * is the next-best WebM fallback. H.264/AAC in MP4 covers Safari,
 * which only recently gained MediaRecorder support and prefers MP4.
 * The two bare-MIME entries at the tail catch browsers that report
 * support without specific codec strings.
 *
 * Order matters — pickVideoMimeType returns the first match.
 */
export const VIDEO_MIME_PRIORITY = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm",
  "video/mp4",
] as const;

export type VideoMimeType = (typeof VIDEO_MIME_PRIORITY)[number];

export type VideoContainer = "webm" | "mp4";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pick the highest-priority MIME type the runtime supports. Returns
 * null when nothing in VIDEO_MIME_PRIORITY is supported — the caller
 * should fall back to the file-upload path (recording is not viable
 * on this browser).
 *
 * Pure: takes the predicate as an argument so tests can stub
 * MediaRecorder.isTypeSupported without touching globals.
 */
export function pickVideoMimeType(
  isSupported: (mime: string) => boolean,
): VideoMimeType | null {
  for (const mime of VIDEO_MIME_PRIORITY) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

/**
 * Container ('webm' or 'mp4') for a given MediaRecorder MIME. Used to
 * pick the right storage object filename in the bucket layout.
 */
export function containerForMime(mime: VideoMimeType | string): VideoContainer {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * Compute the downscale target dimensions for a source frame.
 *
 * - Preserves aspect ratio.
 * - Never upscales — sources at or below the max in their longest
 *   dimension keep their native size.
 * - Rounds to even integers to keep most codecs happy (some codecs
 *   require an even width/height; the existing CSS pixel math is
 *   not always integer-aligned).
 */
export function computeTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimension = VIDEO_MAX_DIMENSION,
): { width: number; height: number } {
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight)) {
    throw new Error(
      "computeTargetDimensions: srcWidth and srcHeight must be finite numbers",
    );
  }
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(
      "computeTargetDimensions: srcWidth and srcHeight must be positive",
    );
  }

  const ratio = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
  const rawWidth = srcWidth * ratio;
  const rawHeight = srcHeight * ratio;

  // Round to nearest even integer. Math.round + (& ~1) collapses any
  // odd result to the nearest even number below it, which is what
  // VP9 and H.264 want and what browsers' canvas captureStream is
  // most reliable producing.
  const width = Math.max(2, Math.round(rawWidth) & ~1);
  const height = Math.max(2, Math.round(rawHeight) & ~1);

  return { width, height };
}

/**
 * Pick the timestamp for the poster sample. 1.0s for normal clips;
 * 50% of duration for clips shorter than the threshold (a 1.5s clip
 * sampled at 1.0s would be too close to the end).
 */
export function computePosterTimestamp(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(
      "computePosterTimestamp: durationSeconds must be a positive finite number",
    );
  }
  if (durationSeconds < POSTER_SHORT_CLIP_THRESHOLD_SECONDS) {
    return durationSeconds / 2;
  }
  return POSTER_TARGET_TIMESTAMP_SECONDS;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_large" | "too_long"; message: string };

/**
 * Reject raw inputs larger than VIDEO_MAX_INPUT_BYTES. Exactly equal
 * is allowed.
 */
export function validateVideoSize(sizeBytes: number): ValidationResult {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error(
      "validateVideoSize: sizeBytes must be a non-negative finite number",
    );
  }
  if (sizeBytes > VIDEO_MAX_INPUT_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: `Video must be 200 MB or smaller (got ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }
  return { ok: true };
}

/**
 * Reject clips longer than VIDEO_MAX_INPUT_DURATION_SECONDS. Exactly
 * equal is allowed.
 */
export function validateVideoDuration(
  durationSeconds: number,
): ValidationResult {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(
      "validateVideoDuration: durationSeconds must be a non-negative finite number",
    );
  }
  if (durationSeconds > VIDEO_MAX_INPUT_DURATION_SECONDS) {
    return {
      ok: false,
      reason: "too_long",
      message: `Video must be 2 minutes or shorter (got ${durationSeconds.toFixed(1)}s).`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type ProcessVideoResult = {
  /** Compressed video Blob, mime derived from the picked codec. */
  compressed: Blob;
  /** Poster-frame JPEG Blob. */
  poster: Blob;
  /** Probed duration of the source clip, in seconds. */
  durationSeconds: number;
  /** Raw input file size. */
  originalSize: number;
  /** Compressed output size. */
  compressedSize: number;
  /** MIME picked from VIDEO_MIME_PRIORITY. */
  mimeType: VideoMimeType;
  /** Container ('webm' or 'mp4') for storage path construction. */
  container: VideoContainer;
};

export class ProcessVideoError extends Error {
  reason:
    | "too_large"
    | "too_long"
    | "unsupported_codec"
    | "decode_failed"
    | "no_capture_stream"
    | "recorder_failed";
  constructor(reason: ProcessVideoError["reason"], message: string) {
    super(message);
    this.name = "ProcessVideoError";
    this.reason = reason;
  }
}

type CaptureStreamCapable = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  // Firefox shipped this name first; aliased on some older builds.
  mozCaptureStream?: () => MediaStream;
};

function getVideoCaptureStream(el: CaptureStreamCapable): MediaStream | null {
  if (typeof el.captureStream === "function") return el.captureStream();
  if (typeof el.mozCaptureStream === "function") return el.mozCaptureStream();
  return null;
}

/**
 * Compress a user-selected or just-recorded video. Returns the
 * compressed Blob, the extracted poster JPEG, and timing/size
 * metadata.
 *
 * Throws ProcessVideoError on any expected failure (too long, no
 * supported codec, decode failure, browser can't captureStream the
 * video element). The caller surfaces .reason to the user.
 */
export async function processVideo(file: File): Promise<ProcessVideoResult> {
  const sizeCheck = validateVideoSize(file.size);
  if (!sizeCheck.ok) {
    throw new ProcessVideoError(sizeCheck.reason, sizeCheck.message);
  }

  const mime = pickVideoMimeType((m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  );
  if (!mime) {
    throw new ProcessVideoError(
      "unsupported_codec",
      "Your browser can't record video. Try uploading an existing clip instead.",
    );
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video") as CaptureStreamCapable;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    // Probe duration and intrinsic dimensions.
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(
          new ProcessVideoError(
            "decode_failed",
            "We couldn't read that video file. Try a different clip.",
          ),
        );
    });

    const durationCheck = validateVideoDuration(video.duration);
    if (!durationCheck.ok) {
      throw new ProcessVideoError(durationCheck.reason, durationCheck.message);
    }

    const target = computeTargetDimensions(
      video.videoWidth,
      video.videoHeight,
      VIDEO_MAX_DIMENSION,
    );

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ProcessVideoError(
        "decode_failed",
        "Canvas 2D context unavailable.",
      );
    }

    const sourceStream = getVideoCaptureStream(video);
    if (!sourceStream) {
      throw new ProcessVideoError(
        "no_capture_stream",
        "Your browser can't capture this video for re-encoding. Try uploading instead.",
      );
    }

    const canvasStream = canvas.captureStream();
    const combined = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => combined.addTrack(t));
    sourceStream.getAudioTracks().forEach((t) => combined.addTrack(t));

    const recorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_TARGET_BITRATE_BPS,
      audioBitsPerSecond: AUDIO_TARGET_BITRATE_BPS,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    // Frame pump — draws each decoded frame into the downscaled
    // canvas. requestVideoFrameCallback fires per decoded frame
    // where available; fallback to rAF.
    type VideoFrameCallbackCapable = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const rvfc = (video as VideoFrameCallbackCapable)
      .requestVideoFrameCallback;
    let cancelled = false;
    function pumpFrame() {
      if (cancelled || video.ended) return;
      ctx!.drawImage(video, 0, 0, target.width, target.height);
      if (rvfc) {
        rvfc.call(video, pumpFrame);
      } else {
        requestAnimationFrame(pumpFrame);
      }
    }

    const recorderStopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () =>
        reject(
          new ProcessVideoError(
            "recorder_failed",
            "Video recording failed. Try again, or upload an existing clip.",
          ),
        );
    });

    // Capture the poster before recording starts: seek to the
    // poster timestamp, draw one frame into a scratch canvas at
    // POSTER_MAX_DIMENSION, encode JPEG.
    const posterTimestamp = computePosterTimestamp(video.duration);
    const poster = await capturePoster(video, posterTimestamp);

    // Now play through for the recording pass. Reset to 0, start
    // both pump and recorder, stop when the video ends.
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    recorder.start();
    pumpFrame();
    await video.play();

    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
    });

    cancelled = true;
    recorder.stop();
    await recorderStopped;

    const compressed = new Blob(chunks, { type: mime });

    return {
      compressed,
      poster,
      durationSeconds: video.duration,
      originalSize: file.size,
      compressedSize: compressed.size,
      mimeType: mime,
      container: containerForMime(mime),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Seek the video to the poster timestamp and snapshot a single
 * frame into a JPEG Blob at the poster dimension cap.
 */
async function capturePoster(
  video: HTMLVideoElement,
  timestamp: number,
): Promise<Blob> {
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () =>
      reject(
        new ProcessVideoError(
          "decode_failed",
          "Couldn't seek to the poster frame.",
        ),
      );
    video.currentTime = Math.min(timestamp, video.duration);
  });

  const target = computeTargetDimensions(
    video.videoWidth,
    video.videoHeight,
    POSTER_MAX_DIMENSION,
  );

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ProcessVideoError(
      "decode_failed",
      "Canvas 2D context unavailable for poster capture.",
    );
  }
  ctx.drawImage(video, 0, 0, target.width, target.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new ProcessVideoError(
                "decode_failed",
                "Poster encoding returned null.",
              ),
            ),
      "image/jpeg",
      POSTER_JPEG_QUALITY,
    );
  });
}
