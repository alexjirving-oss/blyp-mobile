"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveDirectoryClient } from "./LiveDirectoryClient";
import { fetchLiveDirectory, type LiveCard } from "@/lib/live";
import { useAuth } from "./AuthProvider";

export function LiveDirectoryLoader() {
  const { session, loading, firebaseReady } = useAuth();
  const [lives, setLives] = useState<LiveCard[] | null>(null);
  const canList = !!session && firebaseReady;

  useEffect(() => {
    if (loading) return;

    if (!canList) {
      setLives([]);
      return;
    }

    setLives(null);
    let alive = true;
    fetchLiveDirectory()
      .then((rows) => {
        if (alive) setLives(rows);
      })
      .catch(() => {
        if (alive) setLives([]);
      });
    return () => {
      alive = false;
    };
  }, [loading, canList]);

  const pending = loading || lives == null;

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-10 md:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--blyp-teal)]">
            LIVE
          </p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            On air
          </h1>
        </div>
        {loading ? null : canList ? (
          <Link
            href="/live/studio"
            className="rounded-full bg-[var(--blyp-rose)] px-5 py-2.5 text-sm font-bold text-white"
          >
            Go LIVE
          </Link>
        ) : (
          <Link
            href="/login?next=/live"
            className="rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          >
            Sign in
          </Link>
        )}
      </div>
      {pending ? (
        <p className="text-sm text-[var(--blyp-muted)]">Loading directory…</p>
      ) : !canList ? (
        <div className="max-w-xl space-y-4">
          <p className="text-[var(--blyp-muted)]">
            Sign in to see who is actually live. The directory stays empty until
            then — we do not show sample streams.
          </p>
          <Link
            href="/login?next=/live"
            className="inline-flex rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <LiveDirectoryClient initial={lives} />
      )}
    </div>
  );
}
