"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { joinLiveMass, type LiveCard } from "@/lib/live";
import { useAuth } from "./AuthProvider";
import { VideoPlayer } from "./VideoPlayer";

export function LiveWatchClient({ live }: { live: LiveCard }) {
  const { session, requireAuth } = useAuth();
  const [playbackUrl, setPlaybackUrl] = useState(live.playbackUrl);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (playbackUrl) return;
      if (!session?.idToken) {
        setStatus("Sign in to request a playback session if HLS isn’t public yet.");
        return;
      }
      setStatus("Requesting playback…");
      const joined = await joinLiveMass(live.streamId || live.id, session.idToken);
      if (!alive) return;
      if (joined?.playbackUrl) {
        setPlaybackUrl(joined.playbackUrl);
        setStatus(null);
      } else {
        setStatus(
          "No HLS playback URL on this session yet (realtime-only stages need the app player).",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [live.id, live.streamId, playbackUrl, session?.idToken]);

  return (
    <div className="mx-auto max-w-[960px] px-5 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-rose)]">
            LIVE
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold">
            {live.title}
          </h1>
          <Link
            href={`/u/${encodeURIComponent(live.hostUsername)}`}
            className="mt-1 inline-block text-sm text-[var(--blyp-muted)] hover:text-[var(--blyp-teal)]"
          >
            @{live.hostUsername}
          </Link>
        </div>
        <button
          type="button"
          onClick={() => requireAuth("Log in to gift on LIVE")}
          className="rounded-full bg-[var(--blyp-gold)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-ink)]"
        >
          Gift
        </button>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black ring-1 ring-[var(--blyp-line)]">
        {playbackUrl ? (
          <VideoPlayer
            src={playbackUrl}
            active
            muted={false}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            {live.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={live.thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-40"
              />
            ) : null}
            <p className="relative font-display text-2xl font-bold">
              Waiting for playback
            </p>
            <p className="relative max-w-md text-sm text-[var(--blyp-muted)]">
              {status ||
                "This live may be IVS Real-Time only. Open the Blyp app for full stage join."}
            </p>
            {!session ? (
              <Link
                href="/login"
                className="relative rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-ink)]"
              >
                Log in for playback token
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
