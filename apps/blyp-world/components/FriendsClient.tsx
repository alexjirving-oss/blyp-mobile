"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import {
  getFollowingIds,
  getFriendIds,
  hydrateProfiles,
  type SocialProfile,
} from "@/lib/social";
import { useAuth } from "./AuthProvider";
import "./hub-neon.css";

type Tab = "friends" | "following";

function Avatar({ profile }: { profile: SocialProfile }) {
  const letter = (profile.displayName || profile.username || "B")
    .slice(0, 1)
    .toUpperCase();
  return (
    <div className="hub-avatar hub-avatar-lg">
      {profile.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.photoURL} alt="" />
      ) : (
        <span>{letter}</span>
      )}
      {profile.isLive ? <span className="hub-live">LIVE</span> : null}
    </div>
  );
}

export function FriendsClient() {
  const { session, loading, requireAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<SocialProfile[] | null>(null);
  const [following, setFollowing] = useState<SocialProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.sub) {
      requireAuth("Log in to see friends");
      setFriends([]);
      setFollowing([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        await ensureFirebaseFromCognito({
          cognitoIdToken: session.idToken,
          uid: session.sub,
        });
        const [friendIds, followingIds] = await Promise.all([
          getFriendIds(session.sub),
          getFollowingIds(session.sub),
        ]);
        const [friendProfiles, followingProfiles] = await Promise.all([
          hydrateProfiles(friendIds),
          hydrateProfiles(followingIds),
        ]);
        if (!alive) return;
        setFriends(friendProfiles);
        setFollowing(followingProfiles);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load friends");
          setFriends([]);
          setFollowing([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, session, requireAuth]);

  if (loading || friends === null || following === null) {
    return (
      <div className="hub">
        <p className="hub-kicker">Social</p>
        <h1 className="hub-title">Friends</h1>
        <p className="hub-load">Loading your follows…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="hub">
        <p className="hub-kicker">Social</p>
        <h1 className="hub-title">Friends</h1>
        <p className="hub-lead">
          Mutual follows and people you follow — same graph as the Blyp app.
        </p>
        <div className="hub-card">
          <div className="hub-empty">
            <div className="hub-empty-stage">
              <span>SIGNED OUT</span>
            </div>
            <h2>Log in to see friends</h2>
            <p>Nothing is listed here until your account loads.</p>
            <Link href="/login" className="hub-go">
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hub">
        <p className="hub-kicker">Social</p>
        <h1 className="hub-title">Friends</h1>
        <p className="hub-err">{error}</p>
      </div>
    );
  }

  const list = tab === "friends" ? friends : following;

  return (
    <div className="hub">
      <header>
        <p className="hub-kicker">Social</p>
        <h1 className="hub-title">Friends</h1>
        <p className="hub-lead">
          Friends are mutual follows. Following is everyone you follow. Counts
          come from your graph — not placeholders.
        </p>
      </header>

      <div className="hub-tabs">
        {(
          [
            ["friends", "Friends", friends.length],
            ["following", "Following", following.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`hub-tab${tab === key ? " is-on" : ""}`}
          >
            {label}
            {count > 0 ? <span className="hub-count">{count}</span> : null}
          </button>
        ))}
      </div>

      {!list.length ? (
        <div className="hub-card">
          <div className="hub-empty">
            <div className="hub-empty-stage">
              <span>{tab === "friends" ? "NO MUTUALS" : "NONE YET"}</span>
            </div>
            <h2>
              {tab === "friends"
                ? "No mutual follows yet"
                : "You’re not following anyone"}
            </h2>
            <p>
              {tab === "friends"
                ? "When someone you follow follows you back, they show up here."
                : "Follow people from Explore or a Stage. This list stays empty until you do."}
            </p>
            <Link href="/explore" className="hub-go">
              Find people on Explore
            </Link>
          </div>
        </div>
      ) : (
        <ul className="hub-card hub-list">
          {list.map((profile) => (
            <li key={profile.userId}>
              <Link
                href={
                  profile.isLive && profile.liveStreamId
                    ? `/live/${encodeURIComponent(profile.liveStreamId)}`
                    : `/u/${encodeURIComponent(profile.username)}`
                }
                className="hub-row"
              >
                <Avatar profile={profile} />
                <div className="hub-row-copy">
                  <p className="hub-row-name">{profile.displayName}</p>
                  <p className="hub-row-meta">@{profile.username}</p>
                </div>
                <span className="hub-row-aside">
                  {profile.isLive ? "Watch" : "Stage"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
