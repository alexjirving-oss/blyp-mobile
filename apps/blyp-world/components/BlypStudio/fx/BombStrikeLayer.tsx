"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { shouldPreferNukeFallback } from "@/lib/studioMobileLite";
import { studioAudio } from "../audio/StudioAudioEngine";
import {
  installBombStrikeGlobal,
  subscribeBombStrike,
  type BombStrikeEvent,
} from "./bombStrikeBus";
import "./bomb-strike.css";

/**
 * Full-plate rembg VP9+alpha (scenic BG removed; hands + bomb kept).
 * Matches inspect look: `_inspect/rembg_frame_003.png`.
 * Bomb-only crop (`nukemonkey-bomb.webm`) was rejected — do not use as primary.
 */
export const NUKEMONKEY_WEBM = "/studio/fx/nukemonkey-keyed.webm";
/** @deprecated Prefer NUKEMONKEY_WEBM */
export const NUKEMONKEY_MP4 = NUKEMONKEY_WEBM;

const FLY_MS = 700;
const BURST_MS = 1100;
/** Near-full keyed clip (~11s @ 20fps). */
const VIDEO_MAX_MS = 12000;
const TOTAL_MS = VIDEO_MAX_MS;

type CellRect = { x: number; y: number; w: number; h: number; el: HTMLElement };

type ActiveStrike = {
  id: string;
  cellIndex: number;
  rect: CellRect;
  mode: "video" | "fallback";
  phase: "fly" | "burst";
  born: number;
};

type Spark = { id: string; dx: string; dy: string };

function RiderSvg() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <ellipse cx="32" cy="58" rx="16" ry="3" fill="rgba(0,0,0,0.35)" />
      <circle cx="32" cy="38" r="16" fill="#1a1a22" stroke="#3a3a48" strokeWidth="2" />
      <rect x="29" y="18" width="6" height="8" rx="1.5" fill="#4a4a58" />
      <path
        d="M32 18 C36 12 42 10 44 8"
        fill="none"
        stroke="#c45a18"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="45" cy="7" r="3" fill="#ffb020" />
      <ellipse cx="32" cy="22" rx="9" ry="7" fill="#5c3a22" />
      <circle cx="28" cy="20" r="1.4" fill="#1a120c" />
      <circle cx="36" cy="20" r="1.4" fill="#1a120c" />
      <path d="M24 26 Q32 30 40 26 L42 34 Q32 40 22 34 Z" fill="#6b4428" />
      <path
        d="M22 28 Q16 24 14 20"
        fill="none"
        stroke="#6b4428"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M42 28 Q48 24 50 20"
        fill="none"
        stroke="#6b4428"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function measureCell(root: HTMLElement, cellIndex: number): CellRect | null {
  const el = root.querySelector<HTMLElement>(`[data-bomb-cell="${cellIndex}"]`);
  if (!el) return null;
  const rr = root.getBoundingClientRect();
  const cr = el.getBoundingClientRect();
  return {
    el,
    x: cr.left - rr.left,
    y: cr.top - rr.top,
    w: cr.width,
    h: cr.height,
  };
}

function videoBoxStyle(rect: CellRect): CSSProperties {
  // Center bomb/explosion on the cell; slightly larger than the tile.
  const scale = 1.7;
  const w = Math.max(rect.w * scale, 110);
  const h = Math.max(rect.h * scale, 110);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    left: cx - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
  };
}

/**
 * Absolute FX layer. Parent should be `position: relative` and contain
 * elements marked with `data-bomb-cell="0"…"8"`.
 * Hero: keyed Nukemonkey WEBM (bomb/explosion only) over the target cell.
 */
