"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  beginSpotifyAuth,
  disconnectSpotify,
  ensureStudioSpotifyPlayer,
  listSpotifyPlaylists,
  loadSpotifyQueue,
  pauseSpotifyPlayback,
  playSpotifyTrack,
  playlistTracks,
  resumeSpotifyPlayback,
  saveSpotifyQueue,
  searchSpotifyTracks,
  setSpotifyVolume,
  skipSpotifyNext,
  spotifySetupHint,
  subscribeStudioSpotifyPlayback,
  type SpotifyLinkStatus,
  type SpotifyTrack,
  type StudioSpotifyPlayback,
} from "@/lib/studioSpotify";

import "@/components/jukebox-cabinet.css";

export type JukeboxNowInfo = {
  label: string;
  title?: string;
  artist?: string;
  art?: string | null;
  nextTitle?: string;
  nextArtist?: string;
  position?: number;
  duration?: number;
  paused?: boolean;
};

function TrackRow(props: {
  track: SpotifyTrack;
  actionLabel: string;
  onAction: () => void;
  onPlay?: () => void;
  playing?: boolean;
}) {
  const { track, actionLabel, onAction, onPlay, playing } = props;
  const title = track.name?.trim() || "Track";
  const artist = track.artists?.trim() || "Unknown artist";
  return (
    <li className={playing ? "jbx-strip is-on" : "jbx-strip"}>
      {track.albumArt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="jbx-strip-art" src={track.albumArt} alt="" />
      ) : (
        <i className="jbx-strip-art is-empty" aria-hidden />
      )}
      <button type="button" className="jbx-strip-body" onClick={onPlay || onAction}>
        <b className="jbx-strip-title">{title}</b>
        <em className="jbx-strip-artist">{artist}</em>
      </button>
      <button type="button" className="jbx-paddle" onClick={onAction}>
        {actionLabel}
      </button>
    </li>
  );
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function StudioJukeboxPanel(props: {
  status: SpotifyLinkStatus | null;
  onStatus: (s: SpotifyLinkStatus) => void;
  onToast: (msg: string) => void;
  onNowPlaying: (info: JukeboxNowInfo) => void;
  onPlayhead?: (position: number, duration: number) => void;
  onFeed: (text: string) => void;
  requireAuth: (reason?: string) => boolean;
}) {
  const { status, onStatus, onToast, onNowPlaying, onPlayhead, onFeed, requireAuth } = props;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpotifyTrack[]>([]);
  const [queue, setQueue] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<
    { id: string; name: string; tracks: number }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [playback, setPlayback] = useState<StudioSpotifyPlayback>(() => ({
    deviceId: null,
    ready: false,
    paused: true,
    position: 0,
    duration: 0,
    volume: 0.7,
    track: null,
    error: null,
  }));
  const [pos, setPos] = useState(0);
  const persistTimer = useRef<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);

  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem("blyp.liveStudio.jukeboxCompact.v1") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCompact = () => {
    setCompact((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(
          "blyp.liveStudio.jukeboxCompact.v1",
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const persistQueue = useCallback((next: SpotifyTrack[]) => {
    setQueue(next);
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void saveSpotifyQueue(next);
    }, 250);
  }, []);

  useEffect(() => {
    return subscribeStudioSpotifyPlayback((s) => {
      setPlayback(s);
      setPos(s.position);
      if (s.error) onToast(s.error);
    });
  }, [onToast]);

  useEffect(() => {
    if (playback.paused) return;
    const id = window.setInterval(() => {
      setPos((p) => {
        const cap = playback.duration || p + 500;
        return Math.min(cap, p + 500);
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [playback.paused, playback.duration, playback.track?.id]);

  useEffect(() => {
    onPlayhead?.(pos, playback.duration);
  }, [pos, playback.duration, onPlayhead]);

  useEffect(() => {
    if (!status?.linked) return;
    let cancelled = false;
    void loadSpotifyQueue().then((rows) => {
      if (cancelled) return;
      setQueue(rows);
    });
    void listSpotifyPlaylists()
      .then((rows) => {
        if (!cancelled) setPlaylists(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status?.linked]);

  const bootPlayer = useCallback(async () => {
    await ensureStudioSpotifyPlayer();
  }, []);

  const playTrack = useCallback(
    async (track: SpotifyTrack, rest: SpotifyTrack[] = []) => {
      setBusy(true);
      try {
        await bootPlayer();
        const r = await playSpotifyTrack(track, rest);
        onNowPlaying({
          label: `${track.name} \u2014 ${track.artists}`,
          title: track.name,
          artist: track.artists,
          art: track.albumArt,
          paused: false,
        });
        onFeed(`Jukebox \u00B7 ${track.name}`);
        onToast(r.message);
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Could not play in Studio");
      } finally {
        setBusy(false);
      }
    },
    [bootPlayer, onFeed, onNowPlaying, onToast],
  );

  const addToQueue = useCallback(
    (track: SpotifyTrack, playIfIdle: boolean) => {
      const exists = queue.some((t) => t.id === track.id);
      const next = exists ? queue : [...queue, track].slice(0, 40);
      persistQueue(next);
      if (playIfIdle && (!playback.track || playback.paused)) {
        const rest = next.filter((t) => t.id !== track.id);
        void playTrack(track, rest);
      } else {
        onToast(`Queued \u00B7 ${track.name}`);
      }
    },
    [onToast, persistQueue, playTrack, playback.paused, playback.track, queue],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      persistQueue(queue.filter((t) => t.id !== id));
    },
    [persistQueue, queue],
  );

  const onSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    void searchSpotifyTracks(q)
      .then(setHits)
      .catch((e) => onToast(e instanceof Error ? e.message : "Search failed"))
      .finally(() => setBusy(false));
  }, [onToast, query]);

  const onPlayPause = useCallback(() => {
    void (async () => {
      try {
        await bootPlayer();
        if (playback.paused) {
          if (playback.track) await resumeSpotifyPlayback();
          else if (queue[0]) await playTrack(queue[0], queue.slice(1));
          else onToast("Add a track to the queue first");
        } else {
          await pauseSpotifyPlayback();
        }
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Playback failed");
      }
    })();
  }, [bootPlayer, onToast, playTrack, playback.paused, playback.track, queue]);

  const onSkip = useCallback(() => {
    void (async () => {
      const currentId = playback.track?.id;
      const next = currentId
        ? queue.filter((t) => t.id !== currentId)
        : queue;
      const head = next[0];
      if (head) {
        persistQueue(next.slice(1));
        await playTrack(head, next.slice(1));
        return;
      }
      try {
        await skipSpotifyNext();
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Nothing to skip");
      }
    })();
  }, [onToast, persistQueue, playTrack, playback.track?.id, queue]);

  const now = playback.track;
  const pct =
    playback.duration > 0 ? Math.min(100, (pos / playback.duration) * 100) : 0;
  const spinning = Boolean(now) && !playback.paused;
  const arm = `${-22 + pct * 0.48}deg`;
  const upNext = now
    ? queue.find((t) => t.id !== now.id)
    : queue[0];

  useEffect(() => {
    const nxt = now
      ? queue.find((t) => t.id !== now.id)
      : queue[0];
    onNowPlaying({
      label: now
        ? `${now.name} \u2014 ${now.artists}`
        : nxt
          ? `Up next \u00B7 ${nxt.name} \u2014 ${nxt.artists}`
          : "Queue empty",
      title: now?.name || "",
      artist: now?.artists || "",
      art: now?.albumArt ?? null,
      nextTitle: nxt && nxt.id !== now?.id ? nxt.name : "",
      nextArtist: nxt && nxt.id !== now?.id ? nxt.artists : "",
      duration: playback.duration,
      paused: playback.paused,
    });
  }, [
    now,
    now?.id,
    now?.name,
    now?.artists,
    now?.albumArt,
    playback.duration,
    playback.paused,
    queue,
    onNowPlaying,
  ]);

  return (
    <div className={compact ? "jbx is-compact" : "jbx"}>
      <div className="jbx-head">
        <h3 className="jbx-marquee">Jukebox</h3>
        <div className="jbx-head-actions">
          {status?.linked ? (
            <button
              type="button"
              className={compact ? "jbx-compact is-on" : "jbx-compact"}
              onClick={toggleCompact}
            >
              {compact ? "Expand" : "Compact"}
            </button>
          ) : null}
          <div className="jbx-gear">
            <button
              type="button"
              className="jbx-gear-btn"
              aria-label="Jukebox settings"
              aria-expanded={gearOpen}
              onClick={() => setGearOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.14.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.41 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.14-.53 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
                />
              </svg>
            </button>
            {gearOpen ? (
              <div className="jbx-gear-menu">
                <p>Overlay size: Scenes → Overlays (S/M/L)</p>
                {status?.linked ? (
                  <button
                    type="button"
                    className="jbx-key"
                    onClick={() => {
                      void disconnectSpotify().then(() => {
                        onStatus({
                          configured: !!status.configured,
                          linked: false,
                          displayName: null,
                          product: null,
                        });
                        setHits([]);
                        setPlaylists([]);
                        persistQueue([]);
                        setGearOpen(false);
                        onToast("Spotify disconnected");
                      });
                    }}
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {status && !status.configured ? (
        <p className="jbx-empty">{spotifySetupHint()}</p>
      ) : null}
      {status?.linked ? (
        <p className="jbx-plaque">
          {status.displayName}
          {status.product ? ` \u00B7 ${status.product}` : ""}
        </p>
      ) : null}
      {playback.error ? (
        <div className="jbx-fail" role="alert">
          <p>{playback.error}</p>
        </div>
      ) : null}

      <div className="jbx-player">
        <div className="jbx-vinyl-wrap">
          <div className={spinning ? "jbx-disc is-spinning" : "jbx-disc"}>
            {now?.albumArt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="jbx-label" src={now.albumArt} alt="" />
            ) : (
              <div className="jbx-label-empty" />
            )}
          </div>
          <i className="jbx-spindle" aria-hidden />
          <i className="jbx-arm" style={{ ["--arm"]: arm } as CSSProperties} aria-hidden />
          <i className="jbx-shine" aria-hidden />
        </div>
        <div className="jbx-meta">
          <p className="jbx-title">{now?.name || "Nothing playing"}</p>
          <p className="jbx-artist">
            {now?.artists
              ? now.artists
              : upNext
                ? `Up next \u00B7 ${upNext.name}`
                : "Search to add a track"}
          </p>
          {now && upNext && upNext.id !== now.id ? (
            <p className="jbx-next">Up next {"\u00B7"} {upNext.name}</p>
          ) : null}
          <span className="jbx-time">
            {now ? `${fmtMs(pos)} / ${fmtMs(playback.duration)}` : "0:00 / 0:00"}
          </span>
          <div className="jbx-tube" aria-hidden>
            <i style={{ width: `${pct}%` }} />
            <b className="jbx-bead" style={{ left: `${pct}%` }} />
          </div>
          {status?.linked ? (
            <div className="jbx-transport">
              <button
                type="button"
                className="jbx-arcade"
                disabled={busy}
                onClick={onPlayPause}
                aria-label={playback.paused ? "Play" : "Pause"}
              >
                {playback.paused ? (
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <polygon points="8,5 19,12 8,19" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor" />
                    <rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="jbx-arcade"
                disabled={busy}
                onClick={onSkip}
                aria-label="Skip"
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <polygon points="5,5 15,12 5,19" fill="currentColor" />
                  <rect x="16.5" y="5" width="2.5" height="14" rx="0.6" fill="currentColor" />
                </svg>
              </button>
              <label className="jbx-vol">
                Vol
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(playback.volume * 100)}
                  onChange={(e) => {
                    void setSpotifyVolume(Number(e.target.value) / 100);
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="jbx-expand">
      {status?.linked ? (
        <label className="jbx-slot">
          <div className="jbx-slot-row">
            <input
              type="search"
              name="spotify-track-search"
              autoComplete="off"
              placeholder="Search songs or artists"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch();
              }}
            />
            <button type="button" className="jbx-slot-go" onClick={onSearch} disabled={busy}>
              Search
            </button>
          </div>
        </label>
      ) : null}

      {status?.linked && hits.length > 0 ? (
        <ul className="jbx-strips">
          {hits.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              actionLabel="Add"
              onAction={() => addToQueue(t, !now)}
            />
          ))}
        </ul>
      ) : null}
      </div>

      <div className="jbx-keys">
        {status?.linked ? (
          <button
            type="button"
            className="jbx-key"
            onClick={() => {
              setCompact(false);
              void listSpotifyPlaylists()
                .then(setPlaylists)
                .catch((e) =>
                  onToast(e instanceof Error ? e.message : "Playlist load failed"),
                );
            }}
          >
            Playlists
          </button>
        ) : null}
        {status?.linked ? (
          <button
            type="button"
            className="jbx-key"
            onClick={() => {
              void disconnectSpotify().then(() => {
                onStatus({
                  configured: !!status.configured,
                  linked: false,
                  displayName: null,
                  product: null,
                });
                setHits([]);
                setPlaylists([]);
                persistQueue([]);
                onToast("Spotify disconnected");
              });
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="jbx-key"
            disabled={busy}
            onClick={() => {
              if (status && !status.configured) {
                onToast(spotifySetupHint());
                return;
              }
              if (requireAuth("Log in to Connect Spotify")) return;
              setBusy(true);
              void beginSpotifyAuth()
                .then((r) => {
                  if (r.error) onToast(r.error);
                })
                .finally(() => setBusy(false));
            }}
          >
            Connect Spotify
          </button>
        )}
      </div>

      <div className="jbx-expand">
      {status?.linked ? (
        <>
          {playlists.length > 0 ? (
            <div className="jbx-keys">
              {playlists.slice(0, 6).map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  className="jbx-key"
                  onClick={() => {
                    void playlistTracks(pl.id).then((tracks) => {
                      if (!tracks.length) {
                        onToast("Playlist is empty");
                        return;
                      }
                      const next = [...queue, ...tracks]
                        .filter(
                          (t, i, all) => all.findIndex((x) => x.id === t.id) === i,
                        )
                        .slice(0, 40);
                      persistQueue(next);
                      const start = tracks[0];
                      void playTrack(start, next.filter((t) => t.id !== start.id));
                      onToast(`Playing \u00B7 ${pl.name}`);
                    });
                  }}
                >
                  {pl.name}
                </button>
              ))}
            </div>
          ) : null}

          <p className="jbx-queue-label">
            Queue {queue.length ? `\u00B7 ${queue.length}` : ""}
          </p>
          {queue.length === 0 ? (
            <p className="jbx-empty">Search and Add a track</p>
          ) : (
            <ul className="jbx-strips">
              {queue.map((t) => (
                <TrackRow
                  key={`q-${t.id}`}
                  track={t}
                  actionLabel="Out"
                  playing={now?.id === t.id}
                  onPlay={() => void playTrack(t, queue.filter((x) => x.id !== t.id))}
                  onAction={() => removeFromQueue(t.id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
      </div>
    </div>
  );
}
