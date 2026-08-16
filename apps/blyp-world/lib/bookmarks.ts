"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { ensureFirebaseFromCognito } from "./firebaseBridge";
import type { FeedPost } from "./feed";

export type BookmarkItem = {
  id: string;
  title: string;
  thumbnail: string | null;
  videoUrl: string | null;
  type: string;
  username: string | null;
  savedAt: number;
};

const MAX_BOOKMARKS = 300;

function dedupeById(list: BookmarkItem[]): BookmarkItem[] {
  const seen = new Set<string>();
  const out: BookmarkItem[] = [];
  for (const b of list) {
    if (!b?.id || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, MAX_BOOKMARKS);
}

function compact(post: FeedPost): BookmarkItem | null {
  if (!post?.id) return null;
  return {
    id: post.id,
    title: post.caption || "Post",
    thumbnail: post.posterUrl || null,
    videoUrl: post.videoUrl || null,
    type: post.type || (post.videoUrl ? "video" : "post"),
    username: post.username || null,
    savedAt: Date.now(),
  };
}

/** Same field as mobile `bookmarkService`: `users/{uid}.blyp.bookmarks`. */
export async function getBookmarks(uid: string): Promise<BookmarkItem[]> {
  if (!uid) return [];
  try {
    const snap = await getDoc(doc(getDb(), "users", uid));
    const remote = snap.exists()
      ? (snap.data() as { blyp?: { bookmarks?: unknown } })?.blyp?.bookmarks
      : null;
    if (!Array.isArray(remote)) return [];
    return dedupeById(
      remote.filter(
        (b): b is BookmarkItem =>
          !!b && typeof b === "object" && typeof (b as BookmarkItem).id === "string",
      ),
    );
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn(
        "[bookmarks] getBookmarks failed:",
        e instanceof Error ? e.message : e,
      );
    }
    return [];
  }
}

export async function isPostBookmarked(
  uid: string,
  postId: string,
): Promise<boolean> {
  if (!uid || !postId) return false;
  const list = await getBookmarks(uid);
  return list.some((b) => b.id === postId);
}

/**
 * Toggle save — same merge shape as mobile (`users/{uid}` → `blyp.bookmarks`).
 * Requires Cognito→Firebase bridge so security rules allow the write.
 */
export async function togglePostBookmark(opts: {
  uid: string;
  cognitoIdToken: string;
  post: FeedPost;
}): Promise<
  { ok: true; saved: boolean } | { ok: false; reason: string }
> {
  const { uid, cognitoIdToken, post } = opts;
  const item = compact(post);
  if (!uid || !item) return { ok: false, reason: "INVALID_ARGS" };

  const bridged = await ensureFirebaseFromCognito({
    cognitoIdToken,
    uid,
  });
  if (!bridged) return { ok: false, reason: "FIREBASE_AUTH_NOT_READY" };

  try {
    const list = await getBookmarks(uid);
    const exists = list.some((b) => b.id === item.id);
    const next = exists
      ? list.filter((b) => b.id !== item.id)
      : dedupeById([item, ...list]);
    await setDoc(
      doc(getDb(), "users", uid),
      { blyp: { bookmarks: next } },
      { merge: true },
    );
    return { ok: true, saved: !exists };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof console !== "undefined") {
      console.warn("[bookmarks] toggle failed:", msg);
    }
    return { ok: false, reason: msg || "WRITE_FAILED" };
  }
}
