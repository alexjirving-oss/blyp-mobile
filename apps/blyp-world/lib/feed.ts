import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type FeedPost = {
  id: string;
  userId: string;
  username: string;
  caption: string;
  videoUrl: string | null;
  posterUrl: string | null;
  likes: number;
  type: string;
  raw: Record<string, unknown>;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Prefer progressive / CDN / compressed playback — same order as mobile For You. */
export function resolveFeedVideoUri(post: Record<string, unknown> | null): string | null {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const videoMedia =
    (media as Record<string, unknown>[]).find((m) =>
      String(m?.type || "").includes("video"),
    ) ||
    (media[0] as Record<string, unknown> | undefined) ||
    null;
  const candidates = [
    post.playbackUrl,
    post.hlsUrl,
    post.streamUrl,
    post.cdnUrl,
    post.compressedUrl,
    post.optimizedUrl,
    post.videoUrl,
    post.mediaUrl,
    videoMedia?.playbackUrl,
    videoMedia?.hlsUrl,
    videoMedia?.cdnUrl,
    videoMedia?.compressedUrl,
    videoMedia?.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export function resolvePosterUri(post: Record<string, unknown> | null): string | null {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const first = media[0] as Record<string, unknown> | undefined;
  const candidates = [
    post.thumbnailUrl,
    post.thumbUrl,
    post.posterUrl,
    post.imageUrl,
    post.coverUrl,
    first?.thumbnailUrl,
    first?.thumbUrl,
    first?.poster,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export function isPlayableVideoPost(post: Record<string, unknown> | null): boolean {
  if (!post) return false;
  if (post.moderation && typeof post.moderation === "object") {
    const m = post.moderation as Record<string, unknown>;
    if (m.hidden === true || m.removed === true) return false;
  }
  if (post.isRemoved === true || post.hidden === true) return false;
  const type = String(post.type || "").toLowerCase();
  if (type === "image" || type === "photo" || type === "audio") {
    // Some image docs still carry a video URI — only accept when URI looks like video.
    const uri = resolveFeedVideoUri(post);
    if (!uri) return false;
    if (!/\.(mp4|m3u8|webm|mov)(\?|$)/i.test(uri) && !uri.includes("video")) {
      return type.includes("video");
    }
  }
  const uri = resolveFeedVideoUri(post);
  if (!uri) return false;
  if (
    post.hasAudio === false ||
    post.muted === true ||
    post.isMuted === true ||
    post.silent === true
  ) {
    return false;
  }
  return true;
}

function normalizePost(id: string, data: DocumentData): FeedPost {
  const raw = data as Record<string, unknown>;
  const likesArr = Array.isArray(raw.likedBy) ? raw.likedBy.length : 0;
  const likes = Math.max(
    Number(raw.likes) || 0,
    Number(raw.likeCount) || 0,
    likesArr,
  );
  return {
    id,
    userId: pickStr(raw.userId, raw.uid, raw.authorId),
    username: pickStr(raw.username, raw.userName, raw.authorUsername, "creator"),
    caption: pickStr(raw.caption, raw.description, raw.text),
    videoUrl: resolveFeedVideoUri(raw),
    posterUrl: resolvePosterUri(raw),
    likes,
    type: pickStr(raw.type) || "video",
    raw,
  };
}

export async function fetchForYouPage(opts?: {
  pageSize?: number;
  cursor?: QueryDocumentSnapshot | null;
}): Promise<{
  posts: FeedPost[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}> {
  const pageSize = opts?.pageSize ?? 24;
  const db = getDb();
  const base = collection(db, "posts");
  const q = opts?.cursor
    ? query(
        base,
        orderBy("date", "desc"),
        startAfter(opts.cursor),
        limit(pageSize),
      )
    : query(base, orderBy("date", "desc"), limit(pageSize));

  const snap = await getDocs(q);
  const docs = snap.docs;
  const posts = docs
    .map((d) => normalizePost(d.id, d.data()))
    .filter((p) => !!p.videoUrl && isPlayableVideoPost(p.raw));

  return {
    posts,
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore: docs.length >= pageSize,
  };
}

export async function fetchPostById(id: string): Promise<FeedPost | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, "posts", id));
  if (!snap.exists()) return null;
  return normalizePost(snap.id, snap.data());
}

/** Load enough pages to fill a For You session (videos only). */
export async function fetchForYouFeed(minVideos = 12): Promise<FeedPost[]> {
  const out: FeedPost[] = [];
  const seen = new Set<string>();
  let cursor: QueryDocumentSnapshot | null = null;
  let hasMore = true;
  let guard = 0;
  while (out.length < minVideos && hasMore && guard < 6) {
    guard += 1;
    const page = await fetchForYouPage({ pageSize: 30, cursor });
    cursor = page.cursor;
    hasMore = page.hasMore;
    for (const p of page.posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    if (!page.posts.length && !hasMore) break;
  }
  return out;
}
