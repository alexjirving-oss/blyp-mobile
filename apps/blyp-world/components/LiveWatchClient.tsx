"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  requestGuestSlot,
  subscribeLiveChat,
  subscribeLiveStudioMirror,
  type LiveCard,
  type LiveStudioMirror,
} from "@/lib/live";
import { coerceLayout, layoutDef, type StageLayoutId } from "@/lib/studioStageLayouts";
import {
  overlayPositionsForWatchAspect,
  stageFrameClass,
  watchProgramAspectFromViewport,
} from "@/lib/studioDualView";
import type { DeskOrientation } from "@/lib/studioDeskMedia";
import {
  DEFAULT_OVERLAY_FEED,
  fetchOverlayFeedRemote,
  normalizeFeed,
  type OverlayFeedSnapshot,
} from "@/lib/studioOverlayFeed";
import { fetchLiveProgram, fetchWatchToken, type LiveProgram } from "@/lib/liveProgram";
import { startWatchPresence } from "@/lib/watchPresence";
import { useLatencyBuffered } from "@/lib/latencyBuffer";
import { useAuth } from "./AuthProvider";
import { IvsAudiencePlayer } from "./IvsAudiencePlayer";
import { IvsRealtimeAudience } from "./IvsRealtimeAudience";
import { StudioProgramOverlays } from "./StudioProgramOverlays";
import { GiftCinemaLayer } from "./GiftCinemaLayer";
import "./command-center.css";

/**
 * Option 1: viewer chrome from aspect layout fields only.
 * Never inherit host `studioLayout` — that is director-echo and pollutes the
 * inactive aspect when the host is editing the other program.
 */
function resolveWatchFraming(
  feed: OverlayFeedSnapshot,
  aspect: DeskOrientation,
): {
  orientation: DeskOrientation;
  layoutId: StageLayoutId;
} {
  const layoutRaw =
    aspect === "portrait"
      ? feed.layoutPortrait || "host-top-9"
      : feed.layoutLandscape || "solo";
  return {
    orientation: aspect,
    layoutId: coerceLayout(layoutRaw as StageLayoutId, aspect),
  };
}

function preferMutedAutoplay(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|SamsungBrowser|Mobile/i.test(navigator.userAgent || "");
}

function overlayFromMirror(mirror: LiveStudioMirror | null): OverlayFeedSnapshot | null {
  if (!mirror?.studioOverlayFeed) return null;
  return normalizeFeed(mirror.studioOverlayFeed);
}

function overlayFallback(mirror: LiveStudioMirror | null): OverlayFeedSnapshot {
  return {
    ...DEFAULT_OVERLAY_FEED,
    viewers: mirror?.viewerCount ?? 0,
  };
}

