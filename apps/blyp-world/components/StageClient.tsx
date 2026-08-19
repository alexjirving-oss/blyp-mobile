"use client";

import { useCallback, useEffect, useState } from "react";
import { StageView } from "./StageView";
import { useAuth } from "./AuthProvider";
import {
  fetchStageByUsername,
  type PastLiveItem,
  type StageModel,
} from "@/lib/stage";
import type { FeedPost } from "@/lib/feed";
import type { SocialProfile } from "@/lib/social";
import {
  followUser,
  isFollowingUser,
  unfollowUser,
} from "@/lib/social";
import "./stage-profile.css";

export function StageClient({ username }: { username: string }) {
  const { session, me, requireAuth } = useAuth();
  const [stage, setStage] = useState<StageModel | null>(null);
  const [pinned, setPinned] = useState<FeedPost[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [topCircle, setTopCircle] = useState<SocialProfile[]>([]);
  const [pastLives, setPastLives] = useState<PastLiveItem[]>([]);
  const [missing, setMissing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerId = session?.sub || me?.uid || null;
  const isOwner = !!(viewerId && stage?.userId && viewerId === stage.userId);
  const isLoggedIn = !!session?.idToken;

  useEffect(() => {
    let alive = true;
    setMissing(false);
    setStage(null);
    setError(null);
    (async () => {
      try {
        const result = await fetchStageByUsername(username);
        if (!alive) return;
        if (!result) {
          setMissing(true);
          return;
        }
        setStage(result.stage);
        setPinned(result.pinned);
        setPosts(result.posts);
        setTopCircle(result.topCircle);
        setPastLives(result.pastLives);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load Stage");
        setMissing(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  useEffect(() => {
    let alive = true;
    if (!viewerId || !stage?.userId || viewerId === stage.userId) {
      setIsFollowing(false);
      return;
    }
    isFollowingUser(viewerId, stage.userId).then((v) => {
      if (alive) setIsFollowing(v);
    });
    return () => {
      alive = false;
    };
  }, [viewerId, stage?.userId]);

  const onFollowToggle = useCallback(async () => {
    if (!stage?.userId) return;
    if (requireAuth("Log in to follow")) return;
    if (!session?.idToken) return;
    if (followBusy) return;
    const was = isFollowing;
    setFollowBusy(true);
    setIsFollowing(!was);
    setStage((prev) =>
      prev
        ? {
            ...prev,
            stats: {
              ...prev.stats,
              followers: Math.max(
                0,
                prev.stats.followers + (was ? -1 : 1),
              ),
            },
          }
        : prev,
    );
    try {
      if (was) await unfollowUser(session.idToken, stage.userId);
      else await followUser(session.idToken, stage.userId);
    } catch (e) {
      setIsFollowing(was);
      setStage((prev) =>
        prev
          ? {
              ...prev,
              stats: {
                ...prev.stats,
                followers: Math.max(
                  0,
                  prev.stats.followers + (was ? 1 : -1),
                ),
              },
            }
          : prev,
      );
      setError(e instanceof Error ? e.message : "Follow failed");
    } finally {
      setFollowBusy(false);
    }
  }, [
    stage?.userId,
    requireAuth,
    session?.idToken,
    followBusy,
    isFollowing,
  ]);

  if (missing) {
    return (
      <div className="stage-web">
        <div className="stage-web-state">
          <div className="stage-web-card">
            <p className="stage-web-kicker">Stage</p>
            <p className="stage-web-title">@{username}</p>
            <p className="stage-web-copy">
              No Stage found for this username yet.
            </p>
            {error ? <p className="stage-web-err">{error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="stage-web">
        <div className="stage-web-state">
          <div className="stage-web-pulse" aria-hidden />
          <p className="stage-web-copy">Loading Stage…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="stage-web-warn">
          <p>{error}</p>
        </div>
      ) : null}
      <StageView
        stage={stage}
        pinned={pinned}
        posts={posts}
        topCircle={topCircle}
        pastLives={pastLives}
        isOwner={isOwner}
        isLoggedIn={isLoggedIn}
        isFollowing={isFollowing}
        followBusy={followBusy}
        onFollowToggle={onFollowToggle}
      />
    </>
  );
}
