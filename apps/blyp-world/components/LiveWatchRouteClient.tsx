"use client";

import { useEffect, useState } from "react";
import { LiveWatchClient } from "./LiveWatchClient";
import { fetchLiveById, type LiveCard } from "@/lib/live";

export function LiveWatchRouteClient() {
  const [live, setLive] = useState<LiveCard | null | undefined>(undefined);

  useEffect(() => {
    const seg = window.location.pathname.split("/").filter(Boolean);
    const raw = seg[0] === "live" ? seg[1] : undefined;
    if (!raw || raw === "_" || raw === "studio") {
      setLive(null);
      return;
    }
    const id = decodeURIComponent(raw);
    fetchLiveById(id)
      .then(setLive)
      .catch(() => setLive(null));
  }, []);

  if (live === undefined) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center text-sm text-[var(--blyp-muted)]">
        Opening LIVE…
      </div>
    );
  }
  if (!live) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <p className="font-display text-2xl font-bold">Stream not found</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          This session may have ended or isn’t in the directory.
        </p>
      </div>
    );
  }
  return <LiveWatchClient live={live} />;
}
