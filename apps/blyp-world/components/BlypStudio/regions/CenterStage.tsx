"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BroadcastErrorBoundary } from "../BroadcastErrorBoundary";
import { BroadcastComposite } from "../broadcast/BroadcastComposite";
import { openDeskMedia, type DeskMediaHandle } from "@/lib/studioDeskMedia";
import { isStudioMobileLite } from "@/lib/studioMobileLite";
import { studioAudio } from "../audio/StudioAudioEngine";
import { BombStrikeStage } from "../fx/BombStrikeLayer";
import { playBombStrike } from "../fx/bombStrikeBus";
import {
  ROULETTE_DURATION_MS,
  useStudioState,
  type GridSlot,
} from "../store/StudioStateContext";

/** Cycles 0..8 for director “Test strike” demos. */
let testStrikeCursor = 0;

/**
 * Director monitor (HUD + local preview) + Clean Feed PIP (local only).
 * Stage publish uses desk getUserMedia tracks — not this composite canvas.
 */
export function CenterStage() {
  const videoChatRef = useRef<HTMLVideoElement | null>(null);
  const videoSlot1Ref = useRef<HTMLVideoElement | null>(null);
  const videoSpotRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<DeskMediaHandle | null>(null);
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
    setCameraFrozen,
    setStandBySignal,
    focusSlot,
    pushFeed,
    applyNukeStrike,
    layoutOrientation,
    layoutPreset,
    deskScene,
    matchRemainingMs,
    matchWinnerSlot,
    matchEndReason,
    formatMatchClock,
    buybackSlot,
  } = useStudioState();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  /** Fold / phone: skip second Clean Feed PIP video + BombStrikeStage. */
  const mobileLite = useMemo(() => isStudioMobileLite(), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        handleRef.current?.stop();
        handleRef.current = null;
        const handle = await openDeskMedia(deskScene, layoutOrientation);
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        previewStreamRef.current = handle.publishStream || handle.previewStream;
        studioAudio.attachMic(handle.previewStream);
        setPreviewStream(handle.previewStream);
        setPreviewReady(true);
        setPreviewError(null);
        setCameraFrozen(false);
        const vt = handle.previewStream.getVideoTracks()[0];
        if (vt) {
          vt.addEventListener("ended", () => {
            setCameraFrozen(true);
            pushFeed("📷 Source ended — freezing last frame / host avatar.");
          });
        }
        pushFeed(
          deskScene === "camera"
            ? "Camera scene armed"
            : deskScene === "screen"
              ? "Screen share scene armed"
              : "Screen + PIP scene armed",
        );
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
  }, [
    deskScene,
    layoutOrientation,
    previewStreamRef,
    pushFeed,
    setCameraFrozen,
  ]);

  useEffect(() => {
    const stream = handleRef.current?.previewStream;
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
      // Fold: never decode the same MediaStream in spotlight + cell at once.
      if (spotlightSlot === 1 && !mobileLite) attach(videoSpotRef.current);
    } else {
      attach(videoChatRef.current);
    }
  }, [activeMode, previewReady, spotlightSlot, gridSlots, mobileLite]);

  const spotlight =
    gridSlots.find((s) => s.index === spotlightSlot) ?? gridSlots[0];

  return (
    <section className="blyp-studio-region blyp-studio-stage">
      <div className="relative flex aspect-video w-full max-h-full flex-col overflow-hidden rounded-xl border border-dashed border-[var(--blyp-line)] bg-black">
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
              {layoutOrientation === "portrait" ? "Phone" : "PC/tablet"} ·{" "}
              {layoutPreset} · one stream
            </div>
          </div>
        ) : (
          <>
            <div
              key={`dir-spot-${spotlightSlot}`}
              className="blyp-studio-spotlight blyp-studio-spotlight-glide relative shrink-0 border-b border-[rgba(232,230,240,0.12)]"
            >
              {spotlight?.kind === "host" && spotlightSlot === 1 && !mobileLite ? (
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
              {matchRemainingMs != null && (
                <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--blyp-gold)]">
                  {formatMatchClock(matchRemainingMs)}
                  {matchWinnerSlot != null
                    ? ` · WIN S${matchWinnerSlot}`
                    : ""}
                </div>
              )}
              {matchEndReason && matchWinnerSlot != null && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                  <span className="rounded border border-[rgba(232,184,48,0.45)] bg-black/75 px-3 py-1 text-[11px] font-semibold text-[var(--blyp-gold)]">
                    Winner · Slot {matchWinnerSlot}
                    {matchEndReason === "last_standing"
                      ? " · last standing"
                      : " · deadline finale"}
                  </span>
                </div>
              )}
            </div>

            <BombStrikeStage className="blyp-studio-grid9-wrap min-h-0 flex-1">
              <div className="blyp-studio-grid9 min-h-0 flex-1 p-1.5">
                {gridSlots.map((slot) => {
                  const cellIndex = slot.index - 1; // studio 1–9 → bomb 0–8
                  const hot =
                    rouletteHighlightSlot === slot.index ||
                    focusSlot === slot.index ||
                    (!isRouletteSpinning && spotlightSlot === slot.index);
                  return (
                    <button
                      key={slot.index}
                      type="button"
                      data-bomb-cell={cellIndex}
                      title={
                        slot.knockedOut
                          ? `Slot ${slot.index} KO · ${slot.knockoutTokens} tokens`
                          : `Nuke / bomb strike on slot ${slot.index}`
                      }
                      className={`blyp-studio-grid-cell ${hot ? "is-hot" : ""} ${slot.kind === "empty" ? "is-empty" : ""} ${slot.knockedOut ? "is-ko" : ""}`}
                      onClick={() => {
                        playBombStrike(cellIndex);
                        if (!slot.knockedOut) {
                          applyNukeStrike(slot.index);
                        }
                      }}
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
                        <span>S{slot.index}{slot.knockedOut ? " · KO" : ""}</span>
                        <span>
                          HP {slot.health}/1000
                          {slot.shields > 0 ? ` · 🛡${slot.shields}` : ""}
                          {slot.knockedOut
                            ? ` · ${slot.knockoutTokens} tok`
                            : ""}
                        </span>
                        {slot.knockedOut && !matchEndReason && (
                          <button
                            type="button"
                            className="blyp-studio-mini-btn is-on mt-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              buybackSlot(slot.index);
                            }}
                          >
                            Buy back 500
                          </button>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </BombStrikeStage>

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
              <button
                type="button"
                className="blyp-studio-quick-btn"
                onClick={() => {
                  const i = testStrikeCursor % 9;
                  testStrikeCursor += 1;
                  playBombStrike(i);
                  applyNukeStrike(i + 1);
                }}
              >
                Test strike
              </button>
            </div>
          </>
        )}

        {/* Clean Feed PIP — isolated from director chrome (skip on Fold/phone). */}
        {!mobileLite ? (
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
        ) : null}
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
        className={`flex items-center justify-center rounded-full border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] font-semibold text-[var(--blyp-fog)] ${large ? "h-14 w-14 text-lg" : "h-8 w-8 text-[10px]"}`}
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
