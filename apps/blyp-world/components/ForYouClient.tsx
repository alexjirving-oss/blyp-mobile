"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ForYouPlayer } from "./ForYouPlayer";
import { fetchForYouFeed, fetchPostById, type FeedPost } from "@/lib/feed";

export function ForYouClient({ startId }: { startId?: string }) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const feed = await fetchForYouFeed(28);
        let list = feed;
        if (startId) {
          const focused = await fetchPostById(startId);
          if (focused) {
            list = [focused, ...feed.filter((p) => p.id !== focused.id)];
          }
        }
        if (alive) setPosts(list);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load feed");
          setPosts([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [startId]);

  if (error) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-5 text-center">
        <p className="font-display text-2xl font-bold">Couldn’t load For You</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">{error}</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!posts) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--blyp-teal)]/40" />
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-5 text-center">
        <p className="font-display text-2xl font-bold">No videos yet</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          The feed is empty right now. Browse Explore while creators post.
        </p>
        <Link
          href="/explore"
          className="mt-6 inline-flex rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Open Explore
        </Link>
      </div>
    );
  }

  return <ForYouPlayer initialPosts={posts} startId={startId} />;
}
