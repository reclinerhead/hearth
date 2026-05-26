import { describe, it, expect } from "vitest";
import {
  pickVideoMimeType,
  containerForMime,
  computeTargetDimensions,
  computePosterTimestamp,
  validateVideoSize,
  validateVideoDuration,
  VIDEO_MIME_PRIORITY,
  VIDEO_MAX_DIMENSION,
  VIDEO_MAX_INPUT_BYTES,
  VIDEO_MAX_INPUT_DURATION_SECONDS,
  POSTER_TARGET_TIMESTAMP_SECONDS,
  POSTER_SHORT_CLIP_THRESHOLD_SECONDS,
} from "./process-video";

describe("process-video — exported constants", () => {
  it("exposes the documented caps and targets", () => {
    expect(VIDEO_MAX_DIMENSION).toBe(1280);
    expect(VIDEO_MAX_INPUT_BYTES).toBe(200 * 1024 * 1024);
    expect(VIDEO_MAX_INPUT_DURATION_SECONDS).toBe(120);
    expect(POSTER_TARGET_TIMESTAMP_SECONDS).toBe(1.0);
    expect(POSTER_SHORT_CLIP_THRESHOLD_SECONDS).toBe(2.0);
  });

  it("declares the codec priority in the documented order", () => {
    expect(VIDEO_MIME_PRIORITY).toEqual([
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/webm",
      "video/mp4",
    ]);
  });
});

