"use client";

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
        const feed = await fetchForYouFeed(16);
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
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="font-display text-2xl font-bold">Feed error</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">{error}</p>
      </div>
    );
  }

  if (!posts) {
    return (
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[480px] items-center justify-center">
        <p className="text-sm text-[var(--blyp-muted)]">Loading For You…</p>
      </div>
    );
  }

  return <ForYouPlayer initialPosts={posts} startId={startId} />;
}
