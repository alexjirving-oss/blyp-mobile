import Link from "next/link";
import type { FeedPost } from "@/lib/feed";

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function ExploreFollowingGrid({ posts }: { posts: FeedPost[] }) {
  return (
    <div className="neon-feed-grid">
      {posts.map((post) => (
        <Link
          key={post.id}
          href={`/v/${encodeURIComponent(post.id)}`}
          className="neon-feed-tile"
        >
          {post.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.posterUrl} alt="" />
          ) : (
            <div className="neon-feed-fallback">@{post.username}</div>
          )}
          <div className="neon-feed-tile-meta">
            <p className="neon-feed-tile-user">@{post.username}</p>
            <p className="neon-feed-tile-stats">
              ♥ {formatCount(post.likes)}
              {post.views > 0 ? ` · ${formatCount(post.views)} views` : ""}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
