"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { doc, getDoc } from "firebase/firestore";
import type { FeedPost } from "@/lib/feed";
import { pickPublicHandle } from "@/lib/feed";
import { getDb } from "@/lib/firebase";
import {
  FALLBACK_GIFTS,
  fetchGiftCatalog,
  sendGift,
  type GiftItem,
} from "@/lib/economy";
import {
  isPostBookmarked,
  togglePostBookmark,
} from "@/lib/bookmarks";
import { isPostLikedBy, togglePostLike } from "@/lib/likes";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { useAuth } from "./AuthProvider";
import { CommentsPanel } from "./CommentsPanel";
import { VideoPlayer } from "./VideoPlayer";

type Props = {
  initialPosts: FeedPost[];
  startId?: string;
};

function formatCount(n: number | undefined) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

function IconHeart({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" aria-hidden>
      <path
        fill={filled ? "#fe2c55" : "currentColor"}
        d="M12.1 21.35 10.55 19.9C5.4 15.36 2 12.27 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.77-3.4 6.86-8.55 11.4z"
      />
    </svg>
  );
}

function IconComment() {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="currentColor" aria-hidden>
      <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z" />
    </svg>
  );
}

function IconGift() {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="currentColor" aria-hidden>
      <path d="M20 6h-2.18A3 3 0 0 0 15 2c-1.3 0-2.4.84-2.82 2H12c-.42-1.16-1.52-2-2.82-2a3 3 0 0 0-2.82 4H4c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM9 4c.55 0 1 .45 1 1H8c0-.55.45-1 1-1zm6 0c.55 0 1 .45 1 1h-2c0-.55.45-1 1-1zM4 10V8h6v2H4zm0 2h6v10H6c-1.1 0-2-.9-2-2v-8zm16 8c0 1.1-.9 2-2 2h-4V12h6v8zm0-10h-6V8h6v2z" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="currentColor" aria-hidden>
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.27 3.27 0 0 0 0-1.39l7.02-4.11A2.99 2.99 0 1 0 14 5a3 3 0 0 0 .08.68L7.05 9.8a3 3 0 1 0 0 4.41l7.12 4.16c-.05.21-.08.43-.08.65a3 3 0 1 0 3-3.02z" />
    </svg>
  );
}

function IconBookmark({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" aria-hidden>
      <path
        fill={filled ? "#00d2be" : "currentColor"}
        d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"
      />
    </svg>
  );
}

