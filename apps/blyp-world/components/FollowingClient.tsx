"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFollowingPosts, type FeedPost } from "@/lib/feed";
import { getFollowingIds } from "@/lib/social";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { useAuth } from "./AuthProvider";
import { ForYouPlayer } from "./ForYouPlayer";

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
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[480px] items-center justify-center">
        <p className="text-sm text-[var(--blyp-muted)]">Loading Following…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Following</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in to watch posts from accounts you follow.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="font-display text-2xl font-bold">Couldn’t load Following</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">{error}</p>
      </div>
    );
  }

  if (!followingCount) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">No follows yet</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Follow creators on Stage or For You — their videos show up here.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/explore"
            className="rounded-full border border-[var(--blyp-line)] px-5 py-2.5 text-sm font-semibold"
          >
            Explore
          </Link>
          <Link
            href="/foryou"
            className="rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          >
            For You
          </Link>
        </div>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Nothing new</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          You’re following {followingCount}{" "}
          {followingCount === 1 ? "account" : "accounts"}, but none have recent
          videos in the feed window.
        </p>
        <Link
          href="/friends"
          className="mt-8 inline-flex rounded-full border border-[var(--blyp-line)] px-5 py-2.5 text-sm font-semibold"
        >
          Open Friends
        </Link>
      </div>
    );
  }

  return <ForYouPlayer initialPosts={posts} />;
}
