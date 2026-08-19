"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchExplorePosts, type FeedPost } from "@/lib/feed";
import { ExploreFollowingGrid } from "./ExploreFollowingGrid";
import "./explore-following.css";

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
      <div className="neon-feed">
        <section className="neon-feed-panel">
          <p className="neon-feed-kicker">Discover</p>
          <h1>Explore error</h1>
          <p className="neon-feed-lede">{error}</p>
        </section>
      </div>
    );
  }

  if (!posts) {
    return (
      <div className="neon-feed">
        <div className="neon-feed-status">
          <p>Loading Explore…</p>
        </div>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="neon-feed">
        <section className="neon-feed-hero">
          <p className="neon-feed-kicker">Discover</p>
          <h1>Explore</h1>
          <p className="neon-feed-lede">
            No videos ranked yet. Check For You.
          </p>
          <div className="neon-feed-actions">
            <Link href="/foryou" className="neon-feed-btn is-teal">
              Open For You
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="neon-feed">
      <section className="neon-feed-hero">
        <p className="neon-feed-kicker">Discover</p>
        <h1>Explore</h1>
        <p className="neon-feed-lede">
          Recent videos ranked by likes, comments, and views.
        </p>
        <div className="neon-feed-chips">
          <span className="neon-feed-chip">
            <span className="neon-feed-chip-dot" />
            {posts.length} {posts.length === 1 ? "video" : "videos"}
          </span>
        </div>
      </section>
      <div className="neon-feed-grid-wrap">
        <ExploreFollowingGrid posts={posts} />
      </div>
    </div>
  );
}
