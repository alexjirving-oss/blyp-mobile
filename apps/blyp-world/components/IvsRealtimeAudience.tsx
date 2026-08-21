"use client";

import { useEffect, useRef } from "react";
import {
  startIvsWebViewerSubscribe,
  type IvsWebViewerHandle,
} from "@/lib/ivsWebViewer";

type Props = {
  token: string;
  muted: boolean;
  onFirstFrame: () => void;
  onFatal: () => void;
  onLatency: (seconds: number) => void;
  objectFit?: "cover" | "contain";
};

export function IvsRealtimeAudience({
  token,
  muted,
  onFirstFrame,
  onFatal,
  onLatency,
  objectFit = "cover",
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<IvsWebViewerHandle | null>(null);
  const onFirstFrameRef = useRef(onFirstFrame);
  const onFatalRef = useRef(onFatal);
  const onLatencyRef = useRef(onLatency);
  onFirstFrameRef.current = onFirstFrame;
  onFatalRef.current = onFatal;
  onLatencyRef.current = onLatency;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !token) return;
    let cancelled = false;
    const fatalTimer = window.setTimeout(() => {
      if (!cancelled) onFatalRef.current();
    }, 20_000);

    void (async () => {
      try {
        const handle = await startIvsWebViewerSubscribe({
          participantToken: token,
          videoEl: video,
          muted: video.muted,
          onFirstFrame: () => {
            window.clearTimeout(fatalTimer);
            onLatencyRef.current(0);
            onFirstFrameRef.current();
          },
        });
        if (cancelled) {
          await handle.leave();
          return;
        }
        handleRef.current = handle;
        onLatencyRef.current(0);
      } catch {
        window.clearTimeout(fatalTimer);
        if (!cancelled) onFatalRef.current();
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(fatalTimer);
      const handle = handleRef.current;
      handleRef.current = null;
      void handle?.leave();
    };
  }, [token]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted={muted}
      className={
        objectFit === "contain"
          ? "tls-program h-full w-full"
          : "tls-program tls-program-cover h-full w-full"
      }
    />
  );
}
