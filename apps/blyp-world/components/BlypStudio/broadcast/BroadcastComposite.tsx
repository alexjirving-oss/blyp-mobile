"use client";

import { useEffect, useRef } from "react";
import type { GridSlot } from "../store/StudioStateContext";
import { RollingNumber } from "../ui/RollingNumber";

type Props = {
  activeMode: "JUST_CHATTING" | "GRID9";
  gridSlots: GridSlot[];
  spotlightSlot: number;
  jackpotPool: number;
  topSupporters: string[];
  previewStream: MediaStream | null;
};

/**
 * Clean Feed only — no Spin / Kick / Promote / director chrome.
 * Director HUD lives in CenterStage overlays; this mirrors viewer layout.
 * IVS publish uses canvas capture (useStreamCapture), not html2canvas of this DOM.
 */
export function BroadcastComposite({
  activeMode,
  gridSlots,
  spotlightSlot,
  jackpotPool,
  topSupporters,
  previewStream,
}: Props) {
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const spotlight =
    gridSlots.find((s) => s.index === spotlightSlot) ?? gridSlots[0];

  useEffect(() => {
    const el = hostVideoRef.current;
    if (!el || !previewStream) return;
    if (el.srcObject !== previewStream) el.srcObject = previewStream;
    el.muted = true;
    void el.play().catch(() => undefined);
  }, [previewStream, activeMode, spotlightSlot]);

  return (
    <div className="blyp-studio-clean-feed" data-clean-feed="true">
      <div className="blyp-studio-clean-topbar">
        <span className="blyp-studio-clean-jackpot">
          JACKPOT{" "}
          <RollingNumber
            value={jackpotPool}
            className="font-display text-[var(--blyp-gold)]"
          />
        </span>
        <span className="blyp-studio-clean-supporters">
          Top Supporters:{" "}
          {topSupporters.length ? topSupporters.join(" · ") : "—"}
        </span>
      </div>

      {activeMode !== "GRID9" ? (
        <div className="blyp-studio-clean-chat">
          <video
            ref={hostVideoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />
        </div>
      ) : (
        <>
          <div
            key={spotlightSlot}
            className="blyp-studio-clean-spotlight blyp-studio-spotlight-glide"
          >
            {spotlight?.kind === "host" && spotlightSlot === 1 ? (
              <video
                ref={hostVideoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
                autoPlay
              />
            ) : (
              <CleanSlotFace slot={spotlight} large />
            )}
            <div className="blyp-studio-clean-spotlight-label">
              Spotlight · Slot {spotlightSlot}
              {spotlight?.displayName ? ` · ${spotlight.displayName}` : ""}
            </div>
          </div>
          <div className="blyp-studio-clean-grid">
            {gridSlots.map((slot) => (
              <div
                key={slot.index}
                className={`blyp-studio-clean-cell ${
                  slot.index === spotlightSlot ? "is-spotlight-target" : ""
                } ${slot.kind === "empty" ? "is-empty" : ""}`}
              >
                {slot.index === 1 && slot.kind === "host" ? (
                  <div className="flex h-full w-full items-center justify-center bg-black text-[10px] text-[var(--blyp-muted)]">
                    HOST
                  </div>
                ) : (
                  <CleanSlotFace slot={slot} />
                )}
                <div className="blyp-studio-grid-meta">
                  <span>S{slot.index}</span>
                  <span>HP {slot.health}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CleanSlotFace({
  slot,
  large,
}: {
  slot: GridSlot | undefined;
  large?: boolean;
}) {
  if (!slot || slot.kind === "empty") {
    return (
      <div className="flex h-full items-center justify-center text-[10px] text-[var(--blyp-muted)]">
        Empty
      </div>
    );
  }
  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-1 ${large ? "text-sm" : "text-[10px]"}`}
    >
      <span
        className={`flex items-center justify-center rounded-full border border-[rgba(0,240,255,0.45)] bg-[rgba(0,240,255,0.12)] font-semibold text-[#00f0ff] ${large ? "h-12 w-12" : "h-7 w-7"}`}
      >
        {slot.avatarLabel ?? "?"}
      </span>
      <span className="truncate px-1">{slot.displayName}</span>
    </div>
  );
}
