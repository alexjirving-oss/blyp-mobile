"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { ensureFirebaseFromCognito } from "./firebaseBridge";

export type ActivityItem = {
  id: string;
  type: "follow" | "comment" | "like" | "notification";
  actorId: string;
  username: string;
  avatar?: string | null;
  text?: string;
  postKind?: "video" | "post";
  inTopCircle?: boolean;
  inFollowing?: boolean;
  ts: number;
};

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof (v as { toMillis?: () => number }).toMillis === "function") {
    const n = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof (v as { seconds?: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function looksLikeRawId(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return true;
  }
  if (t.length > 20 && /^[A-Za-z0-9_-]+$/.test(t)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  return false;
}

function pickLabel(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      const t = v.trim().startsWith("@") ? v.trim().slice(1) : v.trim();
      if (t && !looksLikeRawId(t)) return t;
    }
  }
  return "";
}

function pickAvatar(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  for (const key of ["photoURL", "avatar", "profilePicture", "userPhotoURL"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function postKind(post: Record<string, unknown>): "video" | "post" {
  if (
    post.type === "video" ||
    typeof post.videoUrl === "string" ||
    (Array.isArray(post.media) &&
      (post.media[0] as { type?: string } | undefined)?.type === "video")
  ) {
    return "video";
  }
  return "post";
}

const profileCache = new Map<
  string,
  { username: string; avatar: string | null }
>();

async function getProfile(actorId: string): Promise<{
  username: string;
  avatar: string | null;
}> {
  if (profileCache.has(actorId)) return profileCache.get(actorId)!;
  try {
    const snap = await getDoc(doc(getDb(), "users", actorId));
    const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
    const profile = {
      username:
        pickLabel(d.username, d.handle, d.displayName, d.name) || "Someone",
      avatar: pickAvatar(d),
    };
    profileCache.set(actorId, profile);
    return profile;
  } catch {
    const fallback = { username: "Someone", avatar: null };
    profileCache.set(actorId, fallback);
    return fallback;
  }
}

async function getCircleContext(uid: string): Promise<{
  topCircle: Set<string>;
  following: Set<string>;
}> {
  const topCircle = new Set<string>();
  const following = new Set<string>();
  try {
    const snap = await getDoc(doc(getDb(), "users", uid));
    const stage = (snap.exists() ? snap.data() : {})?.stage as
      | { topCircle?: unknown }
      | undefined;
    const ids = Array.isArray(stage?.topCircle) ? stage!.topCircle! : [];
    for (const id of ids) {
      if (typeof id === "string" && id.trim()) topCircle.add(id.trim());
    }
  } catch {
    /* ignore */
  }
  try {
    const snap = await getDocs(
      query(collection(getDb(), "users", uid, "following"), limit(200)),
    );
    for (const d of snap.docs) following.add(d.id);
  } catch {
    /* ignore */
  }
  return { topCircle, following };
}

/** Same unread math as mobile `activityService.countUnread`. */
export function countUnread(
  items: ActivityItem[],
  lastSeenAt = 0,
): number {
  return (items || []).filter((i) => (i.ts || 0) > (lastSeenAt || 0)).length;
}

/** Prefs live at `users/{uid}.blyp.prefs.lastSeenActivityAt` (mobile). */
export async function getLastSeenActivityAt(uid: string): Promise<number> {
  if (!uid) return 0;
  try {
    const snap = await getDoc(doc(getDb(), "users", uid));
    if (!snap.exists()) return 0;
    const prefs = (snap.data() as { blyp?: { prefs?: { lastSeenActivityAt?: unknown } } })
      ?.blyp?.prefs;
    return Number(prefs?.lastSeenActivityAt) || 0;
  } catch {
    return 0;
  }
}

export async function setActivitySeen(opts: {
  uid: string;
  cognitoIdToken: string;
}): Promise<void> {
  const { uid, cognitoIdToken } = opts;
  if (!uid) return;
  await ensureFirebaseFromCognito({ cognitoIdToken, uid });
  const now = Date.now();
  await setDoc(
    doc(getDb(), "users", uid),
    { blyp: { prefs: { lastSeenActivityAt: now, updatedAt: now } } },
    { merge: true },
  );
}

/**
 * Bounded activity feed — same sources as mobile Activity:
 * new followers + comments/likes on my posts. Best-effort; never throws.
 * Resolves actor photoURL for circular avatars; ranks Top Circle / following first.
 */
export async function getActivity(uid: string): Promise<ActivityItem[]> {
  if (!uid) return [];
  const db = getDb();
  const items: ActivityItem[] = [];
  const ctx = await getCircleContext(uid);

  try {
    let followSnap;
    try {
      followSnap = await getDocs(
        query(
          collection(db, "users", uid, "followers"),
          orderBy("timestamp", "desc"),
          limit(20),
        ),
      );
    } catch {
      followSnap = await getDocs(
        query(collection(db, "users", uid, "followers"), limit(20)),
      );
    }
    for (const d of followSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      const actorId = String(data.userId || d.id);
      const profile = await getProfile(actorId);
      const username =
        pickLabel(data.username, data.displayName, data.handle) ||
        profile.username;
      items.push({
        id: `follow_${actorId}`,
        type: "follow",
        actorId,
        username,
        avatar: pickAvatar(data) || profile.avatar,
        text: "started following you",
        inTopCircle: ctx.topCircle.has(actorId),
        inFollowing: ctx.following.has(actorId),
        ts: toMillis(data.timestamp),
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const postsSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("userId", "==", uid),
        orderBy("date", "desc"),
        limit(8),
      ),
    );
    for (const postDoc of postsSnap.docs) {
      const post = postDoc.data() as Record<string, unknown>;
      const kind = postKind(post);
      try {
        const cSnap = await getDocs(
          query(
            collection(db, "posts", postDoc.id, "comments"),
            orderBy("createdAt", "desc"),
            limit(4),
          ),
        );
        for (const c of cSnap.docs) {
          const cd = c.data() as Record<string, unknown>;
          const actorId = String(cd.userId || cd.uid || "");
          if (!actorId || actorId === uid) continue;
          const profile = await getProfile(actorId);
          items.push({
            id: `comment_${c.id}`,
            type: "comment",
            actorId,
            username:
              pickLabel(cd.username, cd.displayName, cd.handle) ||
              profile.username,
            avatar: pickAvatar(cd) || profile.avatar,
            text: String(cd.text || "").trim() || `commented on your ${kind}`,
            postKind: kind,
            inTopCircle: ctx.topCircle.has(actorId),
            inFollowing: ctx.following.has(actorId),
            ts: toMillis(cd.createdAt) || toMillis(post.date),
          });
        }
      } catch {
        /* per-post best-effort */
      }

      const likedBy = Array.isArray(post.likedBy)
        ? (post.likedBy as string[])
        : [];
      for (const likerId of likedBy.slice(-6).reverse()) {
        if (!likerId || likerId === uid) continue;
        if (items.some((i) => i.id === `like_${postDoc.id}_${likerId}`)) continue;
        const profile = await getProfile(likerId);
        items.push({
          id: `like_${postDoc.id}_${likerId}`,
          type: "like",
          actorId: likerId,
          username: profile.username,
          avatar: profile.avatar,
          text: `liked your ${kind}`,
          postKind: kind,
          inTopCircle: ctx.topCircle.has(likerId),
          inFollowing: ctx.following.has(likerId),
          ts: toMillis(post.date),
        });
        if (items.filter((i) => i.type === "like").length >= 14) break;
      }
    }
  } catch {
    /* ignore */
  }

  return items
    .sort((a, b) => {
      const rank = (x: ActivityItem) =>
        x.inTopCircle ? 2 : x.inFollowing ? 1 : 0;
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      return (b.ts || 0) - (a.ts || 0);
    })
    .slice(0, 60);
}

/** Unread activity count for nav badge (mobile HomeBase parity). */
export async function getUnreadActivityCount(uid: string): Promise<number> {
  if (!uid) return 0;
  try {
    const [items, lastSeen] = await Promise.all([
      getActivity(uid),
      getLastSeenActivityAt(uid),
    ]);
    return countUnread(items, lastSeen);
  } catch {
    return 0;
  }
}
