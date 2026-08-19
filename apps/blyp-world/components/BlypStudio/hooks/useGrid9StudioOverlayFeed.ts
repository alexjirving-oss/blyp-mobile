"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchStreamGiftSummary,
  rankTopGifters,
  subscribeLiveChat,
  subscribeLiveGiftEvents,
  updateLiveSessionMeta,
  type StreamGiftSummary,
  type TopGifterRow,
} from "@/lib/live";
import { watchUrlForSession } from "@/lib/liveHost";
import {
  DEFAULT_OVERLAY_POSITIONS,
  DEFAULT_OVERLAYS,
  type OverlayPositions,
  type OverlayState,
  type StudioOverlayId,
} from "@/lib/studioDualView";
import {
  formatSessionTimer,
  type OverlayFeedSnapshot,
} from "@/lib/studioOverlayFeed";
import {
  loadSpotifyQueue,
  subscribeStudioSpotifyPlayback,
  type SpotifyTrack,
  type StudioSpotifyPlayback,
} from "@/lib/studioSpotify";
import { MUSIC_BEDS, studioAudio } from "../audio/StudioAudioEngine";
import {
  overlayPosition,
  type OverlayInstance,
  type OverlayKind,
} from "../overlays/catalog";
import { useStudioState } from "../store/StudioStateContext";

/** Same cadence as LiveStudioClient overlay remote flush. */
const OVERLAY_REMOTE_DEBOUNCE_MS = 800;
const OVERLAY_REMOTE_MAX_WAIT_MS = 2500;
const GOAL_TARGET = 10_000;

function overlayOn(overlays: OverlayInstance[], kind: OverlayKind): boolean {
  return overlays.some((o) => o.kind === kind && o.enabled);
}

function mapGrid9OverlayState(
  overlays: OverlayInstance[],
  jukeboxOn: boolean,
): OverlayState {
  return {
    ...DEFAULT_OVERLAYS,
    gifters: overlayOn(overlays, "top-gifters"),
    goal: overlayOn(overlays, "goal"),
    chat: overlayOn(overlays, "chat-dock") || overlayOn(overlays, "chat-ticker"),
    gifts: overlayOn(overlays, "gift-alerts"),
    jukebox: jukeboxOn,
    events: true,
    timer: overlayOn(overlays, "live-badge"),
    viewers: overlayOn(overlays, "coin-counter"),
    qr: false,
  };
}

function posFromKind(
  overlays: OverlayInstance[],
  kind: OverlayKind,
  id: StudioOverlayId,
): OverlayPositions[StudioOverlayId] {
  const o = overlays.find((x) => x.kind === kind);
  if (!o) return DEFAULT_OVERLAY_POSITIONS[id];
  const p = overlayPosition(o);
  return { x: p.x, y: p.y, scale: DEFAULT_OVERLAY_POSITIONS[id].scale };
}

function mapGrid9OverlayPositions(overlays: OverlayInstance[]): OverlayPositions {
  const chatKind: OverlayKind = overlays.some((o) => o.kind === "chat-dock")
    ? "chat-dock"
    : "chat-ticker";
  return {
    ...DEFAULT_OVERLAY_POSITIONS,
    gifters: posFromKind(overlays, "top-gifters", "gifters"),
    goal: posFromKind(overlays, "goal", "goal"),
    chat: posFromKind(overlays, chatKind, "chat"),
    gifts: posFromKind(overlays, "gift-alerts", "gifts"),
    timer: posFromKind(overlays, "live-badge", "timer"),
    viewers: posFromKind(overlays, "coin-counter", "viewers"),
  };
}

function giftersLines(
  ranked: TopGifterRow[],
  topSupporters: string[],
  gifts: StreamGiftSummary | null,
): string[] {
  if (ranked.length > 0) {
    return ranked.map(
      (g, i) => `${i + 1}. ${g.name} · ${g.coins.toLocaleString()}`,
    );
  }
  if (topSupporters.length > 0) {
    return topSupporters.slice(0, 5);
  }
  if (!gifts || gifts.viewerGiftCount <= 0) {
    return ["Waiting…", "—", "—"];
  }
  return [
    `${gifts.viewerGiftCount} gifts (aggregate)`,
    `${gifts.coinsReceived.toLocaleString()} coins`,
    `${gifts.gemsEarned.toLocaleString()} gems`,
  ];
}

/**
 * While Grid 9 is LIVE, write `liveStreams/{id}.studioOverlayFeed` with the
 * same OverlayFeedSnapshot contract as LiveStudioClient (phone child snapshot).
 * Playhead is kept off the debounce key so title/art/gifters still flush.
 */
