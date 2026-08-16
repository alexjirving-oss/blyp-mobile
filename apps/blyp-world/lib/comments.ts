"use client";

import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { ensureFirebaseFromCognito } from "./firebaseBridge";

export type PostComment = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
  likes: number;
  likedBy: string[];
  parentId: string | null;
  createdAt: number;
};

function toMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    try {
      return Number((value as { toMillis: () => number }).toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const s = Number((value as { seconds: number }).seconds);
    return Number.isFinite(s) ? s * 1000 : 0;
  }
  return 0;
}

function normalizeComment(
  id: string,
  data: Record<string, unknown>,
): PostComment {
  return {
    id,
    userId: String(data.userId || data.uid || ""),
    username: String(data.username || data.displayName || "User"),
    avatar: String(
      data.avatar ||
        data.photoURL ||
        data.profilePicture ||
        data.userPhoto ||
        data.photoUrl ||
        "",
    ),
    text: String(data.text || ""),
    likes: Number(data.likes || 0) || 0,
    likedBy: Array.isArray(data.likedBy)
      ? (data.likedBy as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    parentId:
      typeof data.parentId === "string" && data.parentId ? data.parentId : null,
    createdAt: toMillis(data.createdAt),
  };
}

/** Live list of `posts/{postId}/comments` — same path as mobile CommentsModal. */
export function subscribePostComments(
  postId: string,
  onData: (comments: PostComment[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const db = getDb();
  const q = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const next = snap.docs.map((d) =>
        normalizeComment(d.id, (d.data() || {}) as Record<string, unknown>),
      );
      onData(next);
    },
    (err) => {
      onError?.(err?.message || "Unable to load comments");
    },
  );
}

export async function addPostComment(opts: {
  postId: string;
  userId: string;
  cognitoIdToken: string;
  username: string;
  avatar?: string | null;
  text: string;
  parentId?: string | null;
}): Promise<PostComment> {
  const text = opts.text.trim();
  if (!text) throw new Error("Comment is empty");
  if (!opts.postId || !opts.userId) throw new Error("Missing post or user");

  const bridged = await ensureFirebaseFromCognito({
    cognitoIdToken: opts.cognitoIdToken,
    uid: opts.userId,
  });
  if (!bridged) {
    throw new Error("Firebase auth not ready — try logging in again");
  }

  const createdAt = Date.now();
  const displayName = opts.username.trim() || "User";
  const avatar = opts.avatar || null;

  const db = getDb();
  const ref = await addDoc(collection(db, "posts", opts.postId, "comments"), {
    userId: opts.userId,
    username: displayName,
    displayName,
    avatar,
    photoURL: avatar,
    text,
    createdAt,
    likes: 0,
    likedBy: [],
    parentId: opts.parentId || null,
  });

  return {
    id: ref.id,
    userId: opts.userId,
    username: displayName,
    avatar: avatar || "",
    text,
    likes: 0,
    likedBy: [],
    parentId: opts.parentId || null,
    createdAt,
  };
}

export function formatCommentTime(createdAt: number): string {
  if (!createdAt) return "";
  const sec = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / 604800)}w`;
}
