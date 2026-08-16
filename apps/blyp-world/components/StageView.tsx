"use client";

import Link from "next/link";
import type { FeedPost } from "@/lib/feed";
import type { PastLiveItem, StageModel } from "@/lib/stage";
import type { SocialProfile } from "@/lib/social";

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.floor(n));
}

function formatPastDate(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function postLabel(post: FeedPost): string {
  const raw = (post.title || post.caption || "").trim();
  if (raw) return raw;
  return "Video";
}

function Avatar({
  photoURL,
  name,
  sizeClass,
  accent,
  surface,
}: {
  photoURL: string | null;
  name: string;
  sizeClass: string;
  accent?: string;
  surface: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold ${sizeClass}`}
      style={{ background: surface, color: accent || "#fff" }}
    >
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL}
          alt=""
          className="h-full w-full object-cover object-top"
        />
      ) : (
        (name || "?").slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function PostTile({
  post,
  surface,
  accent,
  fallbackFrom,
  fallbackTo,
}: {
  post: FeedPost;
  surface: string;
  accent: string;
  fallbackFrom: string;
  fallbackTo: string;
}) {
  const isVideo =
    !!post.videoUrl || String(post.type || "").toLowerCase().includes("video");
  const label = postLabel(post);
  const plays = Math.max(post.views || 0, post.likes || 0);

  return (
    <Link
      href={`/v/${post.id}`}
      className="group relative aspect-[9/16] overflow-hidden"
      style={{ background: surface }}
    >
      {post.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.posterUrl}
          alt=""
          className="h-full w-full object-cover object-top transition group-hover:scale-[1.02]"
        />
      ) : (
        <div
          className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center"
          style={{
            background: `linear-gradient(160deg, ${fallbackFrom} 0%, ${surface} 55%, ${fallbackTo}44 100%)`,
          }}
        >
          {isVideo ? (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
              style={{ background: "rgba(0,0,0,0.45)", color: accent }}
            >
              ▶
            </span>
          ) : null}
          <span className="line-clamp-3 text-[11px] font-semibold leading-snug text-white/90">
            {label}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1.5 pt-8">
        {post.posterUrl && label !== "Video" ? (
          <p className="mb-0.5 line-clamp-2 text-[10px] font-medium leading-tight text-white/95">
            {label}
          </p>
        ) : null}
        <span className="text-[10px] font-semibold text-white/90">
          {isVideo ? "▶ " : ""}
          {formatCount(plays)}
        </span>
      </div>
    </Link>
  );
}

export function StageView({
  stage,
  pinned,
  posts,
  topCircle,
  pastLives,
  isOwner,
  isLoggedIn,
  isFollowing,
  followBusy,
  onFollowToggle,
}: {
  stage: StageModel;
  pinned: FeedPost[];
  posts: FeedPost[];
  topCircle: SocialProfile[];
  pastLives: PastLiveItem[];
  isOwner: boolean;
  isLoggedIn: boolean;
  isFollowing: boolean;
  followBusy: boolean;
  onFollowToggle: () => void;
}) {
  const c = stage.theme.colors;
  const hasCover = !!stage.coverUrl;
  const cover = hasCover
    ? `url(${stage.coverUrl})`
    : `linear-gradient(120deg, ${c.coverFallback[0]} 0%, ${c.bg} 55%, ${c.coverFallback[1]}22 100%)`;

  const metaBits = [stage.pronouns, stage.location, stage.vibe].filter(Boolean);

  return (
    <div
      className="min-h-[calc(100vh-4rem)] overflow-x-hidden"
      style={{ background: c.bg, color: c.text }}
    >
      {/* Compact cover — not a giant empty slab */}
      <div
        className={`relative w-full overflow-hidden bg-cover bg-center ${
          hasCover ? "h-28 md:h-40" : "h-16 md:h-20"
        }`}
        style={{ backgroundImage: cover }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: hasCover
              ? "linear-gradient(to top, rgba(0,0,0,0.65), transparent 60%)"
              : "linear-gradient(to bottom, transparent, rgba(0,0,0,0.35))",
          }}
        />
        {stage.liveStreamId ? (
          <Link
            href={`/live/${stage.liveStreamId}`}
            className="absolute right-4 top-3 z-10 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ background: c.accent, color: "#07070a" }}
          >
            LIVE now
          </Link>
        ) : null}
        {/* User-facing Stage marker only — never expose internal theme pack ids */}
        <div className="absolute bottom-2 left-4 z-10">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ background: "rgba(0,0,0,0.45)", color: c.accent }}
          >
            Stage
          </span>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[720px] px-4 pb-20">
        {/* Identity */}
        <div className="-mt-10 flex items-end gap-3 md:-mt-12">
          <div
            className="relative z-20 shrink-0 rounded-full border-[3px] shadow-sm"
            style={{ borderColor: c.bg }}
          >
            <Avatar
              photoURL={stage.photoURL}
              name={stage.displayName}
              sizeClass="h-[84px] w-[84px] text-2xl md:h-24 md:w-24 md:text-3xl"
              surface={c.surface}
              accent={c.accent}
            />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="font-display break-words text-2xl font-extrabold leading-tight md:truncate md:text-3xl">
              {stage.displayName}
              {stage.verified ? (
                <span className="ml-1.5 text-base" style={{ color: c.accent }}>
                  ✓
                </span>
              ) : null}
            </h1>
            <p
              className="break-all text-sm md:truncate"
              style={{ color: c.textMuted }}
            >
              @{stage.username}
            </p>
          </div>
        </div>

        {/* Stats — TikTok density; wrap cleanly on narrow screens */}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-center sm:gap-8">
          {(
            [
              ["Posts", stage.stats.posts],
              ["Followers", stage.stats.followers],
              ["Following", stage.stats.following],
              ["Likes", stage.stats.likes],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="min-w-[3.25rem]">
              <div className="text-base font-bold tabular-nums md:text-lg">
                {formatCount(value)}
              </div>
              <div
                className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: c.textMuted }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        {metaBits.length ? (
          <p className="mt-3 break-words text-xs" style={{ color: c.textMuted }}>
            {metaBits.join(" · ")}
          </p>
        ) : null}

        {stage.bio ? (
          <p className="mt-3 max-w-xl break-words text-sm leading-relaxed opacity-90">
            {stage.bio}
          </p>
        ) : null}

        {stage.flair.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stage.flair.map((f) => (
              <span
                key={f.id}
                className="max-w-full break-words rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: c.accentSoft,
                  color: c.accent,
                  border: `1px solid ${c.border}`,
                }}
              >
                {f.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2">
          {isOwner ? (
            <>
              <Link
                href="/live/studio"
                className="rounded-full px-4 py-2 text-sm font-bold"
                style={{ background: c.accent, color: "#07070a" }}
              >
                Go LIVE
              </Link>
              <Link
                href="/upload"
                className="rounded-full border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: c.border }}
              >
                Upload
              </Link>
            </>
          ) : (
            <>
              {isLoggedIn ? (
                <button
                  type="button"
                  disabled={followBusy}
                  onClick={onFollowToggle}
                  className="rounded-full px-5 py-2 text-sm font-bold disabled:opacity-60"
                  style={
                    isFollowing
                      ? {
                          background: c.surface,
                          color: c.text,
                          border: `1px solid ${c.border}`,
                        }
                      : { background: c.accent, color: "#07070a" }
                  }
                >
                  {followBusy
                    ? "…"
                    : isFollowing
                      ? "Following"
                      : "Follow"}
                </button>
              ) : (
                <Link
                  href="/login"
                  className="rounded-full px-5 py-2 text-sm font-bold"
                  style={{ background: c.accent, color: "#07070a" }}
                >
                  Follow
                </Link>
              )}
              {isLoggedIn ? (
                <Link
                  href={`/inbox?with=${encodeURIComponent(stage.userId)}`}
                  className="rounded-full border px-4 py-2 text-sm font-semibold"
                  style={{ borderColor: c.border }}
                >
                  Message
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="rounded-full border px-4 py-2 text-sm font-semibold"
                  style={{ borderColor: c.border }}
                >
                  Message
                </Link>
              )}
            </>
          )}
          {stage.liveStreamId && !isOwner ? (
            <Link
              href={`/live/${stage.liveStreamId}`}
              className="rounded-full px-4 py-2 text-sm font-bold"
              style={{ background: "#ef4444", color: "#fff" }}
            >
              Watch LIVE
            </Link>
          ) : null}
        </div>

        {stage.links.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {stage.links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: c.border }}
              >
                {l.label}
              </a>
            ))}
          </div>
        ) : null}

        {/* Pinned showcase — with Videos near top */}
        {pinned.length ? (
          <section className="mt-8">
            <h2 className="font-display mb-3 text-lg font-bold">Pinned</h2>
            <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg">
              {pinned.map((p) => (
                <PostTile
                  key={p.id}
                  post={p}
                  surface={c.surface}
                  accent={c.accent}
                  fallbackFrom={c.coverFallback[0]}
                  fallbackTo={c.coverFallback[1]}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Videos / posts — up with Past lives content, not under Wall */}
        <section className="mt-8">
          <div
            className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2"
            style={{ borderColor: c.border }}
          >
            <h2 className="font-display text-lg font-bold">Videos</h2>
            <span
              className="text-xs tabular-nums"
              style={{ color: c.textMuted }}
            >
              {stage.stats.posts}
            </span>
          </div>
          {posts.length ? (
            <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg">
              {posts.map((p) => (
                <PostTile
                  key={p.id}
                  post={p}
                  surface={c.surface}
                  accent={c.accent}
                  fallbackFrom={c.coverFallback[0]}
                  fallbackTo={c.coverFallback[1]}
                />
              ))}
            </div>
          ) : (
            <p
              className="py-10 text-center text-sm"
              style={{ color: c.textMuted }}
            >
              {isOwner
                ? "No videos on your Stage yet. Upload or Go LIVE."
                : "No videos on this Stage yet."}
            </p>
          )}
        </section>

        {/* Top Circle */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-bold">Top Circle</h2>
            <span className="text-[11px]" style={{ color: c.textMuted }}>
              People they follow
            </span>
          </div>
          {topCircle.length ? (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {topCircle.map((p) => (
                <Link
                  key={p.userId}
                  href={`/u/${encodeURIComponent(p.username)}`}
                  className="flex w-16 shrink-0 flex-col items-center gap-1.5"
                >
                  <div className="relative">
                    <Avatar
                      photoURL={p.photoURL}
                      name={p.displayName}
                      sizeClass="h-14 w-14"
                      surface={c.surface}
                      accent={c.accent}
                    />
                    {p.isLive ? (
                      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 text-[8px] font-bold uppercase text-white">
                        Live
                      </span>
                    ) : null}
                  </div>
                  <span className="w-full truncate text-center text-[10px] font-medium">
                    {p.displayName}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: c.textMuted }}>
              No Top Circle yet.
            </p>
          )}
        </section>

        {/* Past lives */}
        {pastLives.length ? (
          <section className="mt-8">
            <h2 className="font-display mb-3 text-lg font-bold">Past lives</h2>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {pastLives.map((item) => (
                <div
                  key={item.id}
                  className="w-[132px] shrink-0 overflow-hidden rounded-xl border"
                  style={{ background: c.surface, borderColor: c.border }}
                >
                  <div className="relative aspect-video overflow-hidden">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div
                        className="flex h-full items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${c.coverFallback[0]}, ${c.border})`,
                        }}
                      >
                        <span className="text-xs font-bold opacity-60">▶</span>
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      {formatPastDate(item.endedAtMs)}
                    </span>
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[11px] font-semibold">
                      {item.title}
                    </p>
                    <p className="text-[10px]" style={{ color: c.textMuted }}>
                      {formatCount(item.peakViewerCount)} peak
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Wall — desktop only stub; hide empty stub on mobile */}
        <section className="mt-8 hidden md:block">
          <h2 className="font-display mb-2 text-lg font-bold">Wall</h2>
          <div
            className="rounded-xl border px-4 py-5 text-sm"
            style={{ borderColor: c.border, background: c.surface }}
          >
            <p style={{ color: c.textMuted }}>
              Followers-only wall notes ship in v1.1. Nothing here yet — no
              fabricated guestbook.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
