"use client";

import { useEffect, useRef } from "react";
import {
  tiktokLiveStatus,
  tiktokLiveStatusLabel,
} from "@/lib/studioDestinations";
import "./confidence-rail.css";

export type ConfidenceRailProps = {
  previewStream: MediaStream | null;
  tiktokReady: boolean;
  broadcastPhase: string | null;
  broadcastMessage: string | null;
  publishState: string;
};

function bindPreviewVideo(
  el: HTMLVideoElement | null,
  stream: MediaStream | null,
): void {
  if (!el) return;
  if (!stream) {
    el.srcObject = null;
    return;
  }
  if (el.srcObject === stream) {
    if (el.paused) void el.play().catch(() => undefined);
    return;
  }
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  el.srcObject = stream;
  void el.play().catch(() => undefined);
}

type OutputPreviewProps = {
  label: string;
  aspect: "landscape" | "portrait";
  stream: MediaStream | null;
  status?: string;
  statusTone?: "ok" | "warn" | "fail" | "muted";
  dest?: "blyp" | "tiktok";
};

function OutputPreview({
  label,
  aspect,
  stream,
  status,
  statusTone = "muted",
  dest = "blyp",
}: OutputPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    bindPreviewVideo(videoRef.current, stream);
  }, [stream]);

  return (
    <div
      className={
        dest === "tiktok"
          ? "tls-output-preview tls-output-preview-tiktok"
          : "tls-output-preview tls-output-preview-blyp"
      }
    >
      <p className="tls-output-preview-label">{label}</p>
      <div
        className={
          aspect === "portrait"
            ? "tls-output-preview-frame tls-output-preview-frame-portrait"
            : "tls-output-preview-frame tls-output-preview-frame-landscape"
        }
      >
        <video ref={videoRef} muted playsInline autoPlay aria-label={label} />
        {aspect === "landscape" ? (
          <div className="tls-output-crop-guide" aria-hidden>
            <span className="tls-output-crop-guide-frame" />
          </div>
        ) : null}
        {!stream ? (
          <div className="tls-output-preview-empty">
            <span>No preview</span>
          </div>
        ) : null}
      </div>
      {status ? (
        <p className={`tls-output-status tls-output-status-${statusTone}`}>
          {status}
        </p>
      ) : null}
    </div>
  );
}

export function ConfidenceRail({
  previewStream,
  tiktokReady,
  broadcastPhase,
  broadcastMessage,
  publishState,
}: ConfidenceRailProps) {
  const ttStatus = tiktokLiveStatus({
    tiktokReady,
    phase: broadcastPhase,
  });
  const ttLabel = tiktokLiveStatusLabel(ttStatus);

  const blypStatus =
    publishState === "live"
      ? "LIVE"
      : publishState === "publishing"
        ? "Connecting"
        : publishState === "error"
          ? "Error"
          : "Starting";

  const blypTone =
    publishState === "live"
      ? "ok"
      : publishState === "error"
        ? "fail"
        : "warn";

  const ttTone =
    ttStatus === "live"
      ? "ok"
      : ttStatus === "failed"
        ? "fail"
        : ttStatus === "connecting"
          ? "warn"
          : "muted";

  const ttDetail =
    ttStatus === "connecting" && broadcastMessage
      ? broadcastMessage
      : ttStatus === "off" && !tiktokReady
        ? "Not sending"
        : ttLabel;

  return (
    <aside className="tls-confidence-rail" aria-label="Broadcast confidence rail">
      <p className="tls-confidence-kicker">Outputs</p>
      <p className="tls-confidence-lead">
        Teal box is the TikTok center crop.
      </p>

      <OutputPreview
        label="YouTube / Blyp"
        aspect="landscape"
        stream={previewStream}
        status={blypStatus}
        statusTone={blypTone}
        dest="blyp"
      />

      <OutputPreview
        label="TikTok"
        aspect="portrait"
        stream={previewStream}
        status={ttDetail}
        statusTone={ttTone}
        dest="tiktok"
      />
    </aside>
  );
}
