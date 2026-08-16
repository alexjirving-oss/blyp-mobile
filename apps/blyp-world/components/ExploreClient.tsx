"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchExplorePosts, type FeedPost } from "@/lib/feed";

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function ExploreClient() {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchExplorePosts(48);
        if (alive) setPosts(list);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load explore");
          setPosts([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="font-display text-2xl font-bold">Explore error</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">{error}</p>
      </div>
    );
  }

  if (!posts) {
    return (
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        Loading Explore…
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Explore</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          No videos ranked yet. Check For You.
        </p>
        <Link
          href="/foryou"
          className="mt-8 inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Open For You
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
          Discover
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold">Explore</h1>
        <p className="mt-2 text-sm text-[var(--blyp-muted)]">
          Recent videos ranked by likes, comments, and views.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/v/${encodeURIComponent(post.id)}`}
            className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-black"
          >
            {post.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.posterUrl}
                alt=""
                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#1a1a22] to-black text-xs text-[var(--blyp-muted)]">
                @{post.username}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5 pt-10">
              <p className="truncate text-xs font-semibold text-white">
                @{post.username}
              </p>
              <p className="mt-0.5 text-[11px] text-white/75">
                ♥ {formatCount(post.likes)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
