"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFollowingPosts, type FeedPost } from "@/lib/feed";
import { getFollowingIds } from "@/lib/social";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { useAuth } from "./AuthProvider";
import { ExploreFollowingGrid } from "./ExploreFollowingGrid";
import "./explore-following.css";

export function FollowingClient() {
  const { session, loading, requireAuth } = useAuth();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [followingCount, setFollowingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.sub) {
      requireAuth("Log in to see people you follow");
      setPosts([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        await ensureFirebaseFromCognito({
          cognitoIdToken: session.idToken,
          uid: session.sub,
        });
        const ids = await getFollowingIds(session.sub);
        if (!alive) return;
        setFollowingCount(ids.length);
        if (!ids.length) {
          setPosts([]);
          return;
        }
        const feed = await fetchFollowingPosts(ids, 40);
        if (alive) setPosts(feed);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load following");
          setPosts([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, session, requireAuth]);

  if (loading || posts === null) {
    return (
      <div className="neon-feed is-follow">
        <div className="neon-feed-status">
          <p>Loading Following…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="neon-feed is-follow">
        <section className="neon-feed-hero">
          <p className="neon-feed-kicker">Following</p>
          <h1>Log in to watch</h1>
          <p className="neon-feed-lede">
            Log in to watch posts from accounts you follow.
          </p>
          <div className="neon-feed-actions">
            <Link href="/login" className="neon-feed-btn is-teal">
              Log in
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="neon-feed is-follow">
        <section className="neon-feed-panel">
          <p className="neon-feed-kicker">Following</p>
          <h1>Couldn’t load Following</h1>
          <p className="neon-feed-lede">{error}</p>
        </section>
      </div>
    );
  }

  if (!followingCount) {
    return (
      <div className="neon-feed is-follow">
        <section className="neon-feed-hero">
          <p className="neon-feed-kicker">Following</p>
          <h1>No follows yet</h1>
          <p className="neon-feed-lede">
            Follow creators on Stage or For You — their videos show up here.
          </p>
          <div className="neon-feed-actions">
            <Link href="/explore" className="neon-feed-btn is-ghost">
              Explore
            </Link>
            <Link href="/foryou" className="neon-feed-btn is-teal">
              For You
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="neon-feed is-follow">
        <section className="neon-feed-hero">
          <p className="neon-feed-kicker">Following</p>
          <h1>Nothing new</h1>
          <p className="neon-feed-lede">
            You’re following {followingCount}{" "}
            {followingCount === 1 ? "account" : "accounts"}, but none have recent
            videos in the feed window.
          </p>
          <div className="neon-feed-actions">
            <Link href="/friends" className="neon-feed-btn is-ghost">
              Open Friends
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="neon-feed is-follow">
      <section className="neon-feed-hero">
        <p className="neon-feed-kicker">Following</p>
        <h1>From people you follow</h1>
        <p className="neon-feed-lede">
          Recent videos from accounts you follow.
        </p>
        <div className="neon-feed-chips">
          <span className="neon-feed-chip">
            <span className="neon-feed-chip-dot" />
            {followingCount} {followingCount === 1 ? "account" : "accounts"}
          </span>
          <span className="neon-feed-chip">
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