export function useGrid9StudioOverlayFeed(): void {
  const { session } = useAuth();
  const {
    isLive,
    hostSessionId,
    overlays,
    socialFeed,
    topSupporters,
    layoutOrientation,
    layoutPreset,
  } = useStudioState();

  const [spotify, setSpotify] = useState<StudioSpotifyPlayback | null>(null);
  const [spotifyQueue, setSpotifyQueue] = useState<SpotifyTrack[]>([]);
  const [bedNow, setBedNow] = useState({ playing: false, name: "" });
  const [jukeboxPos, setJukeboxPos] = useState(0);
  const [jukeboxDur, setJukeboxDur] = useState(0);
  const [gifts, setGifts] = useState<StreamGiftSummary | null>(null);
  const [rankedGifters, setRankedGifters] = useState<TopGifterRow[]>([]);
  const [chatLines, setChatLines] = useState<
    { name: string; text: string }[]
  >([]);
  const [timerLabel, setTimerLabel] = useState("00:00:00");
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);

  const overlayFeedSnapRef = useRef<OverlayFeedSnapshot | null>(null);
  const overlayRemoteDebounceRef = useRef<number | null>(null);
  const overlayRemoteMaxWaitRef = useRef<number | null>(null);
  const overlayRemoteSessionRef = useRef<string | null>(null);
  const topGiftersRef = useRef<Record<string, { coins: number; name: string }>>(
    {},
  );

  useEffect(() => {
    if (isLive && hostSessionId) {
      setLiveStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setLiveStartedAt(null);
    setTimerLabel("00:00:00");
  }, [isLive, hostSessionId]);

  useEffect(() => {
    if (liveStartedAt == null) return;
    const tick = () => {
      setTimerLabel(formatSessionTimer(Date.now() - liveStartedAt));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [liveStartedAt]);

  useEffect(() => {
    if (!isLive) {
      setSpotify(null);
      return;
    }
    return subscribeStudioSpotifyPlayback((s) => {
      setSpotify(s);
      setJukeboxPos(s.position);
      setJukeboxDur(s.duration);
    });
  }, [isLive]);

  useEffect(() => {
    if (!isLive || !spotify || spotify.paused) return;
    const cap = spotify.duration || 0;
    const id = window.setInterval(() => {
      setJukeboxPos((p) => (cap > 0 ? Math.min(cap, p + 500) : p + 500));
    }, 500);
    return () => window.clearInterval(id);
  }, [isLive, spotify, spotify?.paused, spotify?.duration, spotify?.track?.id]);

  useEffect(() => {
    if (!isLive) {
      setBedNow({ playing: false, name: "" });
      return;
    }
    const tick = () => {
      const playing = studioAudio.isMusicPlaying();
      const bed = studioAudio.currentBed();
      const name =
        bed && bed !== "file"
          ? MUSIC_BEDS.find((b) => b.id === bed)?.name || bed
          : bed === "file"
            ? "Local audio"
            : "";
      setBedNow((prev) =>
        prev.playing === playing && prev.name === name
          ? prev
          : { playing, name },
      );
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [isLive]);

  useEffect(() => {
    if (!isLive) {
      setSpotifyQueue([]);
      return;
    }
    let cancelled = false;
    void loadSpotifyQueue().then((rows) => {
      if (!cancelled) setSpotifyQueue(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isLive, spotify?.track?.id]);

  useEffect(() => {
    if (!isLive || !hostSessionId) {
      setChatLines([]);
      return;
    }
    return subscribeLiveChat(hostSessionId, (rows) => {
      setChatLines(
        rows.slice(0, 6).map((c) => ({
          name: c.displayName || c.username || "viewer",
          text: c.text,
        })),
      );
    });
  }, [isLive, hostSessionId]);

  useEffect(() => {
    if (!isLive || !hostSessionId || !session?.idToken) {
      topGiftersRef.current = {};
      setRankedGifters([]);
      setGifts(null);
      return;
    }
    let cancelled = false;
    let unsubGift: (() => void) | null = null;
    const publishBoard = () => {
      if (!cancelled) setRankedGifters(rankTopGifters(topGiftersRef.current, 5));
    };
    const tickSummary = async () => {
      const summary = await fetchStreamGiftSummary(
        session.idToken,
        hostSessionId,
      );
      if (!cancelled) setGifts(summary);
    };
    void tickSummary();
    const poll = window.setInterval(() => void tickSummary(), 8_000);
    void subscribeLiveGiftEvents(
      session.idToken,
      hostSessionId,
      (payload) => {
        const uid = payload.sender?.userId || "";
        const coins = Number(payload.coinSpent) || 0;
        if (!uid || coins <= 0) return;
        const name =
          payload.sender?.handle || uid.slice(0, 10) || "viewer";
        const cur = topGiftersRef.current[uid] || { coins: 0, name };
        topGiftersRef.current[uid] = {
          coins: cur.coins + coins,
          name: name || cur.name,
        };
        publishBoard();
      },
    ).then((unsub) => {
      if (cancelled) unsub();
      else unsubGift = unsub;
    });
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      try {
        unsubGift?.();
      } catch {
        /* ignore */
      }
    };
  }, [isLive, hostSessionId, session?.idToken]);

  const spotifyTrack = spotify?.track ?? null;
  const spotifyPaused = spotify?.paused ?? true;
  const spotifyPlaying = Boolean(spotifyTrack) && !spotifyPaused;
  const trackPlaying = spotifyPlaying || (!spotifyTrack && bedNow.playing);

  const jukeboxTitle = spotifyPlaying
    ? spotifyTrack?.name || ""
    : trackPlaying
      ? bedNow.name
      : "";
  const jukeboxArtist = spotifyPlaying
    ? spotifyTrack?.artists || ""
    : trackPlaying
      ? "Local audio"
      : "";
  const jukeboxArt = spotifyPlaying ? spotifyTrack?.albumArt ?? null : null;
  const jukeboxNext = useMemo(() => {
    if (!spotifyTrack) return spotifyQueue[0]?.name || "";
    return spotifyQueue.find((t) => t.id !== spotifyTrack.id)?.name || "";
  }, [spotifyTrack, spotifyQueue]);
  const jukeboxNow = jukeboxTitle
    ? jukeboxArtist
      ? `${jukeboxTitle} \u2014 ${jukeboxArtist}`
      : jukeboxTitle
    : jukeboxNext
      ? `Up next \u00B7 ${jukeboxNext}`
      : "Queue empty";
  const jukeboxPaused = !trackPlaying;

  const overlayState = useMemo(
    () => mapGrid9OverlayState(overlays, trackPlaying),
    [overlays, trackPlaying],
  );
  const overlayPositions = useMemo(
    () => mapGrid9OverlayPositions(overlays),
    [overlays],
  );

  const goalPct = useMemo(() => {
    const coins = gifts?.coinsReceived ?? 0;
    if (GOAL_TARGET <= 0) return 0;
    return Math.min(100, Math.round((coins / GOAL_TARGET) * 100));
  }, [gifts?.coinsReceived]);
  const giftsLabel = useMemo(() => {
    if (!gifts) return "Gift alerts";
    return `${gifts.viewerGiftCount} gifts · ${gifts.coinsReceived.toLocaleString()} coins`;
  }, [gifts]);
  const goalLabel = `Goal ${goalPct}% · ${GOAL_TARGET.toLocaleString()}`;
  const gifters = useMemo(
    () => giftersLines(rankedGifters, topSupporters, gifts),
    [rankedGifters, topSupporters, gifts],
  );
  const events = useMemo(
    () =>
      socialFeed.slice(0, 12).map((e) => ({
        id: e.id,
        text: e.text,
        at: e.createdAt,
      })),
    [socialFeed],
  );
  const watchUrl = hostSessionId ? watchUrlForSession(hostSessionId) : "";

  const overlayRemoteKey = useMemo(
    () =>
      JSON.stringify({
        overlays: overlayState,
        maps: overlayPositions,
        chat: chatLines,
        giftsLabel,
        goalPct,
        goalTarget: GOAL_TARGET,
        jukeboxNow,
        jukeboxArt,
        jukeboxTitle,
        jukeboxArtist,
        jukeboxNext,
        jukeboxPaused,
        events: events.map((e) => `${e.id}:${e.text}`),
        watchUrl,
        gifters,
        sessionId: hostSessionId || "",
        authed: Boolean(session?.idToken),
      }),
    [
      overlayState,
      overlayPositions,
      chatLines,
      giftsLabel,
      goalPct,
      jukeboxNow,
      jukeboxArt,
      jukeboxTitle,
      jukeboxArtist,
      jukeboxNext,
      jukeboxPaused,
      events,
      watchUrl,
      gifters,
      hostSessionId,
      session?.idToken,
    ],
  );

  const clearOverlayRemoteTimers = useCallback(() => {
    if (overlayRemoteDebounceRef.current != null) {
      window.clearTimeout(overlayRemoteDebounceRef.current);
      overlayRemoteDebounceRef.current = null;
    }
    if (overlayRemoteMaxWaitRef.current != null) {
      window.clearTimeout(overlayRemoteMaxWaitRef.current);
      overlayRemoteMaxWaitRef.current = null;
    }
  }, []);

  const flushOverlayFeedRemote = useCallback(() => {
    clearOverlayRemoteTimers();
    const snap = overlayFeedSnapRef.current;
    const sessionId = overlayRemoteSessionRef.current;
    if (!snap || !sessionId) return;
    const payload: OverlayFeedSnapshot = { ...snap, updatedAt: Date.now() };
    void updateLiveSessionMeta(sessionId, {
      studioOverlayFeed: payload as unknown as Record<string, unknown>,
    }).catch(() => {
      /* next interval retry */
    });
  }, [clearOverlayRemoteTimers]);

  const scheduleOverlayFeedRemote = useCallback(() => {
    if (!overlayRemoteSessionRef.current) return;
    if (overlayRemoteDebounceRef.current != null) {
      window.clearTimeout(overlayRemoteDebounceRef.current);
    }
    overlayRemoteDebounceRef.current = window.setTimeout(() => {
      overlayRemoteDebounceRef.current = null;
      flushOverlayFeedRemote();
    }, OVERLAY_REMOTE_DEBOUNCE_MS);
    if (overlayRemoteMaxWaitRef.current == null) {
      overlayRemoteMaxWaitRef.current = window.setTimeout(() => {
        overlayRemoteMaxWaitRef.current = null;
        flushOverlayFeedRemote();
      }, OVERLAY_REMOTE_MAX_WAIT_MS);
    }
  }, [flushOverlayFeedRemote]);

  useEffect(() => {
    return () => clearOverlayRemoteTimers();
  }, [clearOverlayRemoteTimers]);

  useEffect(() => {
    if (!isLive || !hostSessionId) {
      overlayFeedSnapRef.current = null;
      return;
    }
    const snap: OverlayFeedSnapshot = {
      v: 1,
      overlays: overlayState,
      positions: overlayPositions,
      positionsPortrait: overlayPositions,
      positionsLandscape: overlayPositions,
      layoutPortrait: layoutOrientation === "portrait" ? layoutPreset : undefined,
      layoutLandscape:
        layoutOrientation === "landscape" ? layoutPreset : undefined,
      chatLines,
      giftsLabel,
      goalPct,
      goalLabel,
      jukeboxNow,
      jukeboxArt,
      jukeboxTitle,
      jukeboxArtist,
      jukeboxNext,
      jukeboxPos,
      jukeboxDur,
      jukeboxPaused,
      events,
      timerLabel,
      viewers: 0,
      watchUrl,
      gifters,
      themeCss: "",
      sessionId: hostSessionId,
      updatedAt: Date.now(),
    };
    overlayFeedSnapRef.current = snap;
  }, [
    isLive,
    hostSessionId,
    overlayState,
    overlayPositions,
    layoutOrientation,
    layoutPreset,
    chatLines,
    giftsLabel,
    goalPct,
    goalLabel,
    jukeboxNow,
    jukeboxArt,
    jukeboxTitle,
    jukeboxArtist,
    jukeboxNext,
    jukeboxPos,
    jukeboxDur,
    jukeboxPaused,
    events,
    timerLabel,
    watchUrl,
    gifters,
  ]);

  useEffect(() => {
    overlayRemoteSessionRef.current =
      isLive && hostSessionId ? hostSessionId : null;
    if (!overlayRemoteSessionRef.current) {
      clearOverlayRemoteTimers();
      return undefined;
    }
    scheduleOverlayFeedRemote();
    return undefined;
  }, [
    overlayRemoteKey,
    isLive,
    hostSessionId,
    clearOverlayRemoteTimers,
    scheduleOverlayFeedRemote,
  ]);

  useEffect(() => {
    if (!isLive || !hostSessionId) return undefined;
    overlayRemoteSessionRef.current = hostSessionId;
    const id = window.setInterval(() => {
      flushOverlayFeedRemote();
    }, OVERLAY_REMOTE_MAX_WAIT_MS);
    return () => window.clearInterval(id);
  }, [isLive, hostSessionId, flushOverlayFeedRemote]);
}
