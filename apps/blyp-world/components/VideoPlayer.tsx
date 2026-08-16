"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { isHlsVideoUri } from "@/lib/feed";

type Props = {
  src: string;
  poster?: string | null;
  active?: boolean;
  muted?: boolean;
  className?: string;
  onEnded?: () => void;
  /** When true, keep a warm buffer even if not active (neighbor prefetch). */
  warm?: boolean;
};

/** Spinner only after this ms — avoids flash on fast canplay. */
const SPINNER_DELAY_MS = 280;

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
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [ready, setReady] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    setReady(false);
    setShowSpinner(false);
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
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          backBufferLength: 30,
          startLevel: -1,
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
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (active) {
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

  const fitClass = [
    "absolute inset-0 h-full w-full",
    className && className.includes("object-") ? "" : "object-cover",
    className || "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
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
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-[var(--blyp-teal,#00d2be)]" />
        </div>
      ) : null}
    </div>
  );
}