function IconMute({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M16.5 12A4.5 4.5 0 0 0 14 8.04v2.22l2.45 2.45c.03-.22.05-.44.05-.66zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.04v7.92A4.48 4.48 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function IconChevron({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      {dir === "up" ? (
        <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
      ) : (
        <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
      )}
    </svg>
  );
}

function ActionButton({
  label,
  onClick,
  children,
  accent,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-0.5"
      aria-label={label}
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition group-hover:scale-105 ${
          accent
            ? "bg-[var(--blyp-gold)] text-[var(--blyp-ink)]"
            : "bg-black/40 backdrop-blur-md ring-1 ring-white/15"
        }`}
      >
        {children}
      </span>
      <span className="text-[12px] font-semibold text-white drop-shadow">
        {label}
      </span>
    </button>
  );
}

function CreatorAvatar({
  username,
  photoURL,
}: {
  username: string;
  photoURL?: string | null;
}) {
  return (
    <span className="relative mb-1 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)] shadow-lg">
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoURL} alt="" className="h-full w-full object-cover" />
      ) : (
        (username || "B").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** Narrow clipped peek strip — fills gutter without stealing center stage. */
function PeekStrip({
  post,
  side,
  onJump,
}: {
  post: FeedPost | null;
  side: "left" | "right";
  onJump: () => void;
}) {
  if (!post?.videoUrl) return null;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous video" : "Next video"}
      onClick={onJump}
      className={`absolute top-1/2 z-[1] hidden h-[min(92dvh,920px)] w-[72px] -translate-y-1/2 overflow-hidden rounded-md opacity-[0.38] transition hover:opacity-55 xl:block xl:w-[88px] 2xl:w-[104px] ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      <div
        className={`absolute inset-y-0 aspect-[9/16] h-full ${
          side === "left" ? "right-0" : "left-0"
        }`}
      >
        <VideoPlayer
          src={post.videoUrl}
          poster={post.posterUrl}
          active={false}
          warm
          muted
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
      </div>
    </button>
  );
}

export function ForYouPlayer({ initialPosts, startId }: Props) {
  const { session, requireAuth, firebaseReady } = useAuth();
  const startIndex = Math.max(
    0,
    startId ? initialPosts.findIndex((p) => p.id === startId) : 0,
  );
  const [posts, setPosts] = useState(initialPosts);
  const [index, setIndex] = useState(startIndex >= 0 ? startIndex : 0);
  const [muted, setMuted] = useState(true);
  const [giftsOpen, setGiftsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [giftBusy, setGiftBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [slideDir, setSlideDir] = useState<0 | 1 | -1>(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const unlockedAudio = useRef(false);
  const likeBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const photoCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  const current = posts[index] || null;
  const prevPost = index > 0 ? posts[index - 1] : null;
  const nextPost = index < posts.length - 1 ? posts[index + 1] : null;
  const handle = current?.username || "creator";

  useEffect(() => {
    const uid = session?.sub || null;
    setLiked(isPostLikedBy(current, uid));
    setLikeCount(current?.likes || 0);
    setCommentCount(current?.comments || 0);
    setSaved(false);
    setGiftsOpen(false);
    setCommentsOpen(false);
  }, [index, current, session?.sub]);

  // Hydrate bookmark state from users/{uid}.blyp.bookmarks (same as mobile).
  useEffect(() => {
    const uid = session?.sub;
    const postId = current?.id;
    if (!uid || !postId) {
      setSaved(false);
      return;
    }
    let alive = true;
    void isPostBookmarked(uid, postId).then((v) => {
      if (alive) setSaved(v);
    });
    return () => {
      alive = false;
    };
  }, [current?.id, session?.sub]);

  // Hydrate missing creator photos / cleaner handles for visible slots.
  useEffect(() => {
    const visible = [prevPost, current, nextPost].filter(Boolean) as FeedPost[];
    let alive = true;
    (async () => {
      const db = getDb();
      for (const p of visible) {
        if (!p.userId) continue;
        if (p.photoURL && !/@/.test(p.username)) continue;
        if (photoCache.current.has(p.userId) && p.photoURL) continue;
        try {
          const snap = await getDoc(doc(db, "users", p.userId));
          if (!alive || !snap.exists()) continue;
          const data = snap.data() as Record<string, unknown>;
          const photo =
            (typeof data.photoURL === "string" && data.photoURL) ||
            (typeof data.avatar === "string" && data.avatar) ||
            null;
          const better = pickPublicHandle(
            data.username,
            data.handle,
            data.displayName,
            p.username,
          );
          if (photo) photoCache.current.set(p.userId, photo);
          setPosts((prev) =>
            prev.map((row) =>
              row.id === p.id
                ? {
                    ...row,
                    photoURL: row.photoURL || photo,
                    username:
                      better && better !== "creator" ? better : row.username,
                  }
                : row,
            ),
          );
        } catch {
          /* best-effort */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-hydrate when visible post ids change
  }, [current?.id, prevPost?.id, nextPost?.id]);

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

  useEffect(() => {
    if (!session?.idToken || !session.sub || firebaseReady) return;
    void ensureFirebaseFromCognito({
      cognitoIdToken: session.idToken,
      uid: session.sub,
    });
  }, [session?.idToken, session?.sub, firebaseReady]);

  const unlockAudio = useCallback(() => {
    if (unlockedAudio.current) return;
    unlockedAudio.current = true;
    setMuted(false);
  }, []);

  const showToast = useCallback((msg: string, ms = 2000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(posts.length - 1, Math.max(0, i + delta));
        if (next !== i) {
          setSlideDir(delta > 0 ? 1 : -1);
          window.setTimeout(() => setSlideDir(0), 200);
        }
        return next;
      });
      setGiftsOpen(false);
      setCommentsOpen(false);
    },
    [posts.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowRight") {
        unlockAudio();
        go(1);
      }
      if (e.key === "ArrowUp" || e.key === "k" || e.key === "ArrowLeft") {
        unlockAudio();
        go(-1);
      }
      if (e.key === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, unlockAudio]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let touchX = 0;
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchX = e.touches[0]?.clientX || 0;
      touchY = e.touches[0]?.clientY || 0;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const x = e.changedTouches[0]?.clientX || 0;
      const y = e.changedTouches[0]?.clientY || 0;
      const dx = touchX - x;
      const dy = touchY - y;
      if (Math.abs(dx) < 48 && Math.abs(dy) < 48) return;
      unlockAudio();
      if (Math.abs(dx) > Math.abs(dy)) {
        go(dx > 0 ? 1 : -1);
      } else {
        go(dy > 0 ? 1 : -1);
      }
    };
    let wheelLock = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (Date.now() < wheelLock) return;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX < 20 && absY < 20) return;
      wheelLock = Date.now() + 420;
      unlockAudio();
      if (absX > absY) {
        go(e.deltaX > 0 ? 1 : -1);
      } else {
        go(e.deltaY > 0 ? 1 : -1);
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [go, unlockAudio]);

  const [giftList, setGiftList] = useState<GiftItem[]>(FALLBACK_GIFTS);
  useEffect(() => {
    if (!session?.idToken) {
      setGiftList(FALLBACK_GIFTS);
      return;
    }
    let alive = true;
    fetchGiftCatalog(session.idToken)
      .then((gifts) => {
        if (alive && gifts.length) setGiftList(gifts);
      })
      .catch(() => {
        if (alive) setGiftList(FALLBACK_GIFTS);
      });
    return () => {
      alive = false;
    };
  }, [session?.idToken]);

  const onLike = async () => {
    if (requireAuth("Log in to like")) return;
    if (!session?.idToken || !session.sub || !current?.id) return;
    if (likeBusyRef.current) return;
    likeBusyRef.current = true;
    setLikeBusy(true);

    const prevLiked = liked;
    const prevCount = likeCount;
    setLiked(!prevLiked);
    setLikeCount(Math.max(0, prevCount + (prevLiked ? -1 : 1)));

    try {
      const result = await togglePostLike({
        postId: current.id,
        userId: session.sub,
        cognitoIdToken: session.idToken,
      });
      if (result.ok) {
        setLiked(result.liked);
        setLikeCount(result.count);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === current.id ? { ...p, likes: result.count } : p,
          ),
        );
      } else {
        setLiked(prevLiked);
        setLikeCount(prevCount);
        showToast(
          result.reason === "FIREBASE_AUTH_NOT_READY"
            ? "Auth bridge failed — try again"
            : "Like failed",
        );
      }
    } catch {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      showToast("Like failed");
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  };

  const onShare = async () => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/v/${current?.id}`
        : `/v/${current?.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title: `@${handle} on Blyp` });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
      }
    } catch {
      /* dismissed */
    }
  };

  const onSave = async () => {
    if (requireAuth("Log in to save")) return;
    if (!session?.idToken || !session.sub || !current?.id) return;
    if (saveBusyRef.current) return;
    saveBusyRef.current = true;
    setSaveBusy(true);
    const prev = saved;
    setSaved(!prev);
    try {
      const result = await togglePostBookmark({
        uid: session.sub,
        cognitoIdToken: session.idToken,
        post: current,
      });
      if (result.ok) {
        setSaved(result.saved);
        showToast(result.saved ? "Saved" : "Removed from saved");
      } else {
        setSaved(prev);
        showToast(
          result.reason === "FIREBASE_AUTH_NOT_READY"
            ? "Auth bridge failed — try again"
            : "Save failed",
        );
      }
    } catch {
      setSaved(prev);
      showToast("Save failed");
    } finally {
      saveBusyRef.current = false;
      setSaveBusy(false);
    }
  };

  const onGift = async (gift: GiftItem) => {
    if (requireAuth("Log in to gift")) return;
    if (!session?.idToken || !current?.userId || !current?.id) return;
    if (current.userId === session.sub) {
      showToast("Can't gift yourself");
      return;
    }
    setGiftBusy(true);
    try {
      const out = (await sendGift({
        idToken: session.idToken,
        postOrStreamId: current.id,
        receiverUserId: current.userId,
        giftId: gift.giftId,
      })) as { coinSpent?: number };
      const spent = Number(out?.coinSpent || gift.coinCost || 0);
      showToast(`Sent ${gift.name}${spent ? ` · −${spent} coins` : ""}`, 2400);
      setGiftsOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gift failed", 2800);
    } finally {
      setGiftBusy(false);
    }
  };

  const onCommentCountChange = useCallback((count: number) => {
    setCommentCount(count);
  }, []);

  if (!posts.length) {
    return (
      <div className="flex h-full min-h-[50dvh] items-center justify-center px-5 text-center">
        <div>
          <p className="font-display text-2xl font-bold">No videos yet</p>
          <p className="mt-3 text-sm text-[var(--blyp-muted)]">
            Nothing playable in the feed right now. Try Explore or check back soon.
          </p>
          <Link
            href="/explore"
            className="mt-6 inline-flex rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          >
            Open Explore
          </Link>
        </div>
      </div>
    );
  }

  const actionRail = (
    <div className="flex flex-col items-center gap-4">
      <Link
        href={`/u/${encodeURIComponent(handle)}`}
        aria-label={`@${handle}`}
      >
        <CreatorAvatar username={handle} photoURL={current?.photoURL} />
      </Link>
      <ActionButton
        label={formatCount(likeCount)}
        onClick={() => {
          void onLike();
        }}
      >
        <span className={likeBusy ? "opacity-70" : undefined}>
          <IconHeart filled={liked} />
        </span>
      </ActionButton>
      <ActionButton
        label={formatCount(commentCount)}
        onClick={() => {
          setGiftsOpen(false);
          setCommentsOpen(true);
        }}
      >
        <IconComment />
      </ActionButton>
      <ActionButton
        label="Gift"
        accent
        onClick={() => {
          if (requireAuth("Log in to gift")) return;
          setCommentsOpen(false);
          setGiftsOpen((v) => !v);
        }}
      >
        <IconGift />
      </ActionButton>
      <ActionButton
        label={saved ? "Saved" : "Save"}
        onClick={() => {
          void onSave();
        }}
      >
        <span className={saveBusy ? "opacity-70" : undefined}>
          <IconBookmark filled={saved} />
        </span>
      </ActionButton>
      <ActionButton label="Share" onClick={() => void onShare()}>
        <IconShare />
      </ActionButton>
      <ActionButton
        label={muted ? "Unmute" : "Mute"}
        onClick={() => {
          unlockedAudio.current = true;
          setMuted((m) => !m);
        }}
      >
        <IconMute muted={muted} />
      </ActionButton>
    </div>
  );

  return (
    <div
      ref={scrollerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
      onPointerDown={unlockAudio}
    >
      <PeekStrip
        post={prevPost}
        side="left"
        onJump={() => {
          unlockAudio();
          go(-1);
        }}
      />
      <PeekStrip
        post={nextPost}
        side="right"
        onJump={() => {
          unlockAudio();
          go(1);
        }}
      />

      {/* Composed column: tall stage + rail glued + chevrons (TikTok desktop density). */}
      <div className="relative z-[2] flex h-full max-h-full w-full items-center justify-center px-0 md:gap-3 md:px-3 md:py-2 lg:gap-4">
        <div
          className={`relative h-full w-full shrink-0 overflow-hidden bg-black transition-transform duration-200 md:h-[min(100dvh-1rem,960px)] md:w-auto md:max-h-full md:aspect-[9/16] md:rounded-lg md:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] ${
            slideDir === 1
              ? "translate-y-[-4px] md:translate-y-[-6px]"
              : slideDir === -1
                ? "translate-y-[4px] md:translate-y-[6px]"
                : ""
          }`}
        >
          {posts.map((post, i) => {
            const near = Math.abs(i - index) <= 1;
            if (!near) return null;
            return (
              <div
                key={post.id}
                className={`absolute inset-0 overflow-hidden transition-opacity duration-200 ${
                  i === index
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                {post.videoUrl ? (
                  <VideoPlayer
                    src={post.videoUrl}
                    poster={post.posterUrl}
                    active={i === index}
                    warm={Math.abs(i - index) === 1}
                    muted={muted || i !== index}
                    className="absolute inset-0 h-full w-full object-cover"
                    onEnded={() => go(1)}
                  />
                ) : null}
              </div>
            );
          })}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-4 pb-20 pr-[4.5rem] md:pb-5 md:pr-16">
            <div className="pointer-events-auto max-w-[88%]">
              <Link
                href={`/u/${encodeURIComponent(handle)}`}
                className="font-display text-[17px] font-bold text-white drop-shadow"
              >
                @{handle}
              </Link>
              {current?.caption ? (
                <p className="mt-1.5 line-clamp-3 text-[14px] leading-snug text-white/95 drop-shadow">
                  {current.caption}
                </p>
              ) : null}
            </div>
          </div>

          {/* Mobile: rail on video. Desktop: rail sits just outside right edge. */}
          <div className="absolute bottom-24 right-2.5 z-10 md:hidden">
            {actionRail}
          </div>
        </div>

        <div className="relative z-10 hidden shrink-0 self-end pb-8 md:block">
          {actionRail}
        </div>

        <div className="hidden shrink-0 flex-col gap-2 self-center lg:flex">
          <button
            type="button"
            aria-label="Previous"
            disabled={index <= 0}
            onClick={() => {
              unlockAudio();
              go(-1);
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 disabled:opacity-30"
          >
            <IconChevron dir="up" />
          </button>
          <button
            type="button"
            aria-label="Next"
            disabled={index >= posts.length - 1}
            onClick={() => {
              unlockAudio();
              go(1);
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 disabled:opacity-30"
          >
            <IconChevron dir="down" />
          </button>
        </div>
      </div>

      {muted ? (
        <button
          type="button"
          onClick={() => {
            unlockedAudio.current = true;
            setMuted(false);
          }}
          className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur md:top-5"
        >
          Tap for sound
        </button>
      ) : null}

      {commentsOpen && current?.id ? (
        <CommentsPanel
          postId={current.id}
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          onCountChange={onCommentCountChange}
        />
      ) : null}

      {giftsOpen ? (
        <div className="absolute inset-x-0 bottom-14 z-20 border-t border-white/10 bg-[rgba(7,7,10,0.96)] p-4 backdrop-blur-md md:bottom-4 md:left-1/2 md:max-w-[420px] md:-translate-x-1/2 md:rounded-2xl md:border">
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
                onClick={() => void onGift(g)}
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
    </div>
  );
}
