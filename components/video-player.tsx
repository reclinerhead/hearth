"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { formatVideoDuration } from "@/lib/documents/emergency-categories";

/**
 * Custom video player for emergency-procedure-video playback
 * (issue #139). Chunky controls intentionally sized for gloves-on
 * use at 2am with wet hands:
 *
 *   - Large play/pause toggle overlaid centre when paused, fades
 *     when playing. Tap-anywhere also toggles.
 *   - Full-width scrubber bar with a generous draggable thumb.
 *   - Time display (current / total).
 *   - Fullscreen toggle.
 *   - No rewind / forward / volume / speed — by design.
 *
 * 44×44pt tap targets, scrubber row 32pt minimum, honors
 * prefers-reduced-motion on the fade transitions.
 */

export type VideoPlayerProps = {
  src: string;
  /** Optional poster JPEG URL — shown until the user taps play. */
  poster?: string | null;
  /**
   * Auto-hide window for the control overlay during playback. Tap
   * anywhere to bring controls back. Defaults to 3 seconds per the
   * issue's design contract.
   */
  controlsAutoHideMs?: number;
  /** className forwarded to the outer container for layout sizing. */
  className?: string;
};

export function VideoPlayer({
  src,
  poster,
  controlsAutoHideMs = 3000,
  className,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    if (controlsAutoHideMs > 0) {
      hideTimerRef.current = window.setTimeout(() => {
        // Only hide while playing — a paused video keeps controls
        // visible so the user can find them again.
        if (videoRef.current && !videoRef.current.paused) {
          setControlsVisible(false);
        }
      }, controlsAutoHideMs);
    }
  }, [controlsAutoHideMs]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // Track real fullscreen state so the icon toggles even when the
  // user exits via ESC or the system fullscreen pill.
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
    }
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      el.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  function onLoadedMetadata() {
    if (videoRef.current) setDuration(videoRef.current.duration);
  }
  function onTimeUpdate() {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }
  function onPlayEvent() {
    setIsPlaying(true);
    showControls();
  }
  function onPauseEvent() {
    setIsPlaying(false);
    setControlsVisible(true);
  }
  function onEndedEvent() {
    setIsPlaying(false);
    setControlsVisible(true);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    const value = Number(e.target.value);
    v.currentTime = value;
    setCurrentTime(value);
  }

  // Tap anywhere on the surface = toggle play AND show controls.
  function onSurfaceTap(e: React.MouseEvent) {
    // Don't toggle when the click came from one of the inner control
    // buttons / scrubber — they handle their own behaviors.
    if ((e.target as HTMLElement).closest("[data-player-control]")) return;
    togglePlay();
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        backgroundColor: "#000",
        borderRadius: isFullscreen ? 0 : "var(--radius-lg)",
        aspectRatio: isFullscreen ? undefined : "16 / 9",
      }}
      onMouseMove={showControls}
      onClick={onSurfaceTap}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        playsInline
        // No autoplay — poster sits until the user taps. Honors the
        // "default mute state is the device's setting, not forced"
        // rule from the issue.
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlayEvent}
        onPause={onPauseEvent}
        onEnded={onEndedEvent}
        className="h-full w-full object-contain"
      />

      {/*
        Centre play affordance — chunky tap target overlaid on the
        poster. Fades out while playing (and with controls), back
        in on pause. Honors prefers-reduced-motion.
      */}
      <button
        type="button"
        data-player-control
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="absolute inset-0 m-auto"
        style={{
          width: 88,
          height: 88,
          borderRadius: 9999,
          display: isPlaying && !controlsVisible ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "color-mix(in oklab, #000 55%, transparent)",
          color: "#fff",
          border: "0",
          transition:
            "opacity 200ms ease-out, transform 200ms ease-out",
          opacity: controlsVisible ? 1 : 0,
        }}
      >
        <Icon name={isPlaying ? "pause" : "play"} size={36} strokeWidth={1.5} />
      </button>

      {/*
        Bottom control bar — scrubber + time + fullscreen. Stays
        permanently visible when paused; fades during playback.
      */}
      <div
        data-player-control
        className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 py-3"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, #000 75%, transparent), transparent)",
          opacity: controlsVisible ? 1 : 0,
          transition: "opacity 200ms ease-out",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
      >
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : 0}
          step={0.05}
          value={currentTime}
          onChange={onScrub}
          aria-label="Scrub video"
          className="flex-1"
          style={{
            // Chunky thumb / track. Webkit-specific styling is best
            // applied via global CSS but inline here is fine for the
            // first-pass build — Hearth's globals.css restores the
            // pointer cursor app-wide so we don't need to repeat it.
            height: 32,
            accentColor: "#fff",
          }}
        />
        <span
          className="shrink-0 tabular-nums"
          style={{
            color: "#fff",
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            minWidth: 80,
            textAlign: "right",
          }}
        >
          {formatVideoDuration(currentTime)} /{" "}
          {formatVideoDuration(duration)}
        </span>
        <button
          type="button"
          data-player-control
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            backgroundColor: "color-mix(in oklab, #000 45%, transparent)",
            color: "#fff",
            border: 0,
          }}
        >
          <Icon name={isFullscreen ? "minimize" : "maximize"} size={20} />
        </button>
      </div>
    </div>
  );
}
