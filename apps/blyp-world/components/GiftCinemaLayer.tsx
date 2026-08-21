"use client";

import { useEffect, useRef, useState } from "react";
import {
  resolveGiftCinemaClip,
  type GiftCinemaCue,
  type GiftCinemaClip,
} from "@/lib/giftCinemaClips";
import "./gift-cinema.css";

type ActiveFilm = {
  cueKey: string;
  clip: GiftCinemaClip;
};

/**
 * Full-plate gift cinema for web studio / watch / OBS.
 * Avoids frozen-poster class: mute+playsInline autoplay, stall dismiss if
 * currentTime stays near 0, never leave a static first frame up.
 */
export function GiftCinemaLayer({
  cue,
}: {
  cue: GiftCinemaCue | null | undefined;
}) {
  const [active, setActive] = useState<ActiveFilm | null>(null);
  const queueRef = useRef<ActiveFilm[]>([]);
  const playingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stallTimerRef = useRef<number | null>(null);
  const gloryTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (gloryTimerRef.current != null) {
      window.clearTimeout(gloryTimerRef.current);
      gloryTimerRef.current = null;
    }
  };

  const finishCurrent = () => {
    clearTimers();
    playingRef.current = false;
    setActive(null);
    const next = queueRef.current.shift();
    if (next) {
      playingRef.current = true;
      setActive(next);
    }
  };

  useEffect(() => {
    if (!cue?.giftId) return;
    const clip = resolveGiftCinemaClip(cue.giftId);
    if (!clip) return;
    const cueKey = `${cue.giftEventId || cue.giftId}:${cue.at || 0}`;
    if (seenRef.current.has(cueKey)) return;
    seenRef.current.add(cueKey);
    if (seenRef.current.size > 40) {
      const drop = [...seenRef.current].slice(0, 20);
      for (const k of drop) seenRef.current.delete(k);
    }
    const row: ActiveFilm = { cueKey, clip };
    if (playingRef.current) {
      queueRef.current.push(row);
      return;
    }
    playingRef.current = true;
    setActive(row);
  }, [cue?.giftEventId, cue?.giftId, cue?.at]);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    clearTimers();
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    const onEnded = () => {
      // Hold glory briefly so last frame is intentional, then clear (not sticky poster).
      gloryTimerRef.current = window.setTimeout(
        finishCurrent,
        Math.max(200, active.clip.gloryMs),
      );
    };
    const onError = () => finishCurrent();
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    void video.play().then(() => {
      // Prefer film audio when present; fall back to muted if blocked.
      if (active.clip.hasEmbeddedAudio) {
        video.muted = false;
        void video.play().catch(() => {
          video.muted = true;
          void video.play().catch(() => finishCurrent());
        });
      }
    }).catch(() => finishCurrent());

    stallTimerRef.current = window.setTimeout(() => {
      const t = Number(video.currentTime) || 0;
      if (t < 0.08) finishCurrent();
    }, 1600);

    const hardCap = window.setTimeout(
      finishCurrent,
      active.clip.durationMs + active.clip.gloryMs + 2500,
    );

    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      window.clearTimeout(hardCap);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.cueKey]);

  if (!active) return null;

  return (
    <div
      className={
        active.clip.composite === "darkKey"
          ? "blyp-gift-cinema blyp-gift-cinema-darkkey"
          : "blyp-gift-cinema blyp-gift-cinema-opaque"
      }
      aria-hidden
    >
      <video
        key={active.cueKey}
        ref={videoRef}
        className="blyp-gift-cinema-video"
        src={active.clip.src}
        muted
        playsInline
        autoPlay
        preload="auto"
      />
    </div>
  );
}
