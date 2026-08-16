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

type Tab = "friends" | "following";

function Avatar({ profile }: { profile: SocialProfile }) {
  const letter = (profile.displayName || profile.username || "B")
    .slice(0, 1)
    .toUpperCase();
  return (
    <div className="relative shrink-0">
      {profile.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.photoURL}
          alt=""
          className="h-12 w-12 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]">
          {letter}
        </div>
      )}
      {profile.isLive ? (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 text-[9px] font-bold uppercase tracking-wide text-white">
          Live
        </span>
      ) : null}
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
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        Loading Friends…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Friends</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in to see mutual follows and people you follow.
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
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  const list = tab === "friends" ? friends : following;

  return (
    <div className="mx-auto max-w-xl px-4 py-6 pb-24 md:px-6">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
          Social
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold">Friends</h1>
        <p className="mt-2 text-sm text-[var(--blyp-muted)]">
          Friends are mutual follows. Following is everyone you follow.
        </p>
      </header>

      <div className="mb-5 flex gap-2">
        {(
          [
            ["friends", `Friends (${friends.length})`],
            ["following", `Following (${following.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === key
                ? "bg-[var(--blyp-teal)] text-[var(--blyp-ink)]"
                : "border border-[var(--blyp-line)] text-[var(--blyp-fog)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!list.length ? (
        <div className="rounded-2xl border border-[var(--blyp-line)] px-5 py-10 text-center">
          <p className="text-sm text-[var(--blyp-muted)]">
            {tab === "friends"
              ? "No mutual follows yet. Follow someone who follows you back."
              : "You’re not following anyone yet."}
          </p>
          <Link
            href="/explore"
            className="mt-5 inline-flex rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
          >
            Find people on Explore
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--blyp-line)] border-y border-[var(--blyp-line)]">
          {list.map((profile) => (
            <li key={profile.userId}>
              <Link
                href={
                  profile.isLive && profile.liveStreamId
                    ? `/live/${encodeURIComponent(profile.liveStreamId)}`
                    : `/u/${encodeURIComponent(profile.username)}`
                }
                className="flex items-center gap-3 px-1 py-3.5 transition hover:bg-white/[0.03]"
              >
                <Avatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{profile.displayName}</p>
                  <p className="truncate text-sm text-[var(--blyp-muted)]">
                    @{profile.username}
                  </p>
                </div>
                <span className="text-xs text-[var(--blyp-muted)]">
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