describe("pickVideoMimeType — codec priority", () => {
  it("returns VP9 WebM when the first preference is supported", () => {
    const supported = new Set(VIDEO_MIME_PRIORITY);
    const picked = pickVideoMimeType((m) => supported.has(m as never));
    expect(picked).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls through to VP8 when VP9 is not supported", () => {
    const supported = new Set([
      "video/webm;codecs=vp8,opus",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/webm",
      "video/mp4",
    ]);
    const picked = pickVideoMimeType((m) => supported.has(m));
    expect(picked).toBe("video/webm;codecs=vp8,opus");
  });

  it("falls through to H.264 MP4 (Safari) when no WebM codec is supported", () => {
    const supported = new Set([
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ]);
    const picked = pickVideoMimeType((m) => supported.has(m));
    expect(picked).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("falls through to bare video/webm when no specific codec is supported", () => {
    const supported = new Set(["video/webm", "video/mp4"]);
    const picked = pickVideoMimeType((m) => supported.has(m));
    expect(picked).toBe("video/webm");
  });

  it("falls through to bare video/mp4 as the last resort", () => {
    const supported = new Set(["video/mp4"]);
    const picked = pickVideoMimeType((m) => supported.has(m));
    expect(picked).toBe("video/mp4");
  });

  it("returns null when nothing in the priority list is supported", () => {
    const picked = pickVideoMimeType(() => false);
    expect(picked).toBeNull();
  });

  it("does not skip the first match in favor of a later one", () => {
    // Sanity: even when every MIME is supported, the first wins.
    const picked = pickVideoMimeType(() => true);
    expect(picked).toBe("video/webm;codecs=vp9,opus");
  });
});

describe("containerForMime", () => {
  it("maps webm MIMEs to webm", () => {
    expect(containerForMime("video/webm")).toBe("webm");
    expect(containerForMime("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(containerForMime("video/webm;codecs=vp8,opus")).toBe("webm");
  });

  it("maps mp4 MIMEs to mp4", () => {
    expect(containerForMime("video/mp4")).toBe("mp4");
    expect(containerForMime("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toBe(
      "mp4",
    );
  });
});

describe("computeTargetDimensions", () => {
  it("scales a 1920x1080 landscape source down to 1280x720", () => {
    expect(computeTargetDimensions(1920, 1080)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("scales a 1080x1920 portrait source down to 720x1280", () => {
    expect(computeTargetDimensions(1080, 1920)).toEqual({
      width: 720,
      height: 1280,
    });
  });

  it("does not upscale a 640x360 source — stays 640x360", () => {
    expect(computeTargetDimensions(640, 360)).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("does not upscale a source already at the cap — stays at the cap", () => {
    expect(computeTargetDimensions(1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("preserves aspect ratio for non-standard sources", () => {
    // 2560x1080 (ultrawide) → 1280x540
    expect(computeTargetDimensions(2560, 1080)).toEqual({
      width: 1280,
      height: 540,
    });
  });

  it("rounds odd dimensions to even integers for codec friendliness", () => {
    // A source that would scale to 1281 longest side rounds to 1280.
    // Use an awkward source like 1281x721 with max=1280 to force odd math.
    const result = computeTargetDimensions(1281, 721, 1280);
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });

  it("respects an explicit max dimension override (poster path uses 1280 also)", () => {
    expect(computeTargetDimensions(3840, 2160, 640)).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("throws on zero or negative dimensions", () => {
    expect(() => computeTargetDimensions(0, 100)).toThrow();
    expect(() => computeTargetDimensions(100, 0)).toThrow();
    expect(() => computeTargetDimensions(-1, 100)).toThrow();
  });

  it("throws on non-finite dimensions", () => {
    expect(() => computeTargetDimensions(NaN, 100)).toThrow();
    expect(() => computeTargetDimensions(100, Infinity)).toThrow();
  });
});

describe("computePosterTimestamp", () => {
  it("returns 1.0 for a 5-second clip", () => {
    expect(computePosterTimestamp(5)).toBe(1.0);
  });

  it("returns 1.0 for a clip exactly at the short-clip threshold (2s)", () => {
    expect(computePosterTimestamp(2)).toBe(1.0);
  });

  it("returns 50% of duration for a clip just below 2s", () => {
    expect(computePosterTimestamp(1.5)).toBe(0.75);
  });

  it("returns 50% of duration for a 1s clip", () => {
    expect(computePosterTimestamp(1)).toBe(0.5);
  });

  it("returns 1.0 for a 2-minute clip (long-clip path)", () => {
    expect(computePosterTimestamp(120)).toBe(1.0);
  });

  it("throws on zero or negative durations", () => {
    expect(() => computePosterTimestamp(0)).toThrow();
    expect(() => computePosterTimestamp(-1)).toThrow();
  });

  it("throws on non-finite durations", () => {
    expect(() => computePosterTimestamp(NaN)).toThrow();
    expect(() => computePosterTimestamp(Infinity)).toThrow();
  });
});

describe("validateVideoSize", () => {
  it("accepts a small file", () => {
    expect(validateVideoSize(1024)).toEqual({ ok: true });
  });

  it("accepts a file exactly at the 200 MB cap", () => {
    expect(validateVideoSize(200 * 1024 * 1024)).toEqual({ ok: true });
  });

  it("rejects a file one byte over the cap with the right reason and message", () => {
    const result = validateVideoSize(200 * 1024 * 1024 + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too_large");
      expect(result.message).toMatch(/200 MB/);
    }
  });

  it("rejects a clearly too-large file", () => {
    const result = validateVideoSize(500 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too_large");
    }
  });

  it("accepts zero (validation is about the upper bound)", () => {
    expect(validateVideoSize(0)).toEqual({ ok: true });
  });

  it("throws on negative or non-finite sizes", () => {
    expect(() => validateVideoSize(-1)).toThrow();
    expect(() => validateVideoSize(NaN)).toThrow();
    expect(() => validateVideoSize(Infinity)).toThrow();
  });
});

describe("validateVideoDuration", () => {
  it("accepts a short clip", () => {
    expect(validateVideoDuration(15)).toEqual({ ok: true });
  });

  it("accepts a clip exactly at the 2-minute cap", () => {
    expect(validateVideoDuration(120)).toEqual({ ok: true });
  });

  it("rejects a clip one tenth of a second over the cap", () => {
    const result = validateVideoDuration(120.1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too_long");
      expect(result.message).toMatch(/2 minutes/);
    }
  });

  it("rejects a clearly too-long clip", () => {
    const result = validateVideoDuration(300);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too_long");
    }
  });

  it("accepts zero (validation is about the upper bound)", () => {
    expect(validateVideoDuration(0)).toEqual({ ok: true });
  });

  it("throws on negative or non-finite durations", () => {
    expect(() => validateVideoDuration(-1)).toThrow();
    expect(() => validateVideoDuration(NaN)).toThrow();
    expect(() => validateVideoDuration(Infinity)).toThrow();
  });
});
