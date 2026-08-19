"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { OverlayPos, OverlayPositions, OverlayState, StudioOverlayId } from "@/lib/studioDualView";
import type { OverlayFeedEvent } from "@/lib/studioOverlayFeed";
import "@/components/jukebox-cabinet.css";

type DragSession = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  elW: number;
  elH: number;
};

export function ProgramOverlay({
  id,
  className,
  pos,
  movable,
  onPosChange,
  children,
}: {
  id: StudioOverlayId;
  className: string;
  pos: OverlayPos;
  movable?: boolean;
  onPosChange?: (id: StudioOverlayId, next: OverlayPos) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [dragging, setDragging] = useState(false);

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      ref={ref}
      className={`tls-ov ${className}${dragging ? " tls-ov-dragging" : ""}`}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: `scale(${pos.scale || 1})`,
        transformOrigin: "top left",
      }}
      onPointerDown={
        movable && onPosChange
          ? (e) => {
              if (e.button !== 0) return;
              const el = ref.current;
              const layer = el?.closest(
                ".tls-program-overlays",
              ) as HTMLElement | null;
              if (!el || !layer) return;
              e.preventDefault();
              e.stopPropagation();
              const elRect = el.getBoundingClientRect();
              dragRef.current = {
                pointerId: e.pointerId,
                offsetX: e.clientX - elRect.left,
                offsetY: e.clientY - elRect.top,
                elW: elRect.width,
                elH: elRect.height,
              };
              el.setPointerCapture(e.pointerId);
              setDragging(true);
            }
          : undefined
      }
      onPointerMove={
        movable && onPosChange
          ? (e) => {
              const d = dragRef.current;
              if (!d || d.pointerId !== e.pointerId) return;
              const layer = ref.current?.closest(
                ".tls-program-overlays",
              ) as HTMLElement | null;
              if (!layer) return;
              const layerRect = layer.getBoundingClientRect();
              if (layerRect.width <= 0 || layerRect.height <= 0) return;
              let x =
                ((e.clientX - d.offsetX - layerRect.left) / layerRect.width) *
                100;
              let y =
                ((e.clientY - d.offsetY - layerRect.top) / layerRect.height) *
                100;
              const maxX = Math.max(
                0,
                ((layerRect.width - d.elW) / layerRect.width) * 100,
              );
              const maxY = Math.max(
                0,
                ((layerRect.height - d.elH) / layerRect.height) * 100,
              );
              x = Math.min(maxX, Math.max(0, x));
              y = Math.min(maxY, Math.max(0, y));
              onPosChange(id, { x, y, scale: pos.scale || 1 });
            }
          : undefined
      }
      onPointerUp={movable ? endDrag : undefined}
      onPointerCancel={movable ? endDrag : undefined}
    >
      {children}
    </div>
  );
}

export type StudioProgramOverlaysProps = {
  overlayState: OverlayState;
  overlayPositions: OverlayPositions;
  movable?: boolean;
  mini?: boolean;
  onPosChange?: (id: StudioOverlayId, next: OverlayPos) => void;
  gifters: string[];
  goalPct: number;
  goalLabel: string;
  jukeboxNow: string;
  jukeboxArt?: string | null;
  jukeboxTitle?: string;
  jukeboxArtist?: string;
  jukeboxNext?: string;
  jukeboxPos?: number;
  jukeboxDur?: number;
  jukeboxPaused?: boolean;
  giftsLabel: string;
  chatLines: { name: string; text: string }[];
  events: OverlayFeedEvent[];
  timerLabel: string;
  viewers: number;
  watchUrl: string;
};

