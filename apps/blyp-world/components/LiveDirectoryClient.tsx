"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchLiveDirectory, type LiveCard } from "@/lib/live";

export function LiveDirectoryClient({
  initial,
}: {
  initial: LiveCard[];
}) {
  const [lives, setLives] = useState(initial);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await fetchLiveDirectory();
        if (alive) setLives(next);
      } catch {
        // keep previous
      }
    };
    const id = window.setInterval(tick, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!lives.length) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-[var(--blyp-muted)]">
          Nobody is on air right now.
        </p>
        <Link
          href="/live/studio"
          className="inline-flex rounded-full border border-[var(--blyp-line)] px-5 py-2.5 text-sm font-semibold"
        >
          Open LIVE Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lives.map((live) => (
        <Link
          key={live.id}
          href={`/live/${encodeURIComponent(live.streamId || live.id)}`}
          className="group overflow-hidden rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] transition hover:border-[var(--blyp-teal)]"
        >
          <div className="relative aspect-[16/10] bg-black/40">
            {live.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={live.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(0,210,190,0.25),transparent_55%)]">
                <span className="font-display text-2xl font-bold">LIVE</span>
              </div>
            )}
            <span className="absolute left-3 top-3 rounded-full bg-[var(--blyp-rose)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--blyp-ink)]">
              Live
            </span>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              {live.viewerCount} watching
            </span>
          </div>
          <div className="p-4">
            <p className="font-display text-lg font-bold leading-tight">
              {live.title}
            </p>
            <p className="mt-1 text-sm text-[var(--blyp-muted)]">
              @{live.hostUsername}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
