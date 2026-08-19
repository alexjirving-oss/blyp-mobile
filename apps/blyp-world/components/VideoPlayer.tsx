"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { isHlsVideoUri } from "@/lib/feed";
import { isStudioMobileLite } from "@/lib/studioMobileLite";
import "./video-player.css";

type Props = {
  src: string;
  poster?: string | null;
  active?: boolean;
  muted?: boolean;
  className?: string;
  onEnded?: () => void;
  /** When true, keep a warm buffer even if not active (neighbor prefetch). */
  warm?: boolean;
  /**
   * Leaner HLS buffers (LIVE watch / Fold). Also auto-enabled on coarse/small
   * viewports when omitted.
   */
  liveLite?: boolean;
};

/** Spinner only after this ms — avoids flash on fast canplay. */
const SPINNER_DELAY_MS = 280;

function formatClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/**
 * Fixed-frame video host. Parent must reserve size (absolute inset / aspect).
 * Intrinsic video dimensions never change layout — absolute fill + object-fit.
 * Poster holds the frame until first paint; spinner is overlay-only after delay.
 */
export function VideoPlayer({
  src,
  poster,
  active = true,
  muted = false,
  className,
  onEnded,
  warm = false,
  liveLite,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const userPausedRef = useRef(false);
  const wasActiveRef = useRef(active);
  const [ready, setReady] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const lean =
    liveLite === true ||
    (liveLite !== false && isStudioMobileLite());

  useEffect(() => {
    setReady(false);
    setShowSpinner(false);
    setPaused(true);
    setCurrentTime(0);
    setDuration(0);
    userPausedRef.current = false;
  }, [src]);

  useEffect(() => {
    if (ready || !active) {
      setShowSpinner(false);
      return undefined;
    }
    const t = window.setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [ready, active, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isHls = isHlsVideoUri(src);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHls) {
      if (Hls.isSupported()) {
        // Fold / Samsung Internet: large buffers + workers have tab-killed watch.
        const hls = new Hls({
          enableWorker: !lean,
          lowLatencyMode: false,
          maxBufferLength: lean ? 8 : 20,
          maxMaxBufferLength: lean ? 12 : 30,
          backBufferLength: lean ? 4 : 12,
          capLevelToPlayerSize: true,
          startLevel: lean ? 0 : -1,
          abrEwmaDefaultEstimate: lean ? 500_000 : 1_000_000,
          abrBandWidthFactor: lean ? 0.7 : 0.95,
          abrBandWidthUpFactor: lean ? 0.5 : 0.7,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            hls.destroy();
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
      }
    } else {
      video.src = src;
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, lean]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (active && !wasActiveRef.current) {
      userPausedRef.current = false;
    }
    wasActiveRef.current = active;
    if (active) {
      if (userPausedRef.current) {
        setPaused(true);
        return;
      }
      const tryPlay = () => {
        const play = video.play();
        if (play && typeof play.catch === "function") {
          play.catch(() => {
            // Autoplay blocked — retry muted once.
            if (!video.muted) {
              video.muted = true;
              video.play().catch(() => {});
            }
          });
        }
      };
      if (video.readyState >= 2) {
        setReady(true);
        tryPlay();
      } else {
        const onCanPlay = () => {
          video.removeEventListener("canplay", onCanPlay);
          setReady(true);
          tryPlay();
        };
        const onPlaying = () => setReady(true);
        video.addEventListener("canplay", onCanPlay);
        video.addEventListener("playing", onPlaying);
        tryPlay();
        return () => {
          video.removeEventListener("canplay", onCanPlay);
          video.removeEventListener("playing", onPlaying);
        };
      }
    } else {
      video.pause();
      setPaused(true);
      try {
        if (video.currentTime > 0.25) video.currentTime = 0;
      } catch {
        /* ignore seek errors */
      }
    }
  }, [active, muted, src]);

  // Warm-load neighbor: nudge network without playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || active || !warm) return;
    try {
      video.preload = "auto";
      if (video.readyState < 2) {
        video.load();
      }
    } catch {
      /* ignore */
    }
  }, [active, warm, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncClock = () => {
      setCurrentTime(video.currentTime || 0);
      const d = video.duration;
      setDuration(Number.isFinite(d) ? d : 0);
      setPaused(video.paused);
    };
    video.addEventListener("timeupdate", syncClock);
    video.addEventListener("durationchange", syncClock);
    video.addEventListener("play", syncClock);
    video.addEventListener("pause", syncClock);
    syncClock();
    return () => {
      video.removeEventListener("timeupdate", syncClock);
      video.removeEventListener("durationchange", syncClock);
      video.removeEventListener("play", syncClock);
      video.removeEventListener("pause", syncClock);
    };
  }, [src, active]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    if (video.paused) {
      userPausedRef.current = false;
      const play = video.play();
      if (play && typeof play.catch === "function") {
        play.catch(() => {});
      }
    } else {
      userPausedRef.current = true;
      video.pause();
    }
  }, [active]);

  const onSeek = useCallback((value: string) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    try {
      video.currentTime = next;
      setCurrentTime(next);
    } catch {
      /* ignore seek errors */
    }
  }, []);

  const fitClass = [
    "absolute inset-0 h-full w-full",
    className && className.includes("object-") ? "" : "object-cover",
    className || "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const seekable = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const pct = seekable > 0 ? Math.min(100, Math.max(0, (currentTime / seekable) * 100)) : 0;
  const shellClass = [
    "blyp-vp",
    active ? "blyp-vp--active" : "",
    paused ? "blyp-vp--paused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <video
        ref={videoRef}
        className={fitClass}
        // Poster attribute can fight CSS sizing; we paint poster as overlay.
        playsInline
        loop={!onEnded}
        controls={false}
        muted={muted}
        preload={active || warm ? "auto" : "metadata"}
        onEnded={onEnded}
        onLoadedData={() => setReady(true)}
        onPlaying={() => setReady(true)}
      />
      {poster && !ready ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : null}
      {showSpinner ? (
        <div className="blyp-vp-spinner" aria-hidden>
          <span className="blyp-vp-spinner-ring" />
        </div>
      ) : null}
      {active ? (
        <>
          <button
            type="button"
            className="blyp-vp-playhit"
            aria-label={paused ? "Play" : "Pause"}
            onClick={togglePlay}
          />
          <span className="blyp-vp-paused-mark" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <div className="blyp-vp-chrome">
            <div className="blyp-vp-row">
              <button
                type="button"
                className="blyp-vp-btn"
                aria-label={paused ? "Play" : "Pause"}
                onClick={togglePlay}
              >
                {paused ? (
                  <svg viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
                  </svg>
                )}
              </button>
              <div className="blyp-vp-seek">
                <div className="blyp-vp-seek-track">
                  <div className="blyp-vp-seek-fill" style={{ width: `${pct}%` }} />
                </div>
                <input
                  className="blyp-vp-seek-input"
                  type="range"
                  min={0}
                  max={seekable > 0 ? seekable : 1}
                  step="any"
                  value={seekable > 0 ? Math.min(currentTime, seekable) : 0}
                  disabled={seekable <= 0}
                  aria-label="Seek"
                  onChange={(e) => onSeek(e.target.value)}
                />
              </div>
              <span className="blyp-vp-time">
                {formatClock(currentTime)} / {formatClock(seekable)}
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
