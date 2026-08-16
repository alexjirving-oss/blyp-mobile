"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BroadcastErrorBoundary } from "../BroadcastErrorBoundary";
import { BroadcastComposite } from "../broadcast/BroadcastComposite";
import { useStreamCapture } from "../broadcast/useStreamCapture";
import { startLocalPreview, type LocalPreviewHandle } from "../media/localPreview";
import {
  ROULETTE_DURATION_MS,
  useStudioState,
  type GridSlot,
} from "../store/StudioStateContext";

/**
 * Director monitor (HUD + local preview) + Clean Feed PIP.
 * Phase 2 local preview path preserved; canvas capture feeds IVS Clean Feed.
 */
export function CenterStage() {
  const videoChatRef = useRef<HTMLVideoElement | null>(null);
  const videoSlot1Ref = useRef<HTMLVideoElement | null>(null);
  const videoSpotRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<LocalPreviewHandle | null>(null);
  const {
    activeMode,
    gridSlots,
    spotlightSlot,
    rouletteHighlightSlot,
    isRouletteSpinning,
    jackpotPool,
    topSupporters,
    spinRoulette,
    autoFillSentinels,
    resetMatch,
    previewStreamRef,
    cleanFeedStreamRef,
    standBySignal,
    cameraFrozen,
    setCameraFrozen,
    setStandBySignal,
    focusSlot,
    pushFeed,
  } = useStudioState();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const handle = await startLocalPreview(null);
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        previewStreamRef.current = handle.stream;
        setPreviewStream(handle.stream);
        setPreviewReady(true);
        setPreviewError(null);
        setCameraFrozen(false);
        const vt = handle.stream.getVideoTracks()[0];
        if (vt) {
          vt.addEventListener("ended", () => {
            setCameraFrozen(true);
            pushFeed("📷 Webcam ended — freezing last frame / host avatar on Slot 1.");
          });
        }
      } catch (e) {
        if (cancelled) return;
        setPreviewReady(false);
        setPreviewError(
          e instanceof Error ? e.message : "Camera preview unavailable",
        );
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.stop();
      handleRef.current = null;
      previewStreamRef.current = null;
      setPreviewStream(null);
    };
  }, [previewStreamRef, pushFeed, setCameraFrozen]);

  useEffect(() => {
    const stream = handleRef.current?.stream;
    if (!stream || !previewReady) return;

    const attach = (el: HTMLVideoElement | null) => {
      if (!el) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      el.muted = true;
      el.playsInline = true;
      void el.play().catch(() => undefined);
    };

    if (activeMode === "GRID9") {
      attach(videoSlot1Ref.current);
      if (spotlightSlot === 1) attach(videoSpotRef.current);
    } else {
      attach(videoChatRef.current);
    }
  }, [activeMode, previewReady, spotlightSlot, gridSlots]);

  const captureState = useMemo(
    () => ({
      activeMode,
      gridSlots,
      spotlightSlot,
      jackpotPool,
      topSupporters,
      standBySignal,
      cameraFrozen,
    }),
    [
      activeMode,
      gridSlots,
      spotlightSlot,
      jackpotPool,
      topSupporters,
      standBySignal,
      cameraFrozen,
    ],
  );

  const { canvasRef } = useStreamCapture({
    previewStream,
    state: captureState,
    cleanFeedStreamRef,
  });

  const spotlight =
    gridSlots.find((s) => s.index === spotlightSlot) ?? gridSlots[0];

  return (
    <section className="blyp-studio-region blyp-studio-stage">
      <div className="relative flex aspect-video w-full max-h-full flex-col overflow-hidden rounded-xl border border-dashed border-[rgba(0,210,190,0.35)] bg-black">
        {activeMode !== "GRID9" ? (
          <div className="relative min-h-0 flex-1">
            <video
              ref={videoChatRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            {!previewReady && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-center text-[var(--blyp-muted)]">
                {previewError ?? "Starting camera preview…"}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-[rgba(232,230,240,0.2)] bg-black/60 px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--blyp-muted)]">
              Director · Just chatting
            </div>
          </div>
        ) : (
          <>
            <div
              key={`dir-spot-${spotlightSlot}`}
              className="blyp-studio-spotlight blyp-studio-spotlight-glide relative shrink-0 border-b border-[rgba(232,230,240,0.12)]"
            >
              {spotlight?.kind === "host" && spotlightSlot === 1 ? (
                <video
                  ref={videoSpotRef}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  autoPlay
                />
              ) : (
                <SlotAvatar slot={spotlight} large />
              )}
              <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--blyp-fog)]">
                Spotlight · Slot {spotlightSlot}
                {spotlight?.displayName ? ` · ${spotlight.displayName}` : ""}
              </div>
            </div>

            <div className="blyp-studio-grid9 min-h-0 flex-1 p-1.5">
              {gridSlots.map((slot) => {
                const hot =
                  rouletteHighlightSlot === slot.index ||
                  focusSlot === slot.index ||
                  (!isRouletteSpinning && spotlightSlot === slot.index);
                return (
                  <div
                    key={slot.index}
                    className={`blyp-studio-grid-cell ${hot ? "is-hot" : ""} ${slot.kind === "empty" ? "is-empty" : ""}`}
                  >
                    {slot.index === 1 && slot.kind === "host" ? (
                      <video
                        ref={videoSlot1Ref}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                        autoPlay
                      />
                    ) : (
                      <SlotAvatar slot={slot} />
                    )}
                    <div className="blyp-studio-grid-meta">
                      <span>S{slot.index}</span>
                      <span>
                        HP {slot.health}
                        {slot.shields > 0 ? ` · 🛡${slot.shields}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="blyp-studio-quick-bar">
              <button
                type="button"
                className="blyp-studio-quick-btn"
                onClick={spinRoulette}
                disabled={isRouletteSpinning}
              >
                {isRouletteSpinning
                  ? `Spinning… (~${Math.round(ROULETTE_DURATION_MS / 1000)}s)`
                  : "Spin Roulette"}
              </button>
              <button
                type="button"
                className="blyp-studio-quick-btn"
                onClick={autoFillSentinels}
              >
                Auto-Fill Sentinels
              </button>
              <button
                type="button"
                className="blyp-studio-quick-btn"
                onClick={resetMatch}
              >
                Reset Match
              </button>
            </div>
          </>
        )}

        {/* Clean Feed PIP — isolated from director chrome */}
        <div className="blyp-studio-clean-pip" title="Clean Feed (viewer)">
          <BroadcastErrorBoundary
            onFatal={() => {
              setStandBySignal(true);
              pushFeed("⚠️ Broadcast composite crashed — Clean Feed STAND BY slate armed.");
            }}
          >
            <BroadcastComposite
              activeMode={activeMode}
              gridSlots={gridSlots}
              spotlightSlot={spotlightSlot}
              jackpotPool={jackpotPool}
              topSupporters={topSupporters}
              previewStream={previewStream}
            />
          </BroadcastErrorBoundary>
        </div>

        {/* Offscreen canvas used for IVS captureStream */}
        <canvas
          ref={canvasRef}
          className="blyp-studio-capture-canvas"
          width={1280}
          height={720}
          aria-hidden
        />
      </div>
    </section>
  );
}

function SlotAvatar({
  slot,
  large,
}: {
  slot: GridSlot | undefined;
  large?: boolean;
}) {
  if (!slot || slot.kind === "empty") {
    return (
      <div
        className={`flex h-full w-full items-center justify-center text-[var(--blyp-muted)] ${large ? "text-sm" : "text-[10px]"}`}
      >
        Empty
      </div>
    );
  }
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-[rgba(16,16,22,0.85)] ${large ? "text-base" : "text-[11px]"}`}
    >
      <span
        className={`flex items-center justify-center rounded-full border border-[rgba(0,210,190,0.35)] bg-[rgba(0,210,190,0.12)] font-semibold text-[var(--blyp-teal)] ${large ? "h-14 w-14 text-lg" : "h-8 w-8 text-[10px]"}`}
      >
        {slot.avatarLabel ?? "?"}
      </span>
      <span className="truncate px-1 text-[var(--blyp-fog)]">
        {slot.displayName}
      </span>
      {slot.kind === "sentinel" && (
        <span className="text-[9px] uppercase tracking-wide text-[var(--blyp-muted)]">
          Sentinel
        </span>
      )}
    </div>
  );
}
