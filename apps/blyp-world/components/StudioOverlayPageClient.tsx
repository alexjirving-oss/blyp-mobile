"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { StudioProgramOverlays } from "@/components/StudioProgramOverlays";
import { getDb } from "@/lib/firebase";
import {
  DEFAULT_OVERLAY_POSITIONS,
  OVERLAY_SCALE_PRESETS,
  type OverlayPositions,
} from "@/lib/studioDualView";
import {
  DEFAULT_OVERLAY_FEED,
  OVERLAY_CHANNEL,
  OVERLAY_FEED_KEY,
  fetchOverlayFeedRemote,
  normalizeFeed,
  readOverlayFeed,
  type OverlayFeedSnapshot,
} from "@/lib/studioOverlayFeed";
import "@/components/command-center.css";
import "@/components/studio-overlay-page.css";

function sessionFromLocation(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URL(window.location.href).searchParams.get("session") || "";
  } catch {
    return "";
  }
}

const OBS_JUKEBOX_SCALE = OVERLAY_SCALE_PRESETS.S;

/** Host widgets keep feed layout; jukebox stays a small lower-third on OBS. */
function obsOverlayPositions(positions: OverlayPositions): OverlayPositions {
  const fallback = DEFAULT_OVERLAY_POSITIONS.jukebox;
  const j = positions.jukebox;
  const scale = Math.min(
    typeof j?.scale === "number" ? j.scale : OBS_JUKEBOX_SCALE,
    OBS_JUKEBOX_SCALE,
  );
  return {
    ...positions,
    jukebox: {
      x: typeof j?.x === "number" ? j.x : fallback.x,
      y: typeof j?.y === "number" ? j.y : fallback.y,
      scale,
    },
  };
}

/**
 * Clean-feed overlays for OBS / TikFinity-style Browser Source.
 * Same-browser: localStorage + BroadcastChannel.
 * Cross-machine: ?session=<liveSessionId> polls Firestore studioOverlayFeed
 * when the booth mirrors while LIVE (host write path).
 */
export function StudioOverlayPageClient() {
  const [feed, setFeed] = useState<OverlayFeedSnapshot>(DEFAULT_OVERLAY_FEED);
  const [mirrorNote, setMirrorNote] = useState("");
  const overlayPositions = useMemo(
    () => obsOverlayPositions(feed.positions),
    [feed.positions],
  );

  useEffect(() => {
    setFeed(readOverlayFeed());

    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERLAY_FEED_KEY && e.newValue) {
        try {
          setFeed(normalizeFeed(JSON.parse(e.newValue)));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);

    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(OVERLAY_CHANNEL);
      ch.onmessage = (ev) => {
        setFeed(normalizeFeed(ev.data as Partial<OverlayFeedSnapshot>));
      };
    } catch {
      ch = null;
    }

    const sessionId = sessionFromLocation();

    const poll = window.setInterval(() => {
      if (sessionId) return;
      setFeed(readOverlayFeed());
    }, 1500);

    let unsubMirror: (() => void) | null = null;
    let remotePoll = 0;
    if (sessionId) {
      setMirrorNote(`Remote session ${sessionId.slice(0, 8)}…`);
      const applyRemote = (next: OverlayFeedSnapshot, note: string) => {
        setFeed(next);
        setMirrorNote(note);
      };
      const pullPublic = () => {
        void fetchOverlayFeedRemote(sessionId).then((remote) => {
          if (remote) applyRemote(remote, "Synced from LIVE overlay feed");
        });
      };
      pullPublic();
      remotePoll = window.setInterval(pullPublic, 2000);
      try {
        const db = getDb();
        unsubMirror = onSnapshot(
          doc(db, "liveStreams", sessionId),
          (snap) => {
            if (!snap.exists()) {
              setMirrorNote("Session not found — start LIVE from Studio first");
              return;
            }
            const data = snap.data() as Record<string, unknown>;
            const remote = data.studioOverlayFeed;
            if (remote && typeof remote === "object") {
              applyRemote(
                normalizeFeed(remote as Partial<OverlayFeedSnapshot>),
                "Synced from LIVE mirror",
              );
            } else {
              setMirrorNote(
                "LIVE but no overlay mirror yet — open Studio on the host PC",
              );
            }
          },
          () => {
            setMirrorNote(
              "Mirror read failed — public overlay feed still works with ?session=",
            );
          },
        );
      } catch {
        setMirrorNote("Using public overlay feed");
      }
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(poll);
      if (remotePoll) window.clearInterval(remotePoll);
      try {
        ch?.close();
      } catch {
        /* ignore */
      }
      try {
        unsubMirror?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <div className="tls-overlay-source">
      <div className="tls-overlay-source-stage">
        <StudioProgramOverlays
          overlayState={feed.overlays}
          overlayPositions={overlayPositions}
          gifters={feed.gifters}
          goalPct={feed.goalPct}
          goalLabel={feed.goalLabel}
          jukeboxNow={feed.jukeboxNow}
          jukeboxArt={feed.jukeboxArt}
          jukeboxTitle={feed.jukeboxTitle}
          jukeboxArtist={feed.jukeboxArtist}
          jukeboxNext={feed.jukeboxNext}
          jukeboxPos={feed.jukeboxPos}
          jukeboxDur={feed.jukeboxDur}
          jukeboxPaused={feed.jukeboxPaused}
          giftsLabel={feed.giftsLabel}
          chatLines={feed.chatLines}
          events={feed.events}
          timerLabel={feed.timerLabel}
          viewers={feed.viewers}
          watchUrl={feed.watchUrl}
        />
      </div>
      <p className="tls-overlay-source-hint">
        OBS Browser Source
        {mirrorNote
          ? ` · ${mirrorNote}`
          : " · same browser as LIVE Studio · transparent stage"}
      </p>
    </div>
  );
}