export function BombStrikeLayer({
  stageRef,
}: {
  stageRef: React.RefObject<HTMLElement | null>;
}) {
  const [strike, setStrike] = useState<ActiveStrike | null>(null);
  const [riderPos, setRiderPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [shaking, setShaking] = useState(false);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const clearTimers = useRef<number[]>([]);
  const videoOkRef = useRef<boolean | null>(null);

  const clearAll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    clearTimers.current.forEach((t) => window.clearTimeout(t));
    clearTimers.current = [];
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    installBombStrikeGlobal();
    // Fold / coarse: skip ~9MB VP9+alpha probe — CSS fallback only.
    if (shouldPreferNukeFallback()) {
      videoOkRef.current = false;
      return () => {
        clearAll();
      };
    }
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = NUKEMONKEY_WEBM;
    const onOk = () => {
      videoOkRef.current = true;
    };
    const onFail = () => {
      videoOkRef.current = false;
    };
    probe.addEventListener("loadeddata", onOk, { once: true });
    probe.addEventListener("error", onFail, { once: true });
    return () => {
      clearAll();
      probe.removeEventListener("loadeddata", onOk);
      probe.removeEventListener("error", onFail);
      probe.src = "";
    };
  }, [clearAll]);

  const finishStrike = useCallback((targetEl: HTMLElement) => {
    targetEl.classList.remove("bomb-strike-flash");
    setStrike(null);
    setSparks([]);
    setShaking(false);
    setRiderPos(null);
  }, []);

  const runFallback = useCallback(
    (event: BombStrikeEvent, target: CellRect) => {
      const cx = target.x + target.w / 2;
      const cy = target.y + target.h / 2;
      const root = stageRef.current;
      if (!root) return;
      const rr = root.getBoundingClientRect();
      const startX = rr.width * 0.5;
      const startY = -40;
      const born = performance.now();

      setStrike({
        id: event.id,
        cellIndex: event.cellIndex,
        rect: target,
        mode: "fallback",
        phase: "fly",
        born,
      });
      setRiderPos({ x: startX, y: startY });
      setSparks([]);
      setShaking(false);

      target.el.classList.remove("bomb-strike-flash");
      void target.el.offsetWidth;

      const tick = (now: number) => {
        const t = Math.min(1, (now - born) / FLY_MS);
        const ease = 1 - (1 - t) ** 3;
        setRiderPos({
          x: startX + (cx - startX) * ease,
          y: startY + (cy - startY) * ease,
        });
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        setStrike((prev) =>
          prev && prev.id === event.id ? { ...prev, phase: "burst" } : prev,
        );
        setRiderPos(null);
        setShaking(true);
        target.el.classList.add("bomb-strike-flash");
        studioAudio.playBombBoom();

        const dirs: Spark[] = Array.from({ length: 8 }, (_, i) => {
          const a = (Math.PI * 2 * i) / 8;
          return {
            id: `${event.id}-s${i}`,
            dx: `${Math.cos(a) * 56}px`,
            dy: `${Math.sin(a) * 56}px`,
          };
        });
        setSparks(dirs);

        clearTimers.current.push(
          window.setTimeout(() => setShaking(false), 450),
          window.setTimeout(() => finishStrike(target.el), BURST_MS),
        );
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [stageRef, finishStrike],
  );

  const runVideo = useCallback(
    (event: BombStrikeEvent, target: CellRect) => {
      setStrike({
        id: event.id,
        cellIndex: event.cellIndex,
        rect: target,
        mode: "video",
        phase: "burst",
        born: performance.now(),
      });
      setRiderPos(null);
      setSparks([]);
      setShaking(true);
      target.el.classList.remove("bomb-strike-flash");
      void target.el.offsetWidth;
      target.el.classList.add("bomb-strike-flash");
      studioAudio.playBombBoom();

      clearTimers.current.push(
        window.setTimeout(() => setShaking(false), 450),
        window.setTimeout(() => finishStrike(target.el), VIDEO_MAX_MS),
      );
    },
    [finishStrike],
  );

  // Start MP4 after the <video> node mounts for this strike.
  useEffect(() => {
    if (!strike || strike.mode !== "video") return;
    const v = videoRef.current;
    const targetEl = strike.rect.el;
    if (!v) return;

    let cancelled = false;
    v.src = NUKEMONKEY_WEBM;
    v.currentTime = 0;
    // Video is silent (SFX via StudioAudioEngine); keep muted for autoplay safety.
    v.muted = true;
    v.playsInline = true;

    const onEnded = () => {
      if (cancelled) return;
      finishStrike(targetEl);
    };
    const onErr = () => {
      if (cancelled) return;
      videoOkRef.current = false;
      const cellIndex = strike.cellIndex;
      const rect = strike.rect;
      const id = strike.id;
      clearAll();
      runFallback(
        { id, cellIndex, at: Date.now() },
        rect,
      );
    };

    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onErr);
    void v.play().catch(() => onErr());

    return () => {
      cancelled = true;
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onErr);
    };
  }, [strike, clearAll, finishStrike, runFallback]);

  useEffect(() => {
    return subscribeBombStrike((event: BombStrikeEvent) => {
      const root = stageRef.current;
      if (!root) return;
      const target = measureCell(root, event.cellIndex);
      if (!target) return;

      clearAll();

      if (videoOkRef.current === false || shouldPreferNukeFallback()) {
        runFallback(event, target);
        return;
      }
      runVideo(event, target);
    });
  }, [stageRef, clearAll, runVideo, runFallback]);

  if (!strike) return null;

  const cx = strike.rect.x + strike.rect.w / 2;
  const cy = strike.rect.y + strike.rect.h / 2;

  return (
    <div
      className={`bomb-strike-root ${shaking ? "is-shaking" : ""}`}
      aria-hidden
    >
      {strike.mode === "video" ? (
        <div className="bomb-strike-video-wrap" style={videoBoxStyle(strike.rect)}>
          <video
            key={strike.id}
            ref={videoRef}
            className="bomb-strike-video"
            muted
            playsInline
            preload="auto"
          />
        </div>
      ) : null}

      {strike.mode === "fallback" && strike.phase === "fly" && riderPos ? (
        <div
          className="bomb-strike-rider is-flying"
          style={{ left: riderPos.x, top: riderPos.y }}
        >
          <RiderSvg />
        </div>
      ) : null}

      {strike.mode === "fallback" && strike.phase === "burst" ? (
        <>
          <div
            className="bomb-strike-burst is-on"
            style={{ left: cx, top: cy }}
          />
          {sparks.map((s) => (
            <div
              key={s.id}
              className="bomb-strike-spark is-on"
              style={
                {
                  left: cx,
                  top: cy,
                  "--dx": s.dx,
                  "--dy": s.dy,
                } as CSSProperties
              }
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

/** Relative wrapper that owns the stage ref + FX layer. */
export function BombStrikeStage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`bomb-strike-stage ${className ?? ""}`}>
      {children}
      <BombStrikeLayer stageRef={ref} />
    </div>
  );
}

export const BOMB_STRIKE_DURATION_MS = TOTAL_MS;
