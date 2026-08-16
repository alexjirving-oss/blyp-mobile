"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";

type Props = {
  src: string;
  poster?: string | null;
  active?: boolean;
  muted?: boolean;
  className?: string;
  onEnded?: () => void;
};

export function VideoPlayer({
  src,
  poster,
  active = true,
  muted = false,
  className,
  onEnded,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isHls = /\.m3u8(\?|$)/i.test(src);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
      }
    } else {
      video.src = src;
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (active) {
      const play = video.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } else {
      video.pause();
    }
  }, [active, muted, src]);

  return (
    <video
      ref={videoRef}
      className={className}
      poster={poster || undefined}
      playsInline
      loop={!onEnded}
      controls={false}
      muted={muted}
      preload={active ? "auto" : "metadata"}
      onEnded={onEnded}
    />
  );
}