export function LiveWatchClient({ live }: { live: LiveCard }) {
  const { session, requireAuth } = useAuth();
  const [viewerMuted, setViewerMuted] = useState(() => preferMutedAutoplay());
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestNote, setGuestNote] = useState<string | null>(null);
  const [chatLines, setChatLines] = useState<{ name: string; text: string }[]>([]);
  const [mirror, setMirror] = useState<LiveStudioMirror | null>(null);
  const [lastGoodProgram, setLastGoodProgram] = useState<LiveProgram | null>(null);
  const [watchToken, setWatchToken] = useState<string | null>(null);
  const [rtFatal, setRtFatal] = useState(false);
  const [rtReady, setRtReady] = useState(false);
  const [playerGen, setPlayerGen] = useState(0);
  const [fatal, setFatal] = useState(false);
  const [liveLatencySec, setLiveLatencySec] = useState(4);
  const [programGoneAt, setProgramGoneAt] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [watchAspect, setWatchAspect] = useState<DeskOrientation>("landscape");
  const [publicOverlayFeed, setPublicOverlayFeed] =
    useState<OverlayFeedSnapshot | null>(null);
  const [mirrorReady, setMirrorReady] = useState(false);
  const prevActive = useRef(false);
  const lastGoodRef = useRef<LiveProgram | null>(null);

  const streamId = live.streamId || live.id;
  lastGoodRef.current = lastGoodProgram;

  useEffect(() => {
    const apply = () => setWatchAspect(watchProgramAspectFromViewport());
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  useEffect(() => {
    if (!streamId) return;
    setMirrorReady(false);
    setPublicOverlayFeed(null);
    return subscribeLiveStudioMirror(streamId, (next) => {
      setMirror(next);
      setMirrorReady(true);
    });
  }, [streamId]);

  useEffect(() => {
    if (!streamId || !mirrorReady) return;
    if (mirror?.studioOverlayFeed) {
      setPublicOverlayFeed(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      const remote = await fetchOverlayFeedRemote(streamId);
      if (alive && remote) setPublicOverlayFeed(remote);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [streamId, mirrorReady, mirror?.studioOverlayFeed]);

  useEffect(() => {
    if (!streamId) return;
    return subscribeLiveChat(streamId, (rows) => {
      setChatLines(
        rows
          .slice()
          .reverse()
          .map((c) => ({
            name: c.displayName || c.username || "viewer",
            text: c.text,
          }))
          .slice(-8),
      );
    });
  }, [streamId]);

  useEffect(() => {
    if (!streamId || ended) return;
    return startWatchPresence(streamId, {
      cognitoIdToken: session?.idToken,
      uid: session?.sub,
    });
  }, [streamId, ended, session?.idToken, session?.sub]);

  useEffect(() => {
    if (!streamId || ended) return;
    let alive = true;
    setWatchToken(null);
    setRtFatal(false);
    setRtReady(false);
    void (async () => {
      const tok = await fetchWatchToken(streamId);
      if (!alive) return;
      if (tok?.token) setWatchToken(tok.token);
    })();
    return () => {
      alive = false;
    };
  }, [streamId, ended, playerGen]);

  useEffect(() => {
    if (!streamId || ended) return;
    let alive = true;
    const poll = async () => {
      const result = await fetchLiveProgram(streamId);
      if (!alive) return;
      if (result.ok) {
        setLastGoodProgram(result.program);
        setProgramGoneAt(null);
        return;
      }
      if (result.reason === "not_live") {
        if (lastGoodRef.current) {
          // Was live: drain HLS then ended. 404/410 after lastGood is gone.
          setProgramGoneAt((prev) => prev ?? Date.now());
        }
        // First 404 / no composition yet: wait like 429/transient — not ended.
      }
      // 429 / network: keep last good program; never mark ended.
    };
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [streamId, ended]);

  useEffect(() => {
    const active = lastGoodProgram?.compositionState === "ACTIVE";
    if (active && !prevActive.current) {
      setFatal(false);
      setPlayerGen((n) => n + 1);
    }
    prevActive.current = !!active;
  }, [lastGoodProgram?.compositionState]);

  useEffect(() => {
    if (!programGoneAt) return;
    const wait = Math.max(0, liveLatencySec * 1000);
    const t = window.setTimeout(() => setEnded(true), wait);
    return () => window.clearTimeout(t);
  }, [programGoneAt, liveLatencySec]);

  const overlayFeed = useMemo(() => {
    const mirrored = overlayFromMirror(mirror);
    if (mirrored) return mirrored;
    if (mirrorReady && publicOverlayFeed) return publicOverlayFeed;
    return overlayFallback(mirror);
  }, [mirror, mirrorReady, publicOverlayFeed]);
  const delayMs = Math.max(0, Math.round(liveLatencySec * 1000));
  const overlays = useLatencyBuffered(overlayFeed.overlays, delayMs);
  const overlayPositions = useLatencyBuffered(
    overlayPositionsForWatchAspect(
      overlayFeed.positions,
      overlayFeed.positionsPortrait,
      overlayFeed.positionsLandscape,
      watchAspect,
    ),
    delayMs,
  );
  const gifters = useLatencyBuffered(overlayFeed.gifters, delayMs);
  const goalPct = useLatencyBuffered(overlayFeed.goalPct, delayMs);
  const goalLabel = useLatencyBuffered(overlayFeed.goalLabel, delayMs);
  const jukeboxNow = useLatencyBuffered(overlayFeed.jukeboxNow, delayMs);
  const jukeboxArt = useLatencyBuffered(overlayFeed.jukeboxArt ?? null, delayMs);
  const jukeboxTitle = useLatencyBuffered(overlayFeed.jukeboxTitle ?? "", delayMs);
  const jukeboxArtist = useLatencyBuffered(overlayFeed.jukeboxArtist ?? "", delayMs);
  const jukeboxNext = useLatencyBuffered(overlayFeed.jukeboxNext ?? "", delayMs);
  const jukeboxPos = useLatencyBuffered(overlayFeed.jukeboxPos ?? 0, delayMs);
  const jukeboxDur = useLatencyBuffered(overlayFeed.jukeboxDur ?? 0, delayMs);
  const jukeboxPaused = useLatencyBuffered(overlayFeed.jukeboxPaused ?? true, delayMs);
  const giftsLabel = useLatencyBuffered(overlayFeed.giftsLabel, delayMs);
  const giftCinema = useLatencyBuffered(overlayFeed.giftCinema ?? null, delayMs);
  const overlayChat = useLatencyBuffered(overlayFeed.chatLines, delayMs);
  const events = useLatencyBuffered(overlayFeed.events, delayMs);
  const timerLabel = useLatencyBuffered(overlayFeed.timerLabel, delayMs);
  const viewers = useLatencyBuffered(mirror?.viewerCount ?? overlayFeed.viewers, delayMs);
  const delayedChat = useLatencyBuffered(chatLines, delayMs);

  const framing = useMemo(
    () => resolveWatchFraming(overlayFeed, watchAspect),
    [overlayFeed, watchAspect],
  );
  const layout = useMemo(() => layoutDef(framing.layoutId), [framing.layoutId]);
  const isPortrait = framing.orientation === "portrait";
  const watchUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/live/${encodeURIComponent(live.streamId || live.id)}`
      : overlayFeed.watchUrl;

  const onRequestGuest = useCallback(async () => {
    if (!session?.idToken) {
      requireAuth("Log in to request a guest slot");
      return;
    }
    if (!streamId) {
      setGuestNote("Missing session id");
      return;
    }
    setGuestBusy(true);
    setGuestNote(null);
    try {
      await requestGuestSlot(session.idToken, streamId);
      setGuestNote("Request sent — wait for the host to accept");
    } catch (e) {
      setGuestNote(e instanceof Error ? e.message : "Could not send guest request");
    } finally {
      setGuestBusy(false);
    }
  }, [requireAuth, session?.idToken, streamId]);

  const playerSrc = lastGoodProgram?.playbackUrl;
  const compositionState = lastGoodProgram?.compositionState || "";
  const playerActive = compositionState === "ACTIVE" && !!playerSrc;
  const useRealtime = !!watchToken && !rtFatal && !ended;
  const drainAfterEnd = programGoneAt != null && playerActive && !ended && !useRealtime;
  const playableLive = !ended && (rtReady || playerActive);
  const badgeLabel = ended
    ? "ENDED"
    : playableLive
      ? "LIVE"
      : useRealtime
        ? "LIVE"
        : compositionState || "CONNECTING";

  const renderHostProgram = () => {
    if (ended) {
      return (
        <div className="tls-preview-empty">
          <p className="relative font-display text-xl font-bold">
            This session may have ended
          </p>
        </div>
      );
    }
    if (useRealtime && watchToken) {
      return (
        <IvsRealtimeAudience
          key={`rt-${playerGen}`}
          token={watchToken}
          muted={viewerMuted}
          objectFit="cover"
          onFirstFrame={() => setRtReady(true)}
          onFatal={() => setRtFatal(true)}
          onLatency={setLiveLatencySec}
        />
      );
    }
    if (drainAfterEnd && playerSrc) {
      return (
        <IvsAudiencePlayer
          key={playerGen}
          src={playerSrc}
          muted={viewerMuted}
          objectFit="cover"
          onFirstFrame={() => undefined}
          onFatal={() => undefined}
          onLatency={setLiveLatencySec}
        />
      );
    }
    if (fatal) {
      return (
        <div className="tls-preview-empty">
          <p className="relative font-display text-xl font-bold">Playback failed — retry</p>
          <button
            type="button"
            className="relative mt-3 rounded-full bg-[var(--blyp-teal)] px-5 py-2 text-sm font-semibold text-[var(--blyp-ink)]"
            onClick={() => {
              setFatal(false);
              setRtFatal(false);
              setPlayerGen((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    if (!playerSrc) {
      return (
        <div className="tls-preview-empty">
          <p className="relative font-display text-xl font-bold">Host connecting…</p>
        </div>
      );
    }
    if (lastGoodProgram?.compositionState !== "ACTIVE") {
      return (
        <div className="tls-preview-empty">
          <p className="relative font-display text-xl font-bold">Host connecting…</p>
        </div>
      );
    }
    return (
      <IvsAudiencePlayer
        key={playerGen}
        src={playerSrc}
        muted={viewerMuted}
        objectFit="cover"
        onFirstFrame={() => undefined}
        onFatal={() => {
          if (programGoneAt != null) return;
          setFatal(true);
        }}
        onLatency={setLiveLatencySec}
      />
    );
  };

  return (
    <div className="tls-watch-shell mx-auto max-w-[1100px] px-5 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className={
              playableLive
                ? "text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-rose)]"
                : "text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-muted)]"
            }
          >
            {badgeLabel}
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold">{live.title}</h1>
          <Link
            href={`/u/${encodeURIComponent(live.hostUsername)}`}
            className="mt-1 inline-block text-sm text-[var(--blyp-muted)] hover:text-[var(--blyp-teal)]"
          >
            @{live.hostUsername}
          </Link>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--blyp-teal)]">
            Host program · {isPortrait ? "9:16" : "16:9"} · {layout.label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewerMuted((m) => !m)}
            className="rounded-full border border-[var(--blyp-line)] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-[var(--blyp-fog)]"
          >
            {viewerMuted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            disabled={guestBusy}
            onClick={() => void onRequestGuest()}
            className="rounded-full border border-[var(--blyp-teal)] bg-[rgba(0,210,190,0.12)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-teal)] disabled:opacity-60"
          >
            {guestBusy ? "Requesting…" : "Request to join"}
          </button>
          <button
            type="button"
            onClick={() => requireAuth("Log in to gift on LIVE")}
            className="rounded-full bg-[var(--blyp-gold)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-ink)]"
          >
            Gift
          </button>
        </div>
      </div>
      {guestNote ? (
        <p className="mb-3 text-sm text-[var(--blyp-muted)]">{guestNote}</p>
      ) : null}

      <div
        className={
          isPortrait
            ? "tls-watch-stage tls-watch-stage-portrait tls-watch-stage-immersive"
            : "tls-watch-stage tls-watch-stage-landscape tls-watch-stage-immersive"
        }
      >
        <div className={stageFrameClass(framing.orientation, framing.layoutId)}>
          <div className="tls-program-host">
            {renderHostProgram()}
            {!ended ? (
              <>
                <GiftCinemaLayer cue={giftCinema} />
                <StudioProgramOverlays
                overlayState={overlays}
                overlayPositions={overlayPositions}
                gifters={gifters}
                goalPct={goalPct}
                goalLabel={goalLabel}
                jukeboxNow={jukeboxNow}
                jukeboxArt={jukeboxArt}
                jukeboxTitle={jukeboxTitle}
                jukeboxArtist={jukeboxArtist}
                jukeboxNext={jukeboxNext}
                jukeboxPos={jukeboxPos}
                jukeboxDur={jukeboxDur}
                jukeboxPaused={jukeboxPaused}
                giftsLabel={giftsLabel}
                chatLines={overlayChat.length > 0 ? overlayChat : delayedChat}
                events={events}
                timerLabel={timerLabel}
                viewers={viewers}
                watchUrl={watchUrl}
              />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
