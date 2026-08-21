/**
 * OBS-style program burn-in for LIVE Studio restreams.
 * Draws host + on-stage guest <video> tiles and overlay widgets into one
 * canvas MediaStream (portrait 720×1280 / landscape 1280×720).
 * Does not use html2canvas. Invite / director chrome is not drawn.
 * Do not pass this canvas to Stage / startIvsWebHostPublish — camera
 * publish must be getUserMedia tracks. Overlay burn-in is local only.
 */

import {
  DESK_PUBLISH_FPS,
  type DeskOrientation,
} from "@/lib/studioDeskMedia";

export type StudioProgramCompositeHandle = {
  setOrientation: (orientation: DeskOrientation) => void;
  setDeskStream: (stream: MediaStream | null) => void;
  getVideoTrack: () => MediaStreamTrack | null;
  stop: () => void;
};

function canvasSize(orientation: DeskOrientation): { w: number; h: number } {
  return orientation === "portrait"
    ? { w: 720, h: 1280 }
    : { w: 1280, h: 720 };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  if (dw <= 0 || dh <= 0) return;
  if (video.readyState < 2) return;
  const vw = video.videoWidth || dw;
  const vh = video.videoHeight || dh;
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function mapRect(
  el: Element,
  root: DOMRect,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const sx = canvasW / Math.max(1, root.width);
  const sy = canvasH / Math.max(1, root.height);
  return {
    x: (r.left - root.left) * sx,
    y: (r.top - root.top) * sy,
    w: r.width * sx,
    h: r.height * sy,
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fillMappedRect(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

function drawOverlayWidget(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  text: string,
) {
  ctx.save();
  roundedRect(ctx, box.x, box.y, box.w, box.h, Math.min(10, box.w / 8));
  ctx.fillStyle = "rgba(8, 10, 14, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 210, 190, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(box.x + 4, box.y + 3, Math.max(0, box.w - 8), Math.max(0, box.h - 6));
  ctx.clip();
  ctx.fillStyle = "#e8e6f0";
  const fontPx = Math.max(9, Math.min(18, box.h * 0.22));
  ctx.font = `700 ${fontPx}px "DM Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
  let y = box.y + 6;
  const lineH = fontPx + 3;
  for (const line of lines) {
    if (y > box.y + box.h - 4) break;
    ctx.fillText(line, box.x + 8, y, Math.max(8, box.w - 16));
    y += lineH;
  }
  ctx.restore();
}

function drawProgramFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  deskVideo: HTMLVideoElement | null,
) {
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, w, h);

  if (deskVideo) drawCover(ctx, deskVideo, 0, 0, w, h);

  const rootEl = document.querySelector("[data-program-root]");
  const hostVideo = (rootEl?.querySelector("video.tls-program") ||
    document.querySelector("video.tls-program") ||
    deskVideo) as HTMLVideoElement | null;

  if (!rootEl) {
    if (hostVideo) drawCover(ctx, hostVideo, 0, 0, w, h);
    return;
  }

  const root = rootEl.getBoundingClientRect();
  if (root.width < 2 || root.height < 2) {
    if (hostVideo) drawCover(ctx, hostVideo, 0, 0, w, h);
    return;
  }

  rootEl.querySelectorAll(".tls-guest-tile-empty").forEach((el) => {
    const box = mapRect(el, root, w, h);
    if (box) fillMappedRect(ctx, box, "#0c0c12");
  });

  rootEl.querySelectorAll(".tls-guest-tile:not(.tls-guest-tile-empty)").forEach((el) => {
    const box = mapRect(el, root, w, h);
    if (box) fillMappedRect(ctx, box, "#050508");
  });

  const hostPane = rootEl.querySelector(".tls-program-host");
  if (hostPane) {
    const box = mapRect(hostPane, root, w, h);
    if (box) fillMappedRect(ctx, box, "#050508");
  }

  if (hostVideo) {
    const box = mapRect(hostVideo, root, w, h);
    if (box) drawCover(ctx, hostVideo, box.x, box.y, box.w, box.h);
    else drawCover(ctx, hostVideo, 0, 0, w, h);
  }

  rootEl.querySelectorAll("video.tls-guest-video").forEach((node) => {
    const video = node as HTMLVideoElement;
    const box = mapRect(video, root, w, h);
    if (box) drawCover(ctx, video, box.x, box.y, box.w, box.h);
  });

  rootEl.querySelectorAll(".tls-cam-off-veil").forEach((el) => {
    const box = mapRect(el, root, w, h);
    if (!box) return;
    ctx.fillStyle = "rgba(5, 5, 8, 0.72)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = "#e8e6f0";
    ctx.font = `700 ${Math.max(14, box.h * 0.06)}px "DM Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Camera off", box.x + box.w / 2, box.y + box.h / 2);
    ctx.textAlign = "left";
  });

  rootEl
    .querySelectorAll(".tls-guest-tile:not(.tls-guest-tile-empty) .tls-guest-tile-id")
    .forEach((el) => {
      const box = mapRect(el, root, w, h);
      if (!box) return;
      ctx.fillStyle = "#e8e6f0";
      ctx.font = `700 ${Math.max(10, box.h)}px "DM Sans", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(
        (el.textContent || "").trim(),
        box.x,
        box.y,
        Math.max(8, box.w),
      );
    });

  const bomb = rootEl.querySelector("video.bomb-strike-video") as
    | HTMLVideoElement
    | null;
  if (bomb && bomb.readyState >= 2) {
    const wrap = bomb.parentElement;
    const box = mapRect(wrap || bomb, root, w, h);
    if (box) drawCover(ctx, bomb, box.x, box.y, box.w, box.h);
  }

  rootEl.querySelectorAll(".tls-ov").forEach((el) => {
    const box = mapRect(el, root, w, h);
    if (!box) return;
    const text = (el as HTMLElement).innerText || "";
    drawOverlayWidget(ctx, box, text);
  });
}

export function createStudioProgramComposite(
  orientation: DeskOrientation = "portrait",
): StudioProgramCompositeHandle {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-program-composite", "true");
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.opacity = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "-1";
  document.body.appendChild(canvas);

  const deskVideo = document.createElement("video");
  deskVideo.muted = true;
  deskVideo.playsInline = true;
  deskVideo.setAttribute("playsinline", "true");
  deskVideo.autoplay = true;
  deskVideo.style.position = "fixed";
  deskVideo.style.opacity = "0";
  deskVideo.style.pointerEvents = "none";
  deskVideo.style.width = "1px";
  deskVideo.style.height = "1px";
  document.body.appendChild(deskVideo);

  const ctx =
    canvas.getContext("2d", { alpha: false }) ||
    canvas.getContext("2d");
  let current = orientation;
  let canvasStream: MediaStream | null = null;
  let timer = 0;
  let stopped = false;

  const hintTrack = (track: MediaStreamTrack | undefined) => {
    if (!track) return;
    try {
      (track as MediaStreamTrack & { contentHint?: string }).contentHint =
        "motion";
    } catch {
      /* ignore */
    }
  };

  const capture = () => {
    canvasStream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    canvasStream = null;
    try {
      canvasStream = canvas.captureStream(DESK_PUBLISH_FPS);
      hintTrack(canvasStream.getVideoTracks()[0]);
    } catch {
      canvasStream = null;
    }
  };

  const applySize = (next: DeskOrientation) => {
    const { w, h } = canvasSize(next);
    const sizeChanged = canvas.width !== w || canvas.height !== h;
    canvas.width = w;
    canvas.height = h;
    current = next;
    if (!canvasStream || sizeChanged) capture();
  };

  applySize(orientation);

  const tick = () => {
    if (stopped || !ctx) return;
    try {
      drawProgramFrame(ctx, canvas.width, canvas.height, deskVideo);
    } catch {
      /* overlay paint must never kill the program clock */
    }
  };

  timer = window.setInterval(tick, Math.round(1000 / DESK_PUBLISH_FPS));
  tick();

  return {
    setOrientation: (next) => {
      if (stopped) return;
      if (
        next === current &&
        canvasStream?.getVideoTracks()[0]?.readyState === "live"
      ) {
        return;
      }
      applySize(next);
    },
    setDeskStream: (stream) => {
      if (stopped) return;
      if (!stream) {
        deskVideo.srcObject = null;
        return;
      }
      if (deskVideo.srcObject !== stream) {
        deskVideo.srcObject = stream;
        void deskVideo.play().catch(() => undefined);
      }
    },
    getVideoTrack: () => {
      const live = canvasStream
        ?.getVideoTracks()
        .find((t) => t.readyState === "live");
      if (live) return live;
      capture();
      return canvasStream?.getVideoTracks()[0] ?? null;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      canvasStream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      canvasStream = null;
      deskVideo.srcObject = null;
      deskVideo.remove();
      canvas.remove();
    },
  };
}

export function buildProgramPublishStream(
  _composite: StudioProgramCompositeHandle,
  desk: { orientation: DeskOrientation; publishStream: MediaStream },
): MediaStream {
  return desk.publishStream;
}
