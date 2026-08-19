"use client";

import { useEffect, useRef } from "react";
import { IVS_PLAYER_ASSET_VERSION } from "@/lib/ivsPlayerVersion";

type Props = {
  src: string;
  muted: boolean;
  onFirstFrame: () => void;
  onFatal: () => void;
  onLatency: (seconds: number) => void;
  /** cover = crop into the stage (phone 9:16 of a 16:9 encode). */
  objectFit?: "cover" | "contain";
};

type LoosePlayerError = {
  type?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
};

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function httpStatus(err: LoosePlayerError): number {
  const n = Number(err.code ?? err.status);
  return Number.isFinite(n) ? n : 0;
}

/** IVS NOT_AVAILABLE+429 is quota, not offline. Only 404 / NOT_LIVE is gone. */
function isStreamGoneError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as LoosePlayerError;
  const code = httpStatus(e);
  if (code === 429) return false;
  const msg = String(e.message || "");
  if (code === 404 || code === 410) return true;
  if (/\bNOT_LIVE\b/i.test(msg)) return true;
  return false;
}

export function IvsAudiencePlayer({
  src,
  muted,
  onFirstFrame,
  onFatal,
  onLatency,
  objectFit = "cover",
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firstRef = useRef(false);
  const fatalTimer = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    firstRef.current = false;
    let cancelled = false;
    let player: ReturnType<typeof import("amazon-ivs-player")["create"]> | null =
      null;
    let latencyTimer: number | null = null;
    let retryTimer: number | null = null;
    let retryDelay = 1000;

    const markFirst = () => {
      if (cancelled || firstRef.current) return;
      if (video.videoWidth > 0 || video.readyState >= 2) {
        firstRef.current = true;
        retryDelay = 1000;
        onFirstFrame();
      }
    };

    const clearFatalTimer = () => {
      if (fatalTimer.current) {
        window.clearTimeout(fatalTimer.current);
        fatalTimer.current = null;
      }
    };

    const armFatalTimer = () => {
      if (firstRef.current || cancelled) return;
      clearFatalTimer();
      fatalTimer.current = window.setTimeout(() => {
        if (!firstRef.current && !cancelled) onFatal();
      }, 20_000);
    };

    const clearRetry = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const reloadSource = () => {
      if (cancelled) return;
      clearRetry();
      armFatalTimer();
      const wait = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 8000);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (cancelled) return;
        try {
          if (player) {
            player.load(src);
          } else {
            video.src = src;
            void video.play().catch(() => undefined);
          }
        } catch {
          /* ignore */
        }
      }, wait);
    };

    const onPlayerError = (err: unknown) => {
      if (cancelled) return;
      if (isStreamGoneError(err)) {
        clearRetry();
        onFatal();
        return;
      }
      // 429 / network / timeout — never latch ended.
      reloadSource();
    };

    const onNativeError = () => {
      if (cancelled) return;
      void (async () => {
        let gone = false;
        try {
          const res = await fetch(src, { method: "GET", cache: "no-store" });
          gone = res.status === 404 || res.status === 410;
          if (res.status === 429) gone = false;
        } catch {
          gone = false;
        }
        if (cancelled) return;
        if (gone) {
          clearRetry();
          onFatal();
          return;
        }
        reloadSource();
      })();
    };

    armFatalTimer();

    const start = async () => {
      const ios = isIos();
      if (ios) {
        video.crossOrigin = "anonymous";
        video.playsInline = true;
        video.muted = muted;
        video.src = src;
        video.addEventListener("playing", markFirst);
        video.addEventListener("timeupdate", markFirst);
        video.addEventListener("error", onNativeError);
        if (navigator.serviceWorker) {
          navigator.serviceWorker
            .register("/amazon-ivs-service-worker-loader.js", { scope: "/" })
            .catch(() => undefined);
        }
        onLatency(7);
        void video.play().catch(() => undefined);
        return;
      }
      const ivs = await import("amazon-ivs-player");
      if (cancelled) return;
      if (!ivs.isPlayerSupported) {
        video.crossOrigin = "anonymous";
        video.playsInline = true;
        video.muted = muted;
        video.src = src;
        video.addEventListener("playing", markFirst);
        video.addEventListener("error", onNativeError);
        onLatency(7);
        void video.play().catch(() => undefined);
        return;
      }
      const V = IVS_PLAYER_ASSET_VERSION;
      const origin = window.location.origin;
      player = ivs.create({
        wasmWorker: origin + "/ivs/" + V + "/amazon-ivs-wasmworker.min.js",
        wasmBinary: origin + "/ivs/" + V + "/amazon-ivs-wasmworker.min.wasm",
      });
      player.attachHTMLVideoElement(video);
      player.setMuted(muted);
      player.setAutoplay(true);
      const loose = player as {
        setLiveLowLatencyEnabled?: (on: boolean) => void;
        setRebufferToLive?: (on: boolean) => void;
        setInitialBufferDuration?: (seconds: number) => void;
      };
      // Phone HLS was stall-then-jump at aggressive live-edge. Prefer a stable buffer.
      loose.setLiveLowLatencyEnabled?.(false);
      loose.setRebufferToLive?.(false);
      loose.setInitialBufferDuration?.(3);
      player.addEventListener(ivs.PlayerState.PLAYING, markFirst);
      player.addEventListener(ivs.PlayerEventType.ERROR, onPlayerError);
      video.addEventListener("timeupdate", markFirst);
      player.load(src);
      latencyTimer = window.setInterval(() => {
        const sec = player?.getLiveLatency?.();
        if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) onLatency(sec);
        else onLatency(4);
      }, 1000);
    };

    void start().catch(() => {
      if (!cancelled) onFatal();
    });

    return () => {
      cancelled = true;
      clearFatalTimer();
      clearRetry();
      if (latencyTimer) window.clearInterval(latencyTimer);
      video.removeEventListener("playing", markFirst);
      video.removeEventListener("timeupdate", markFirst);
      video.removeEventListener("error", onNativeError);
      try {
        player?.delete?.();
      } catch {
        /* ignore */
      }
    };
  }, [src, muted, onFirstFrame, onFatal, onLatency]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted={muted}
      className={
        objectFit === "contain"
          ? "tls-program h-full w-full"
          : "tls-program tls-program-cover h-full w-full"
      }
      crossOrigin="anonymous"
    />
  );
}
