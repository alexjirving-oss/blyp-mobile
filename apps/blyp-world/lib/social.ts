"use client";

import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { liveServiceUrl } from "./env";
import { fetchLiveDirectory } from "./live";

export type SocialProfile = {
  userId: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  isLive: boolean;
  liveStreamId: string | null;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function resolvePhoto(data: Record<string, unknown>): string | null {
  return (
    pickStr(
      data.photoURL,
      data.avatar,
      data.userPhotoURL,
      data.photo,
      data.profilePhoto,
    ) || null
  );
}

export async function getFollowingIds(userId: string): Promise<string[]> {
  const db = getDb();
  const snap = await getDocs(collection(db, "users", userId, "following"));
  return snap.docs.map((d) => d.id);
}

export async function getFollowerIds(userId: string): Promise<string[]> {
  const db = getDb();
  const snap = await getDocs(collection(db, "users", userId, "followers"));
  return snap.docs.map((d) => d.id);
}

async function countSubcollection(
  userId: string,
  name: "followers" | "following",
): Promise<number> {
  const db = getDb();
  const ref = collection(db, "users", userId, name);
  try {
    const agg = await getCountFromServer(ref);
    return agg.data().count;
  } catch {
    const snap = await getDocs(ref);
    return snap.size;
  }
}

export async function getFollowersCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    return await countSubcollection(userId, "followers");
  } catch {
    return 0;
  }
}

export async function getFollowingCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    return await countSubcollection(userId, "following");
  } catch {
    return 0;
  }
}

export async function isFollowingUser(
  currentUserId: string,
  targetUserId: string,
): Promise<boolean> {
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    return false;
  }
  try {
    const snap = await getDoc(
      doc(getDb(), "users", currentUserId, "following", targetUserId),
    );
    return snap.exists();
  } catch {
    return false;
  }
}
/** Friends = mutual follows (same as mobile Messenger). */
export async function getFriendIds(userId: string): Promise<string[]> {
  const [following, followers] = await Promise.all([
    getFollowingIds(userId),
    getFollowerIds(userId),
  ]);
  const followerSet = new Set(followers);
  return following.filter((id) => followerSet.has(id));
}

export async function hydrateProfiles(
  userIds: string[],
): Promise<SocialProfile[]> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (!unique.length) return [];

  const db = getDb();
  let liveByHost = new Map<string, string>();
  try {
    const live = await fetchLiveDirectory();
    liveByHost = new Map(
      live
        .filter((c) => c.hostUid)
        .map((c) => [c.hostUid, c.streamId || c.id]),
    );
  } catch {
    /* LIVE badges optional */
  }

  const profiles = await Promise.all(
    unique.map(async (userId) => {
      try {
        const [userSnap, profileSnap] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDoc(doc(db, "userProfiles", userId)),
        ]);
        const data = userSnap.exists()
          ? (userSnap.data() as Record<string, unknown>)
          : {};
        const profile = profileSnap.exists()
          ? (profileSnap.data() as Record<string, unknown>)
          : {};
        const username =
          pickStr(
            data.username,
            data.handle,
            profile.username,
            profile.handle,
            data.displayName,
          ) || userId.slice(0, 8);
        const handle = username.startsWith("@") ? username.slice(1) : username;
        const liveStreamId = liveByHost.get(userId) || null;
        return {
          userId,
          username: handle,
          displayName:
            pickStr(data.displayName, profile.displayName, handle) || handle,
          photoURL: resolvePhoto(data) || resolvePhoto(profile),
          isLive: !!liveStreamId,
          liveStreamId,
        } satisfies SocialProfile;
      } catch {
        return {
          userId,
          username: userId.slice(0, 8),
          displayName: userId.slice(0, 8),
          photoURL: null,
          isLive: false,
          liveStreamId: null,
        } satisfies SocialProfile;
      }
    }),
  );

  return profiles.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    }),
  );
}

export async function followUser(
  idToken: string,
  targetUserId: string,
): Promise<void> {
  const res = await fetch(`${liveServiceUrl}/social/follow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `Follow failed (${res.status})`);
  }
}

export async function unfollowUser(
  idToken: string,
  targetUserId: string,
): Promise<void> {
  const res = await fetch(`${liveServiceUrl}/social/unfollow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `Unfollow failed (${res.status})`);
  }
}
