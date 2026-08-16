"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedPost } from "@/lib/feed";
import { FALLBACK_GIFTS, sendGift, type GiftItem } from "@/lib/economy";
import { useAuth } from "./AuthProvider";
import { VideoPlayer } from "./VideoPlayer";

type Props = {
  initialPosts: FeedPost[];
  startId?: string;
};

export function ForYouPlayer({ initialPosts, startId }: Props) {
  const { session, requireAuth } = useAuth();
  const startIndex = Math.max(
    0,
    startId ? initialPosts.findIndex((p) => p.id === startId) : 0,
  );
  const [index, setIndex] = useState(startIndex >= 0 ? startIndex : 0);
  const [muted, setMuted] = useState(false);
  const [giftsOpen, setGiftsOpen] = useState(false);
  const [giftBusy, setGiftBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const posts = initialPosts;
  const current = posts[index] || null;

  // Prefetch neighbors by mounting nearby <link rel=preload> for mp4 sources
  useEffect(() => {
    if (typeof document === "undefined") return;
    const neighbors = [posts[index + 1], posts[index + 2], posts[index - 1]].filter(
      Boolean,
    ) as FeedPost[];
    const links: HTMLLinkElement[] = [];
    for (const p of neighbors) {
      if (!p.videoUrl || /\.m3u8/i.test(p.videoUrl)) continue;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "video";
      link.href = p.videoUrl;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      links.forEach((l) => l.remove());
    };
  }, [index, posts]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(posts.length - 1, Math.max(0, i + delta));
        return next;
      });
      setGiftsOpen(false);
    },
    [posts.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") go(1);
      if (e.key === "ArrowUp" || e.key === "k") go(-1);
      if (e.key === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Touch / wheel snap
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY || 0;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const y = e.changedTouches[0]?.clientY || 0;
      const dy = touchY - y;
      if (Math.abs(dy) < 48) return;
      go(dy > 0 ? 1 : -1);
    };
    let wheelLock = 0;
    const onWheel = (e: WheelEvent) => {
      if (Date.now() < wheelLock) return;
      if (Math.abs(e.deltaY) < 24) return;
      wheelLock = Date.now() + 500;
      go(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [go]);

  const giftList: GiftItem[] = useMemo(() => FALLBACK_GIFTS, []);

  const onLike = () => {
    if (requireAuth("Log in to like")) return;
    setToast("Liked — synced when you’re back in the app feed");
    setTimeout(() => setToast(null), 2200);
  };

  const onGift = async (gift: GiftItem) => {
    if (requireAuth("Log in to gift")) return;
    if (!session || !current?.userId) return;
    setGiftBusy(true);
    try {
      await sendGift({
        idToken: session.idToken,
        postOrStreamId: current.id,
        receiverUserId: current.userId,
        giftId: gift.giftId,
      });
      setToast(`Sent ${gift.name}`);
      setGiftsOpen(false);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Gift failed");
    } finally {
      setGiftBusy(false);
      setTimeout(() => setToast(null), 2400);
    }
  };

  if (!posts.length) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="font-display text-2xl font-bold">Feed warming up</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          No playable videos returned yet. Check back in a moment.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="relative mx-auto flex h-[calc(100dvh-4rem)] max-w-[480px] flex-col bg-black"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {posts.map((post, i) => {
          const near = Math.abs(i - index) <= 1;
          if (!near) return null;
          return (
            <div
              key={post.id}
              className={`absolute inset-0 transition-opacity duration-300 ${
                i === index ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {post.videoUrl ? (
                <VideoPlayer
                  src={post.videoUrl}
                  poster={post.posterUrl}
                  active={i === index}
                  muted={muted}
                  className="h-full w-full object-cover"
                  onEnded={() => go(1)}
                />
              ) : null}
            </div>
          );
        })}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-5 pb-8">
          <div className="pointer-events-auto">
            <Link
              href={`/u/${encodeURIComponent(current?.username || "user")}`}
              className="font-display text-lg font-bold text-white"
            >
              @{current?.username}
            </Link>
            {current?.caption ? (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/85">
                {current.caption}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onLike}
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur"
              >
                Like · {current?.likes ?? 0}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (requireAuth("Log in to gift")) return;
                  setGiftsOpen((v) => !v);
                }}
                className="rounded-full bg-[var(--blyp-gold)] px-4 py-2 text-sm font-semibold text-[var(--blyp-ink)]"
              >
                Gift
              </button>
              <Link
                href={`/v/${current?.id}`}
                className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold"
              >
                Share
              </Link>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            </div>
          </div>
        </div>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => go(-1)}
            className="rounded-full bg-white/10 px-3 py-2 text-sm backdrop-blur"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => go(1)}
            className="rounded-full bg-white/10 px-3 py-2 text-sm backdrop-blur"
          >
            ↓
          </button>
        </div>
      </div>

      {giftsOpen ? (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[rgba(7,7,10,0.94)] p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Send a gift</p>
            <button
              type="button"
              className="text-sm text-[var(--blyp-muted)]"
              onClick={() => setGiftsOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {giftList.map((g) => (
              <button
                key={g.giftId}
                type="button"
                disabled={giftBusy}
                onClick={() => onGift(g)}
                className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-2 py-3 text-center transition hover:border-[var(--blyp-teal)] disabled:opacity-50"
              >
                <div className="text-xl">{g.emoji || "✦"}</div>
                <div className="mt-1 text-[11px] font-semibold">{g.name}</div>
                <div className="text-[10px] text-[var(--blyp-gold)]">
                  {g.coinCost}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-[var(--blyp-teal)] px-4 py-2 text-sm font-semibold text-[var(--blyp-ink)]">
          {toast}
        </div>
      ) : null}

      <p className="sr-only">
        Video {index + 1} of {posts.length}
      </p>
    </div>
  );
}