export function StudioProgramOverlays({
  overlayState,
  overlayPositions,
  movable = false,
  mini = false,
  onPosChange,
  gifters,
  goalPct,
  goalLabel,
  jukeboxNow,
  jukeboxArt = null,
  jukeboxTitle = "",
  jukeboxArtist = "",
  jukeboxNext = "",
  jukeboxPos = 0,
  jukeboxDur = 0,
  jukeboxPaused = true,
  giftsLabel,
  chatLines,
  events,
  timerLabel,
  viewers,
  watchUrl,
}: StudioProgramOverlaysProps) {
  const move = movable ? onPosChange : undefined;
  const layerClass = mini
    ? "tls-program-overlays tls-program-overlays-mini"
    : "tls-program-overlays";
  const nowParts = jukeboxNow.includes("\u2014")
    ? jukeboxNow.split(" \u2014 ")
    : [jukeboxNow];
  const queuedOnly =
    !jukeboxTitle &&
    (!jukeboxNow ||
      jukeboxNow === "Queue empty" ||
      jukeboxNow.startsWith("Up next"));
  const ovTitle = queuedOnly
    ? "Nothing playing"
    : jukeboxTitle || nowParts[0] || "Nothing playing";
  const ovArtist = queuedOnly
    ? ""
    : jukeboxArtist || nowParts.slice(1).join(" \u2014 ");
  const playing = !queuedOnly && Boolean(ovTitle) && ovTitle !== "Nothing playing" && !jukeboxPaused;
  const ovTime = (() => {
    const s = Math.max(0, Math.floor((jukeboxPos || 0) / 1000));
    const d = Math.max(0, Math.floor((jukeboxDur || 0) / 1000));
    const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    return `${fmt(s)} / ${fmt(d)}`;
  })();

  return (
    <div className={layerClass}>
      {overlayState.gifters ? (
        <ProgramOverlay
          id="gifters"
          className="tls-ov-gifters"
          pos={overlayPositions.gifters}
          movable={movable}
          onPosChange={move}
        >
          <p className="tls-ov-title">Top gifters</p>
          {mini ? (
            <p className="tls-ov-sub">Gifters</p>
          ) : (
            <ol>
              {gifters.slice(0, 5).map((g, i) => (
                <li key={`${g}-${i}`}>{g}</li>
              ))}
            </ol>
          )}
        </ProgramOverlay>
      ) : null}

      {overlayState.goal ? (
        <ProgramOverlay
          id="goal"
          className="tls-ov-goal"
          pos={overlayPositions.goal}
          movable={movable}
          onPosChange={move}
        >
          <p className="tls-ov-title">{goalLabel}</p>
          <div className="tls-ov-bar">
            <span style={{ width: `${Math.min(100, Math.max(0, goalPct))}%` }} />
          </div>
        </ProgramOverlay>
      ) : null}

      {overlayState.jukebox ? (
        <ProgramOverlay
          id="jukebox"
          className="tls-ov-jukebox jbx-ov"
          pos={overlayPositions.jukebox}
          movable={movable}
          onPosChange={move}
        >
          <div className="jbx-ov-card">
            <div className="jbx-ov-row">
              <div className="jbx-ov-ring">
                <div className={playing && jukeboxArt ? "jbx-ov-disc is-spinning" : "jbx-ov-disc"}>
                  {jukeboxArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="jbx-ov-art" src={jukeboxArt} alt="" />
                  ) : (
                    <div className="jbx-ov-art" />
                  )}
                </div>
                <i className="jbx-shine" aria-hidden />
              </div>
              <div className="jbx-ov-copy">
                <p className="jbx-ov-kicker">
                  Now playing
                  <span>{ovTime}</span>
                </p>
                <p className="jbx-ov-now">{ovTitle}</p>
                {ovArtist ? <p className="jbx-ov-by">{ovArtist}</p> : null}
              </div>
            </div>
            {jukeboxNext ? (
              <p className="jbx-ov-next">Up next {"\u00B7"} {jukeboxNext}</p>
            ) : null}
            <p className="jbx-ov-mark" aria-label="Jukebox">
              {Array.from("JUKEBOX").map((ch, i) => (
                <span key={`${ch}-${i}`} style={{ animationDelay: `${i * 0.16}s` }}>
                  {ch}
                </span>
              ))}
            </p>
          </div>
        </ProgramOverlay>
      ) : null}

      {overlayState.gifts ? (
        <ProgramOverlay
          id="gifts"
          className="tls-ov-gifts"
          pos={overlayPositions.gifts}
          movable={movable}
          onPosChange={move}
        >
          {giftsLabel}
        </ProgramOverlay>
      ) : null}

      {overlayState.chat ? (
        <ProgramOverlay
          id="chat"
          className="tls-ov-chat"
          pos={overlayPositions.chat}
          movable={movable}
          onPosChange={move}
        >
          {mini ? (
            "Chat"
          ) : chatLines.length === 0 ? (
            <p className="tls-ov-sub">Chat dock</p>
          ) : (
            <ul className="tls-ov-chat-list">
              {chatLines.slice(0, 5).map((c, i) => (
                <li key={`${c.name}-${i}`}>
                  <strong>{c.name}</strong> {c.text}
                </li>
              ))}
            </ul>
          )}
        </ProgramOverlay>
      ) : null}

      {overlayState.events ? (
        <ProgramOverlay
          id="events"
          className="tls-ov-events"
          pos={overlayPositions.events}
          movable={movable}
          onPosChange={move}
        >
          <p className="tls-ov-title">Recent</p>
          {events.length === 0 ? (
            <p className="tls-ov-sub">Waiting for events…</p>
          ) : (
            <ul className="tls-ov-events-list">
              {events.slice(0, 4).map((ev) => (
                <li key={ev.id}>{ev.text}</li>
              ))}
            </ul>
          )}
        </ProgramOverlay>
      ) : null}

      {overlayState.timer ? (
        <ProgramOverlay
          id="timer"
          className="tls-ov-timer"
          pos={overlayPositions.timer}
          movable={movable}
          onPosChange={move}
        >
          <p className="tls-ov-title">LIVE</p>
          <p className="tls-ov-timer-value">{timerLabel}</p>
        </ProgramOverlay>
      ) : null}

      {overlayState.viewers ? (
        <ProgramOverlay
          id="viewers"
          className="tls-ov-viewers"
          pos={overlayPositions.viewers}
          movable={movable}
          onPosChange={move}
        >
          <span className="tls-ov-viewers-dot" aria-hidden />
          {viewers.toLocaleString()} watching
        </ProgramOverlay>
      ) : null}

      {overlayState.qr ? (
        <ProgramOverlay
          id="qr"
          className="tls-ov-qr"
          pos={overlayPositions.qr}
          movable={movable}
          onPosChange={move}
        >
          <p className="tls-ov-title">Watch</p>
          {watchUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="tls-ov-qr-img"
                alt=""
                width={72}
                height={72}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(watchUrl)}`}
              />
              <p className="tls-ov-sub tls-ov-qr-url">{watchUrl.replace(/^https?:\/\//, "")}</p>
            </>
          ) : (
            <p className="tls-ov-sub">Go LIVE for watch QR</p>
          )}
        </ProgramOverlay>
      ) : null}
    </div>
  );
}
