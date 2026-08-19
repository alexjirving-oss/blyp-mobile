"use client";

import { useEffect, useState } from "react";
import { LiveWatchClient } from "./LiveWatchClient";
import { fetchLiveById, type LiveCard } from "@/lib/live";

function stubCard(id: string): LiveCard {
  return {
    id,
    streamId: id,
    title: "LIVE",
    playbackUrl: null,
    hostUsername: "host",
    hostDisplayName: "Host",
    hostUid: "",
    hostPhotoURL: null,
    thumbnailUrl: null,
    viewerCount: 0,
    status: "live",
    directoryReady: true,
  };
}

function WatchRouteChrome({
  kicker,
  title,
  copy,
}: {
  kicker: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="relative mx-auto max-w-lg overflow-hidden px-5 py-20 text-center">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 80% at 90% 0%, rgba(254,44,85,0.14), transparent 55%), radial-gradient(50% 70% at 0% 100%, rgba(0,210,190,0.12), transparent 50%)",
        }}
      />
      <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-teal)]">
        {kicker}
      </p>
      <h1 className="font-display relative mt-3 text-2xl font-bold text-white">
        {title}
      </h1>
      <p className="relative mt-3 text-sm text-[var(--blyp-muted)]">{copy}</p>
    </div>
  );
}

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
    void (async () => {
      const card = await fetchLiveById(id).catch(() => null);
      // Valid session id → always open LiveWatchClient. Program / 429 / ended
      // stay in that player poll — do not latch "ended" here on 404 or noise.
      setLive(card ?? stubCard(id));
    })();
  }, []);

  if (live === undefined) {
    return (
      <WatchRouteChrome
        kicker="LIVE"
        title="Opening…"
        copy="Connecting to the host program."
      />
    );
  }
  if (!live) {
    return (
      <WatchRouteChrome
        kicker="LIVE"
        title="No session"
        copy="Open a live link to watch. This is not an ended stream."
      />
    );
  }
  return <LiveWatchClient live={live} />;
}
