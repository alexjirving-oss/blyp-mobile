"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { ActiveMode, GridSlot } from "../store/StudioStateContext";

const W = 1280;
const H = 720;

export type StreamCaptureHandle = {
  /** Combined Clean Feed video (canvas) + mic audio when available */
  getPublishStream: () => MediaStream | null;
};

type CaptureState = {
  activeMode: ActiveMode;
  gridSlots: GridSlot[];
  spotlightSlot: number;
  jackpotPool: number;
  topSupporters: string[];
  standBySignal: boolean;
  cameraFrozen: boolean;
};

/**
 * Canvas compositor → MediaStream via HTMLCanvasElement.captureStream.
 * Avoids html2canvas (deferred as too heavy/janky for IVS).
 * Draws host camera frames + GRID9 HUD (spotlight, 3×3, jackpot, supporters).
 * Director chrome is never drawn here.
 */
export function useStreamCapture(opts: {
  previewStream: MediaStream | null;
  state: CaptureState;
  cleanFeedStreamRef: MutableRefObject<MediaStream | null>;
}): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  capture: StreamCaptureHandle;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const publishBundleRef = useRef<MediaStream | null>(null);
  const audioClonesRef = useRef<MediaStreamTrack[]>([]);
  const stateRef = useRef(opts.state);
  stateRef.current = opts.state;

  // Hidden source video for drawImage (does not replace Phase 2 preview elements).
  useEffect(() => {
    if (typeof document === "undefined") return;
    let video = sourceVideoRef.current;
    if (!video) {
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.style.position = "fixed";
      video.style.left = "-9999px";
      video.style.width = "1px";
      video.style.height = "1px";
      document.body.appendChild(video);
      sourceVideoRef.current = video;
    }
    return () => {
      if (sourceVideoRef.current) {
        sourceVideoRef.current.srcObject = null;
        sourceVideoRef.current.remove();
        sourceVideoRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = sourceVideoRef.current;
    const stream = opts.previewStream;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [opts.previewStream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!canvasStreamRef.current) {
      canvasStreamRef.current = canvas.captureStream(30);
    }

    let raf = 0;
    const draw = () => {
      const s = stateRef.current;
      const video = sourceVideoRef.current;

      if (s.standBySignal) {
        ctx.fillStyle = "#050508";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#e8e6f0";
        ctx.font = "700 48px Syne, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("PLEASE STAND BY", W / 2, H / 2 - 24);
        ctx.fillStyle = "#00f0ff";
        ctx.font = "600 28px DM Sans, sans-serif";
        ctx.fillText("SIGNAL LOST", W / 2, H / 2 + 28);
        ctx.textAlign = "left";
        raf = requestAnimationFrame(draw);
        return;
      }

      ctx.fillStyle = "#07070a";
      ctx.fillRect(0, 0, W, H);

      // Top bar: jackpot + supporters
      ctx.fillStyle = "rgba(16,16,22,0.95)";
      ctx.fillRect(0, 0, W, 56);
      ctx.fillStyle = "#e8c47c";
      ctx.font = "700 22px Syne, sans-serif";
      ctx.fillText(`JACKPOT ${s.jackpotPool}`, 24, 36);
      ctx.fillStyle = "#9a97a8";
      ctx.font = "500 16px DM Sans, sans-serif";
      const supporters =
        s.topSupporters.length > 0
          ? `Top Supporters: ${s.topSupporters.join(" · ")}`
          : "Top Supporters: —";
      ctx.fillText(supporters, 280, 36);

      const videoOk =
        !s.cameraFrozen && video && video.readyState >= 2;

      if (s.activeMode !== "GRID9") {
        if (videoOk && video) {
          drawCover(ctx, video, 0, 56, W, H - 56);
        } else if (s.cameraFrozen) {
          // Keep prior frame pixels — do not clear the video region aggressively.
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(0, H - 40, W, 40);
          ctx.fillStyle = "#e8c47c";
          ctx.font = "14px sans-serif";
          ctx.fillText("HOST CAM FROZEN — last frame / avatar", 24, H - 16);
        } else {
          ctx.fillStyle = "#9a97a8";
          ctx.font = "18px sans-serif";
          ctx.fillText("Waiting for camera…", 40, H / 2);
        }
      } else {
        const spotY = 56;
        const spotH = Math.floor((H - 56) * 0.34);
        const gridY = spotY + spotH + 8;
        const gridH = H - gridY - 12;
        const gap = 6;
        const cellW = (W - gap * 4) / 3;
        const cellH = (gridH - gap * 4) / 3;

        // Spotlight
        ctx.fillStyle = "#0c0c10";
        ctx.fillRect(12, spotY, W - 24, spotH);
        const spot = s.gridSlots.find((g) => g.index === s.spotlightSlot);
        if (
          spot?.kind === "host" &&
          s.spotlightSlot === 1 &&
          videoOk &&
          video
        ) {
          drawCover(ctx, video, 12, spotY, W - 24, spotH);
        } else {
          drawFace(ctx, spot, 12, spotY, W - 24, spotH);
        }
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(12, spotY, W - 24, 28);
        ctx.fillStyle = "#e8e6f0";
        ctx.font = "600 14px sans-serif";
        ctx.fillText(
          `Spotlight · Slot ${s.spotlightSlot}${spot?.displayName ? ` · ${spot.displayName}` : ""}`,
          24,
          spotY + 19,
        );

        ctx.strokeStyle = "rgba(0,240,255,0.55)";
        ctx.lineWidth = 3;
        ctx.strokeRect(12, spotY, W - 24, spotH);

        for (let i = 0; i < 9; i++) {
          const slot = s.gridSlots[i];
          const col = i % 3;
          const row = Math.floor(i / 3);
          const x = gap + col * (cellW + gap);
          const y = gridY + gap + row * (cellH + gap);
          const hot = slot.index === s.spotlightSlot;
          ctx.fillStyle = "#0c0c10";
          ctx.fillRect(x, y, cellW, cellH);
          if (
            slot.index === 1 &&
            slot.kind === "host" &&
            videoOk &&
            video
          ) {
            drawCover(ctx, video, x, y, cellW, cellH);
          } else {
            drawFace(ctx, slot, x, y, cellW, cellH);
          }
          if (hot) {
            ctx.shadowColor = "rgba(0,240,255,0.5)";
            ctx.shadowBlur = 15;
            ctx.strokeStyle = "#00f0ff";
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
            ctx.shadowBlur = 0;
          } else {
            ctx.strokeStyle = "rgba(232,230,240,0.2)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cellW, cellH);
          }
          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(x, y + cellH - 22, cellW, 22);
          ctx.fillStyle = "#9a97a8";
          ctx.font = "11px sans-serif";
          ctx.fillText(`S${slot.index}  HP ${slot.health}`, x + 6, y + cellH - 7);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Rebuild publish bundle when preview audio or canvas stream changes.
  useEffect(() => {
    audioClonesRef.current.forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    audioClonesRef.current = [];

    const canvasStream = canvasStreamRef.current;
    if (!canvasStream) {
      publishBundleRef.current = null;
      opts.cleanFeedStreamRef.current = null;
      return;
    }

    const bundle = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => bundle.addTrack(t));

    const preview = opts.previewStream;
    if (preview) {
      preview.getAudioTracks().forEach((t) => {
        const clone = t.clone();
        audioClonesRef.current.push(clone);
        bundle.addTrack(clone);
      });
    }

    publishBundleRef.current = bundle;
    opts.cleanFeedStreamRef.current = bundle;

    return () => {
      audioClonesRef.current.forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      audioClonesRef.current = [];
    };
  }, [opts.previewStream, opts.cleanFeedStreamRef]);

  const capture: StreamCaptureHandle = {
    getPublishStream: () => publishBundleRef.current ?? canvasStreamRef.current,
  };

  return { canvasRef, capture };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(video, dx, dy, dw, dh);
  ctx.restore();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  slot: GridSlot | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = "#101016";
  ctx.fillRect(x, y, w, h);
  if (!slot || slot.kind === "empty") {
    ctx.fillStyle = "#9a97a8";
    ctx.font = "14px sans-serif";
    ctx.fillText("Empty", x + w / 2 - 22, y + h / 2);
    return;
  }
  const cx = x + w / 2;
  const cy = y + h / 2 - 8;
  const r = Math.min(w, h) * 0.18;
  ctx.fillStyle = "rgba(0,240,255,0.15)";
  ctx.strokeStyle = "rgba(0,240,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#00f0ff";
  ctx.font = `700 ${Math.max(12, r * 0.7)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(slot.avatarLabel ?? "?", cx, cy + r * 0.35);
  ctx.fillStyle = "#e8e6f0";
  ctx.font = "12px sans-serif";
  ctx.fillText(slot.displayName ?? "", cx, cy + r + 18);
  ctx.textAlign = "left";
}
