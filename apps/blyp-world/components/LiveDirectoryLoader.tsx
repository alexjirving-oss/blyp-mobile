"use client";

import { useEffect, useState } from "react";
import { LiveDirectoryClient } from "./LiveDirectoryClient";
import { fetchLiveDirectory, type LiveCard } from "@/lib/live";
import { SurfaceShell } from "./SurfaceShell";

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
    <SurfaceShell eyebrow="LIVE" title="On air">
      {lives == null ? (
        <p className="text-sm text-[var(--blyp-muted)]">Loading directory…</p>
      ) : (
        <LiveDirectoryClient initial={lives} />
      )}
    </SurfaceShell>
  );
}
