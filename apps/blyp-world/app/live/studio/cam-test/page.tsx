"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "./cam-test.css";

function formatCamError(e: unknown): string {
  const name =
    e instanceof DOMException || e instanceof Error ? e.name : "Error";
  const msg = e instanceof Error ? e.message : String(e);
  const core = msg.startsWith(name) ? msg : `${name}: ${msg}`;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return `${core} — allow camera in the browser address bar, then try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `${core} — no matching camera. Plug one in or pick another device.`;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `${core} — camera is busy (close Studio / another tab) and retry.`;
  }
  return core;
}

function trackStats(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0];
  if (!track) return "";
  const s = track.getSettings();
  const bits = [
    s.width && s.height ? `${s.width}×${s.height}` : null,
    s.frameRate ? `${Math.round(s.frameRate)} fps` : null,
    track.label || null,
  ].filter(Boolean);
  return bits.join(" · ");
}

export default function StudioCamTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [mirror, setMirror] = useState(true);
  const [secure, setSecure] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [stats, setStats] = useState("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setOpen(false);
    setStats("");
  }, []);

  const listCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter((d) => d.kind === "videoinput");
    setDevices(cams);
  }, []);

  const start = useCallback(
    async (id?: string) => {
      setError(null);
      const video = videoRef.current;
      if (!video) return;
      if (!window.isSecureContext) {
        setError("Camera needs HTTPS or localhost.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser has no camera API.");
        return;
      }
      setBusy(true);
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const pick = id ?? deviceId;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: pick
            ? { deviceId: { exact: pick } }
            : {
                facingMode: "user",
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        });
        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        const used = stream.getVideoTracks()[0]?.getSettings().deviceId || pick;
        if (used) setDeviceId(used);
        setStats(trackStats(stream));
        setOpen(true);
        await listCameras();
      } catch (e) {
        stop();
        setError(formatCamError(e));
      } finally {
        setBusy(false);
      }
    },
    [deviceId, listCameras, stop],
  );

  useEffect(() => {
    setSecure(window.isSecureContext);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <main className="camtest">
      <div className="camtest-inner">
        <p className="camtest-kicker">Studio</p>
        <h1 className="camtest-title">Camera check</h1>
        <p className="camtest-copy">
          Preview your webcam here before Go LIVE. This page does not publish.
        </p>

        {!secure ? (
          <p className="camtest-warn">
            This origin is not a secure context. Open via HTTPS or localhost.
          </p>
        ) : null}

        <div className="camtest-stage">
          <div className="camtest-video-wrap">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={mirror ? "camtest-video is-mirror" : "camtest-video"}
            />
            {!open ? (
              <div className="camtest-placeholder">
                Camera is off. Open it to confirm the picture.
              </div>
            ) : (
              <span className="camtest-badge">PREVIEW</span>
            )}
            {stats ? <span className="camtest-stats">{stats}</span> : null}
          </div>
          <div className="camtest-controls">
            <select
              className="camtest-select"
              value={deviceId}
              disabled={busy || devices.length === 0}
              onChange={(e) => {
                const next = e.target.value;
                setDeviceId(next);
                if (open) void start(next);
              }}
              aria-label="Camera"
            >
              {devices.length === 0 ? (
                <option value="">Camera list after you open</option>
              ) : (
                devices.map((d, i) => (
                  <option key={d.deviceId || String(i)} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="camtest-btn camtest-btn-go"
              disabled={busy}
              onClick={() => void (open ? stop() : start())}
            >
              {busy ? "Opening…" : open ? "Stop" : "Open camera"}
            </button>
            <button
              type="button"
              className="camtest-btn camtest-btn-ghost"
              disabled={!open}
              onClick={() => setMirror((v) => !v)}
            >
              {mirror ? "Unmirror" : "Mirror"}
            </button>
          </div>
        </div>

        {error ? <p className="camtest-error">{error}</p> : null}

        <Link className="camtest-back" href="/live/studio">
          Back to LIVE Studio
        </Link>
      </div>
    </main>
  );
}
