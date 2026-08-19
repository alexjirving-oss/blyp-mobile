"use client";

import Link from "next/link";
import type { FeedPost } from "@/lib/feed";
import type { PastLiveItem, StageModel } from "@/lib/stage";
import type { SocialProfile } from "@/lib/social";
import "./stage-profile.css";

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
}: {
  photoURL: string | null;
  name: string;
  sizeClass: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#16161f] text-sm font-bold text-[var(--blyp-teal)] ${sizeClass}`}
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

function PostTile({ post }: { post: FeedPost }) {
  const isVideo =
    !!post.videoUrl || String(post.type || "").toLowerCase().includes("video");
  const label = postLabel(post);
  const plays = Math.max(post.views || 0, post.likes || 0);

  return (
    <Link href={`/v/${post.id}`} className="stage-web-tile group">
      {post.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.posterUrl} alt="" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-[linear-gradient(160deg,#0b1f1c_0%,#12121a_55%,rgba(0,210,190,0.28)_100%)] px-2 text-center">
          {isVideo ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-sm font-bold text-[var(--blyp-teal)]">
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
  const hasCover = !!stage.coverUrl;
  const cover = hasCover
    ? `url(${stage.coverUrl})`
    : undefined;
  const metaBits = [stage.pronouns, stage.location, stage.vibe].filter(Boolean);

  return (
    <div className="stage-web">
      <div
        className={`stage-web-cover ${
          hasCover ? "stage-web-cover-has" : "stage-web-cover-empty"
        }`}
        style={cover ? { backgroundImage: cover } : undefined}
      >
        {stage.liveStreamId ? (
          <Link href={`/live/${stage.liveStreamId}`} className="stage-web-live">
            LIVE now
          </Link>
        ) : null}
        <div className="stage-web-mark">Stage</div>
      </div>

      <div className="stage-web-body">
        <div className="stage-web-id">
          <div className="stage-web-avatar">
            <Avatar
              photoURL={stage.photoURL}
              name={stage.displayName}
              sizeClass="h-[84px] w-[84px] text-2xl md:h-24 md:w-24 md:text-3xl"
            />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="stage-web-name">{stage.displayName}</h1>
            <p className="stage-web-handle">@{stage.username}</p>
          </div>
        </div>

        <div className="stage-web-stats">
          {(
            [
              ["Posts", stage.stats.posts],
              ["Followers", stage.stats.followers],
              ["Following", stage.stats.following],
              ["Likes", stage.stats.likes],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="stage-web-stat">
              <div className="stage-web-stat-n">{formatCount(value)}</div>
              <div className="stage-web-stat-l">{label}</div>
            </div>
          ))}
        </div>

        {metaBits.length ? (
          <p className="stage-web-meta">{metaBits.join(" · ")}</p>
        ) : null}

        {stage.bio ? <p className="stage-web-bio">{stage.bio}</p> : null}

        {stage.flair.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stage.flair.map((f) => (
              <span key={f.id} className="stage-web-chip">
                {f.label}
              </span>
            ))}
          </div>
        ) : null}

        <div className="stage-web-actions">
          {isOwner ? (
            <>
              <Link href="/live/studio" className="stage-web-btn">
                Go LIVE
              </Link>
              <Link href="/upload" className="stage-web-ghost">
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
                  className={
                    isFollowing ? "stage-web-btn stage-web-btn-on" : "stage-web-btn"
                  }
                >
                  {followBusy ? "…" : isFollowing ? "Following" : "Follow"}
                </button>
              ) : (
                <Link href="/login" className="stage-web-btn">
                  Follow
                </Link>
              )}
              {isLoggedIn ? (
                <Link
                  href={`/inbox?with=${encodeURIComponent(stage.userId)}`}
                  className="stage-web-ghost"
                >
                  Message
                </Link>
              ) : (
                <Link href="/login" className="stage-web-ghost">
                  Message
                </Link>
              )}
            </>
          )}
          {stage.liveStreamId && !isOwner ? (
            <Link
              href={`/live/${stage.liveStreamId}`}
              className="stage-web-btn stage-web-watch"
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
                className="stage-web-ghost"
                style={{ minHeight: "2rem", fontSize: "0.75rem" }}
              >
                {l.label}
              </a>
            ))}
          </div>
        ) : null}

        {pinned.length ? (
          <section className="stage-web-section">
            <h2 className="stage-web-h">Pinned</h2>
            <div className="stage-web-grid">
              {pinned.map((p) => (
                <PostTile key={p.id} post={p} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="stage-web-section">
          <div className="stage-web-section-head">
            <h2 className="stage-web-h" style={{ margin: 0 }}>
              Videos
            </h2>
            <span className="stage-web-count">{stage.stats.posts}</span>
          </div>
          {posts.length ? (
            <div className="stage-web-grid">
              {posts.map((p) => (
                <PostTile key={p.id} post={p} />
              ))}
            </div>
          ) : (
            <p className="stage-web-empty">
              {isOwner
                ? "No videos on your Stage yet. Upload or Go LIVE."
                : "No videos on this Stage yet."}
            </p>
          )}
        </section>

        <section className="stage-web-section">
          <div className="stage-web-section-head">
            <h2 className="stage-web-h" style={{ margin: 0 }}>
              Top Circle
            </h2>
            <span className="stage-web-count">People they follow</span>
          </div>
          {topCircle.length ? (
            <div className="stage-web-row">
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
                    />
                    {p.isLive ? (
                      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-[#fe2c55] px-1 text-[8px] font-bold uppercase text-white">
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
            <p className="stage-web-empty">No Top Circle yet.</p>
          )}
        </section>

        {pastLives.length ? (
          <section className="stage-web-section">
            <h2 className="stage-web-h">Past lives</h2>
            <div className="stage-web-row">
              {pastLives.map((item) => (
                <div
                  key={item.id}
                  className="w-[132px] shrink-0 overflow-hidden rounded-xl"
                  style={{
                    background: "#16161f",
                    boxShadow: "inset 0 0 0 1px var(--blyp-line)",
                  }}
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
                      <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#0b1f1c,#12121a)]">
                        <span className="text-xs font-bold text-[var(--blyp-teal)] opacity-70">
                          ▶
                        </span>
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
                    <p className="text-[10px] text-[var(--blyp-muted)]">
                      {formatCount(item.peakViewerCount)} peak
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
