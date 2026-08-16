"use client";

import { doc, runTransaction } from "firebase/firestore";
import { getDb } from "./firebase";
import { ensureFirebaseFromCognito } from "./firebaseBridge";

function toLikeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** Same math as mobile `computePostLikeNext` / Firestore `canTogglePostLike`. */
export function computePostLikeNext(
  data: Record<string, unknown>,
  userId: string,
): { payload: { likedBy: string[]; likes: number; likeCount: number }; liked: boolean; count: number } {
  const beforeLikes = toLikeInt(data?.likes);
  const beforeLikeCount = Number.isInteger(data?.likeCount)
    ? (data.likeCount as number)
    : beforeLikes;
  const baseline = Math.max(beforeLikes, beforeLikeCount, 0);

  const arr = Array.isArray(data?.likedBy)
    ? (data.likedBy as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const beforeLiked = arr.includes(userId);
  const nextLiked = !beforeLiked;
  const delta = beforeLiked ? -1 : 1;
  const nextCount = Math.max(0, baseline + delta);
  const nextArr = beforeLiked ? arr.filter((x) => x !== userId) : [...arr, userId];

  return {
    payload: { likedBy: nextArr, likes: nextCount, likeCount: nextCount },
    liked: nextLiked,
    count: nextCount,
  };
}

export function isPostLikedBy(
  post: { raw?: Record<string, unknown>; likedBy?: string[] } | null,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  const likedBy =
    post?.likedBy ||
    (Array.isArray(post?.raw?.likedBy) ? (post!.raw!.likedBy as string[]) : []);
  return likedBy.includes(userId);
}

/**
 * Toggle like on `posts/{postId}` — same transaction + fields as mobile LikeService.
 * Requires Firebase Auth uid === Cognito sub (bridge first).
 */
export async function togglePostLike(opts: {
  postId: string;
  userId: string;
  cognitoIdToken: string;
}): Promise<{ ok: true; liked: boolean; count: number } | { ok: false; reason: string }> {
  const { postId, userId, cognitoIdToken } = opts;
  if (!postId || !userId) {
    return { ok: false, reason: "INVALID_ARGS" };
  }

  const bridged = await ensureFirebaseFromCognito({
    cognitoIdToken,
    uid: userId,
  });
  if (!bridged) {
    return { ok: false, reason: "FIREBASE_AUTH_NOT_READY" };
  }

  try {
    const db = getDb();
    const ref = doc(db, "posts", postId);
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("POST_NOT_FOUND");
      const next = computePostLikeNext(
        (snap.data() || {}) as Record<string, unknown>,
        userId,
      );
      tx.update(ref, next.payload);
      return { liked: next.liked, count: next.count };
    });
    return { ok: true, liked: result.liked, count: result.count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof console !== "undefined") {
      console.warn("[likes] togglePostLike failed:", msg);
    }
    return { ok: false, reason: msg || "WRITE_FAILED" };
  }
}
