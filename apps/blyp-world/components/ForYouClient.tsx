"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ForYouPlayer } from "./ForYouPlayer";
import { fetchForYouFeed, fetchPostById, type FeedPost } from "@/lib/feed";
import "./foryou-web.css";

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
      <div className="fy-web">
        <div className="fy-web-state">
          <div className="fy-web-state-card">
            <p className="fy-web-kicker">For You</p>
            <p className="fy-web-title">Couldn’t load For You</p>
            <p className="fy-web-copy">{error}</p>
            <button
              type="button"
              className="fy-web-go"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!posts) {
    return (
      <div className="fy-web">
        <div className="fy-web-state">
          <div className="fy-web-pulse" aria-hidden />
        </div>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="fy-web">
        <div className="fy-web-state">
          <div className="fy-web-state-card">
            <p className="fy-web-kicker">For You</p>
            <p className="fy-web-title">No videos yet</p>
            <p className="fy-web-copy">
              The feed is empty right now. Browse Explore while creators post.
            </p>
            <Link href="/explore" className="fy-web-go">
              Open Explore
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fy-web">
      <ForYouPlayer initialPosts={posts} startId={startId} />
    </div>
  );
}
