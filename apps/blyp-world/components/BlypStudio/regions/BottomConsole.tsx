"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import {
  endLiveHostSession,
  heartbeatLiveHostSession,
  persistActiveHostSession,
  startLiveHostSession,
  type LiveHostSession,
} from "@/lib/liveHost";
import {
  startIvsWebHostPublish,
  type IvsHostPublishHandle,
} from "@/lib/ivsWebHost";
import { nativePublishVideoTrack } from "@/lib/studioDeskMedia";
import {
  MUSIC_BEDS,
  STING_PAD,
  studioAudio,
  type MusicBedId,
  type StingId,
} from "../audio/StudioAudioEngine";
import { planPublishAudio } from "@/lib/studioPublishGraph";
import { armSpotifyTabAudioForLive, isStudioSpotifyLinked, TAB_AUDIO_REQUIRED } from "@/lib/studioSpotify";
import { useGrid9StudioOverlayFeed } from "../hooks/useGrid9StudioOverlayFeed";
import { useStudioState } from "../store/StudioStateContext";

/**
 * Master GO LIVE — camera/screen getUserMedia to IVS Stage (same path as
 * /live/studio). Mixer + soundboard ride the audio mix. Never publish the
 * Clean Feed canvas captureStream.
 */
export function BottomConsole() {
  useGrid9StudioOverlayFeed();
  const { session, requireAuth } = useAuth();
  const {
    isLive,
    setIsLive,
    publishError,
    publishBusy,
    setPublishError,
    setPublishBusy,
    previewStreamRef,
    setHostSessionId,
    deskScene,
  } = useStudioState();

  const publishRef = useRef<IvsHostPublishHandle | null>(null);
  const hostSessionRef = useRef<LiveHostSession | null>(null);
  const [micVol, setMicVol] = useState(80);
  const [musicVol, setMusicVol] = useState(45);
  const [activeBed, setActiveBed] = useState<MusicBedId | null>(null);

  const stopPublish = useCallback(async () => {
    const handle = publishRef.current;
    publishRef.current = null;
    if (handle) {
      try {
        await handle.leave();
      } catch {
        /* ignore */
      }
    }
    const host = hostSessionRef.current;
    hostSessionRef.current = null;
    persistActiveHostSession(null);
    setHostSessionId(null);
    if (host && session?.idToken) {
      try {
        await endLiveHostSession(session.idToken, host.sessionId);
      } catch {
        /* soft-fail end */
      }
    }
    setIsLive(false);
  }, [session?.idToken, setHostSessionId, setIsLive]);

  useEffect(() => {
    studioAudio.setMicVolume(micVol / 100);
  }, [micVol]);

  useEffect(() => {
    studioAudio.setMusicVolume(musicVol / 100);
  }, [musicVol]);

  useEffect(() => {
    return studioAudio.subscribePublishMix((wantMix) => {
      const handle = publishRef.current;
      const preview = previewStreamRef.current;
      if (!handle || !preview) return;
      studioAudio.buildPublishStream(preview, preview);
      const mix = studioAudio.mixAudioTrack();
      const gum = studioAudio.nativeAudioTrack(preview);
      const source = planPublishAudio({
        wantMix,
        mixTrackLive: !!mix && mix.readyState === "live",
        gumTrackLive: !!gum && gum.readyState === "live",
      });
      if (source === "mix" && mix) {
        handle.setAudioTrack(mix, false);
        return;
      }
      if (gum) handle.setAudioTrack(gum, false);
    });
  }, [previewStreamRef]);

  useEffect(() => {
    if (!isLive || !hostSessionRef.current?.sessionId || !session?.idToken) {
      return;
    }
    const sessionId = hostSessionRef.current.sessionId;
    const tick = async () => {
      try {
        await heartbeatLiveHostSession(session.idToken, sessionId);
      } catch {
        /* soft-fail heartbeat */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, [isLive, session?.idToken]);

  useEffect(() => {
    return () => {
      void (async () => {
        const handle = publishRef.current;
        publishRef.current = null;
        if (handle) {
          try {
            await handle.leave();
          } catch {
            /* ignore */
          }
        }
      })();
    };
  }, []);

  const onToggle = async () => {
    if (publishBusy) return;

    if (isLive) {
      setPublishBusy(true);
      setPublishError(null);
      try {
        await stopPublish();
      } finally {
        setPublishBusy(false);
      }
      return;
    }

    if (!session?.idToken) {
      requireAuth("Log in to go LIVE from BlypStudio");
      setPublishError("Log in required to publish to IVS.");
      return;
    }

    setPublishBusy(true);
    setPublishError(null);
    try {
      const tabAudioOk = await armSpotifyTabAudioForLive();
      if (isStudioSpotifyLinked() && !tabAudioOk) {
        setPublishError(TAB_AUDIO_REQUIRED);
        return;
      }
      await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });

      const preview = previewStreamRef.current;
      if (!preview) {
        throw new Error(
          "No camera or screen stream ready. Allow camera on localhost/HTTPS.",
        );
      }
      studioAudio.attachMic(preview);
      const wantMix = studioAudio.shouldPublishMix();
      const publishStream =
        (wantMix
          ? studioAudio.buildPublishStream(preview, preview)
          : studioAudio.buildNativePublishStream(preview, preview)) || preview;
      const liveVideo = nativePublishVideoTrack(publishStream);
      if (!liveVideo) {
        throw new Error(
          "Stage video must be the camera or screen — not a canvas",
        );
      }
      if (deskScene === "camera") {
        const settings = liveVideo.getSettings?.() ?? {};
        if (!settings.deviceId) {
          throw new Error(
            "Camera publish requires a getUserMedia video track",
          );
        }
      }
      if (!publishStream.getAudioTracks().length) {
        throw new Error("Microphone track missing — check browser permissions.");
      }

      const host = await startLiveHostSession(
        session.idToken,
        `${session.username || "Host"} LIVE`,
      );
      hostSessionRef.current = host;
      persistActiveHostSession(host);
      setHostSessionId(host.sessionId);

      const handle = await startIvsWebHostPublish({
        participantToken: host.hostToken,
        mediaStream: publishStream,
        retainMediaOnLeave: true,
      });
      publishRef.current = handle;
      setIsLive(true);

      try {
        await heartbeatLiveHostSession(session.idToken, host.sessionId);
      } catch {
        /* first heartbeat best-effort */
      }
    } catch (e) {
      await stopPublish();
      setPublishError(
        e instanceof Error ? e.message : "Failed to publish camera to IVS",
      );
    } finally {
      setPublishBusy(false);
    }
  };

  const onBed = async (id: MusicBedId) => {
    if (activeBed === id && studioAudio.isMusicPlaying()) {
      studioAudio.stopMusic();
      setActiveBed(null);
      return;
    }
    const ok = await studioAudio.playBed(id);
    setActiveBed(ok ? id : null);
  };

  return (
    <footer className="blyp-studio-region blyp-studio-bottom">
      <div className="blyp-studio-mixer">
        <p className="blyp-studio-label" style={{ margin: 0 }}>
          Console
        </p>
        <label className="blyp-studio-slider-row">
          <span>Host Mic</span>
          <input
            type="range"
            min={0}
            max={100}
            value={micVol}
            onChange={(e) => setMicVol(Number(e.target.value))}
          />
        </label>
        <label className="blyp-studio-slider-row">
          <span>Music</span>
          <input
            type="range"
            min={0}
            max={100}
            value={musicVol}
            onChange={(e) => setMusicVol(Number(e.target.value))}
          />
        </label>
        <div className="blyp-studio-chip-row">
          {MUSIC_BEDS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`blyp-studio-chip ${activeBed === b.id ? "is-on" : ""}`}
              onClick={() => void onBed(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div className="blyp-studio-chip-row">
          {STING_PAD.map((s) => (
            <button
              key={s.id}
              type="button"
              className="blyp-studio-chip"
              title={`Sting ${s.hint}`}
              onClick={() => studioAudio.playSting(s.id as StingId)}
            >
              {s.name}
            </button>
          ))}
        </div>
        {publishError && (
          <span className="blyp-studio-publish-error" role="alert">
            {publishError}
          </span>
        )}
      </div>
      <button
        type="button"
        className={`blyp-studio-go ${isLive ? "is-live" : ""}`}
        onClick={() => void onToggle()}
        disabled={publishBusy}
      >
        {publishBusy ? "…" : isLive ? "END STREAM" : "GO LIVE"}
      </button>
    </footer>
  );
}
