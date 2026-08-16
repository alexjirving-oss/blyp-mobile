"use client";

import { useCallback, useEffect, useRef } from "react";
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
import { useStudioState } from "../store/StudioStateContext";

/**
 * Master GO LIVE — Phase 4 publishes Clean Feed MediaStream to IVS when possible.
 * Falls back to local preview stream if composite is not ready.
 * END STREAM leaves stage and ends host session (liveHost patterns).
 */
export function BottomConsole() {
  const { session, requireAuth } = useAuth();
  const {
    isLive,
    setIsLive,
    publishError,
    publishBusy,
    setPublishError,
    setPublishBusy,
    cleanFeedStreamRef,
    previewStreamRef,
  } = useStudioState();

  const publishRef = useRef<IvsHostPublishHandle | null>(null);
  const hostSessionRef = useRef<LiveHostSession | null>(null);

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
    if (host && session?.idToken) {
      try {
        await endLiveHostSession(session.idToken, host.sessionId);
      } catch {
        /* soft-fail end */
      }
    }
    setIsLive(false);
  }, [session?.idToken, setIsLive]);

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
      await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });

      const clean = cleanFeedStreamRef.current;
      const preview = previewStreamRef.current;
      const videoSource = clean?.getVideoTracks().length ? clean : preview;
      if (!videoSource?.getVideoTracks().length) {
        throw new Error(
          "No Clean Feed / camera stream ready. Allow camera on localhost/HTTPS.",
        );
      }
      const audioSource =
        clean && clean.getAudioTracks().length > 0 ? clean : preview;
      if (!audioSource?.getAudioTracks().length) {
        throw new Error("Microphone track missing — check browser permissions.");
      }

      // Fresh stream for publish so we never mutate shared Clean Feed tracks.
      const mediaStream = new MediaStream([
        ...videoSource.getVideoTracks(),
        ...audioSource.getAudioTracks().map((t) => t.clone()),
      ]);

      const host = await startLiveHostSession(
        session.idToken,
        `${session.username || "Host"} BlypStudio`,
      );
      hostSessionRef.current = host;
      persistActiveHostSession(host);

      const handle = await startIvsWebHostPublish({
        participantToken: host.hostToken,
        mediaStream,
        retainMediaOnLeave: true,
      });
      publishRef.current = handle;
      // Stop only the audio clones we added for this publish session on leave.
      const audioClones = mediaStream.getAudioTracks();
      const baseLeave = handle.leave;
      publishRef.current = {
        localStream: mediaStream,
        leave: async () => {
          await baseLeave();
          audioClones.forEach((t) => {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          });
        },
      };
      setIsLive(true);

      try {
        await heartbeatLiveHostSession(session.idToken, host.sessionId);
      } catch {
        /* first heartbeat best-effort */
      }
    } catch (e) {
      await stopPublish();
      setPublishError(
        e instanceof Error ? e.message : "Failed to publish Clean Feed to IVS",
      );
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <footer className="blyp-studio-region blyp-studio-bottom">
      <div className="blyp-studio-mixer">
        <p className="blyp-studio-label" style={{ margin: 0 }}>
          Console
        </p>
        <label className="blyp-studio-slider-row">
          <span>Host Mic</span>
          <input type="range" min={0} max={100} defaultValue={80} disabled />
        </label>
        <label className="blyp-studio-slider-row">
          <span>Guest Audio</span>
          <input type="range" min={0} max={100} defaultValue={70} disabled />
        </label>
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
