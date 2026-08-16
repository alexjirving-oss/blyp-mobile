"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveDirectoryClient } from "./LiveDirectoryClient";
import { fetchLiveDirectory, type LiveCard } from "@/lib/live";

export function LiveDirectoryLoader() {
  const [lives, setLives] = useState<LiveCard[] | null>(null);

  useEffect(() => {
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
  }, []);

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
        <Link
          href="/live/studio"
          className="rounded-full bg-[var(--blyp-rose)] px-5 py-2.5 text-sm font-bold text-white"
        >
          Go LIVE
        </Link>
      </div>
      {lives == null ? (
        <p className="text-sm text-[var(--blyp-muted)]">Loading directory…</p>
      ) : (
        <LiveDirectoryClient initial={lives} />
      )}
    </div>
  );
}
