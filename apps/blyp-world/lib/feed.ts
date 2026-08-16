import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type FeedPost = {
  id: string;
  userId: string;
  username: string;
  photoURL: string | null;
  caption: string;
  title: string;
  videoUrl: string | null;
  posterUrl: string | null;
  likes: number;
  views: number;
  comments?: number;
  type: string;
  raw: Record<string, unknown>;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Prefer real handles over Cognito email aliases (e.g. melzie1980@yahoo.com). */
export function pickPublicHandle(...vals: unknown[]): string {
  const candidates: string[] = [];
  for (const v of vals) {
    const raw = pickStr(v);
    if (!raw) continue;
    const handle = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!handle) continue;
    candidates.push(handle);
    if (!looksLikeEmail(handle)) return handle;
  }
  const email = candidates.find((c) => looksLikeEmail(c));
  if (email) {
    const local = email.split("@")[0] || "";
    if (local) return local;
  }
  return "creator";
}

function resolveCreatorPhoto(raw: Record<string, unknown>): string | null {
  const user =
    raw.user && typeof raw.user === "object"
      ? (raw.user as Record<string, unknown>)
      : null;
  return (
    pickStr(
      raw.userPhotoURL,
      raw.photoURL,
      raw.avatarUrl,
      raw.avatar,
      raw.profilePicture,
      user?.photoURL,
      user?.avatar,
      user?.profilePicture,
    ) || null
  );
}

/** True for HLS manifests / playlist URLs (not progressive MP4). */
export function isHlsVideoUri(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== "string") return false;
  const u = uri.trim().toLowerCase();
  if (!u) return false;
  if (u.includes(".m3u8")) return true;
  if (u.includes("application/vnd.apple.mpegurl")) return true;
  if (/\/hls\/|\/hls-|format=m3u8|type=m3u8/.test(u)) return true;
  return false;
}

/**
 * Prefer progressive / CDN / compressed MP4 — same order as tip mobile For You.
 * HLS is last-resort only.
 */
export function pickProgressiveFeedVideoUri(
  candidates: unknown[],
): string | null {
  let hlsFallback: string | null = null;
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (isHlsVideoUri(trimmed)) {
      if (!hlsFallback) hlsFallback = trimmed;
      continue;
    }
    return trimmed;
  }
  return hlsFallback;
}

/** Prefer progressive / CDN / compressed playback — same order as mobile For You. */
export function resolveFeedVideoUri(
  post: Record<string, unknown> | null,
): string | null {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const videoMedia =
    (media as Record<string, unknown>[]).find((m) =>
      String(m?.type || "").includes("video"),
    ) ||
    (media[0] as Record<string, unknown> | undefined) ||
    null;
  return pickProgressiveFeedVideoUri([
    post.playbackUrl,
    post.cdnUrl,
    post.compressedUrl,
    post.optimizedUrl,
    post.videoUrl,
    post.mediaUrl,
    post.streamUrl,
    videoMedia?.playbackUrl,
    videoMedia?.cdnUrl,
    videoMedia?.compressedUrl,
    videoMedia?.url,
    // HLS last (only if nothing progressive exists).
    post.hlsUrl,
    videoMedia?.hlsUrl,
  ]);
}

export function resolvePosterUri(
  post: Record<string, unknown> | null,
): string | null {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const first = media[0] as Record<string, unknown> | undefined;
  const candidates = [
    post.thumbnailUrl,
    post.thumbnail,
    post.thumbUrl,
    post.posterUrl,
    post.previewUrl,
    post.snapshotUrl,
    post.coverImage,
    post.imageUrl,
    post.coverUrl,
    first?.thumbnailUrl,
    first?.thumbnail,
    first?.thumbUrl,
    first?.poster,
    first?.posterUrl,
    first?.previewUrl,
    // Image media URL only — never use a video file as a poster tile.
    first?.type && String(first.type).includes("image") ? first?.url : null,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    // Reject video/hls URLs that would render as a black tile.
    if (isHlsVideoUri(trimmed)) continue;
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

/** Match mobile `isVideoWithSoundPost` / `isForYouFeedPost`. */
export function isPlayableVideoPost(
  post: Record<string, unknown> | null,
): boolean {
  if (!post) return false;
  if (post.moderation && typeof post.moderation === "object") {
    const m = post.moderation as Record<string, unknown>;
    if (m.hidden === true || m.removed === true) return false;
  }
  if (post.isRemoved === true || post.hidden === true) return false;

  const type = String(post.type || "").toLowerCase();
  if (type === "image" || type === "photo" || type === "audio") return false;
  if (post.imageUrl && !post.videoUrl && !resolveFeedVideoUri(post)) return false;

  const uri = resolveFeedVideoUri(post);
  if (!uri) return false;

  // Reject obvious image files leaking into video fields.
  if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(uri) && !isHlsVideoUri(uri)) {
    return false;
  }

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
  const comments = Math.max(
    Number(raw.comments) || 0,
    Number(raw.commentCount) || 0,
    Array.isArray(raw.commentIds) ? raw.commentIds.length : 0,
  );
  const caption = pickStr(raw.caption, raw.description, raw.text);
  const title = pickStr(raw.title, raw.name, caption);
  const views = Math.max(
    Number(raw.views) || 0,
    Number(raw.viewCount) || 0,
    Number(raw.playCount) || 0,
    Number(raw.plays) || 0,
  );
  return {
    id,
    userId: pickStr(raw.userId, raw.uid, raw.authorId),
    username: pickPublicHandle(
      raw.username,
      raw.userName,
      raw.handle,
      raw.authorUsername,
      raw.displayName,
      (raw.user as Record<string, unknown> | undefined)?.username,
      (raw.user as Record<string, unknown> | undefined)?.handle,
      (raw.user as Record<string, unknown> | undefined)?.displayName,
    ),
    photoURL: resolveCreatorPhoto(raw),
    caption,
    title,
    videoUrl: resolveFeedVideoUri(raw),
    posterUrl: resolvePosterUri(raw),
    likes,
    views,
    comments,
    type: pickStr(raw.type) || "video",
    raw,
  };
}

function fisherYates<T>(arr: T[]): T[] {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

/**
 * Light variety pass: shuffle, then spread same-creator repeats.
 * (Web can't run full mobile promote/account ranking; this avoids stale dumps.)
 */
export function shuffleFeedVariety(posts: FeedPost[]): FeedPost[] {
  const shuffled = fisherYates(posts);
  if (shuffled.length < 3) return shuffled;

  const out: FeedPost[] = [];
  const rest = [...shuffled];
  while (rest.length) {
    let pick = 0;
    if (out.length) {
      const lastOwner = out[out.length - 1]?.userId;
      const alt = rest.findIndex((p) => p.userId && p.userId !== lastOwner);
      if (alt >= 0) pick = alt;
    }
    out.push(rest.splice(pick, 1)[0]!);
  }
  return out;
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
    cursor: docs.length ? docs[docs.length - 1]! : null,
    hasMore: docs.length >= pageSize,
  };
}

export async function fetchPostById(id: string): Promise<FeedPost | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, "posts", id));
  if (!snap.exists()) return null;
  const post = normalizePost(snap.id, snap.data());
  if (!post.videoUrl || !isPlayableVideoPost(post.raw)) return null;
  return post;
}

/** Profile / Stage grid — posts by owner, newest first (parity with mobile UserProfile). */
export async function fetchPostsByUserId(
  userId: string,
  pageSize = 48,
): Promise<FeedPost[]> {
  if (!userId) return [];
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, "posts"),
        where("userId", "==", userId),
        orderBy("date", "desc"),
        limit(pageSize),
      ),
    );
    return snap.docs
      .map((d) => normalizePost(d.id, d.data()))
      .filter((p) => {
        if (p.raw.moderation && typeof p.raw.moderation === "object") {
          const m = p.raw.moderation as Record<string, unknown>;
          if (m.hidden === true || m.removed === true) return false;
        }
        if (p.raw.isRemoved === true || p.raw.hidden === true) return false;
        return true;
      });
  } catch (e) {
    // Fallback without composite index: scan recent and filter client-side.
    try {
      const snap = await getDocs(
        query(collection(db, "posts"), orderBy("date", "desc"), limit(200)),
      );
      return snap.docs
        .map((d) => normalizePost(d.id, d.data()))
        .filter((p) => p.userId === userId)
        .slice(0, pageSize);
    } catch {
      if (typeof console !== "undefined") {
        console.warn(
          "[feed] fetchPostsByUserId failed:",
          e instanceof Error ? e.message : e,
        );
      }
      return [];
    }
  }
}

/** Load enough pages to fill a For You session (videos only), then shuffle. */
export async function fetchForYouFeed(minVideos = 24): Promise<FeedPost[]> {
  const out: FeedPost[] = [];
  const seen = new Set<string>();
  let cursor: QueryDocumentSnapshot | null = null;
  let hasMore = true;
  let guard = 0;
  while (out.length < minVideos && hasMore && guard < 8) {
    guard += 1;
    const page = await fetchForYouPage({ pageSize: 40, cursor });
    cursor = page.cursor;
    hasMore = page.hasMore;
    for (const p of page.posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    if (!page.posts.length && !hasMore) break;
  }
  return shuffleFeedVariety(out);
}

function engagementScore(post: FeedPost): number {
  const likes = post.likes || 0;
  const comments = post.comments || 0;
  const views = Math.max(
    Number(post.raw.viewCount) || 0,
    Number(post.raw.views) || 0,
    Number(post.raw.playCount) || 0,
  );
  const shares = Number(post.raw.shares) || 0;
  return likes * 2 + comments + views * 0.1 + shares * 3;
}

/** Recent posts ranked by engagement — same scan pattern as mobile discovery. */
export async function fetchExplorePosts(limitCount = 48): Promise<FeedPost[]> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, "posts"), orderBy("date", "desc"), limit(100)),
  );
  const posts = snap.docs
    .map((d) => normalizePost(d.id, d.data()))
    .filter((p) => !!p.videoUrl && isPlayableVideoPost(p.raw));
  return posts
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, limitCount);
}

/**
 * Following feed: scan recent posts, keep authors in following set.
 * Matches mobile `getFollowingPosts` (no Firestore `in` query).
 */
export async function fetchFollowingPosts(
  ownerIds: string[],
  limitCount = 40,
): Promise<FeedPost[]> {
  const owners = new Set(ownerIds.filter(Boolean));
  if (!owners.size) return [];
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, "posts"), orderBy("date", "desc"), limit(150)),
  );
  return snap.docs
    .map((d) => normalizePost(d.id, d.data()))
    .filter(
      (p) =>
        owners.has(p.userId) &&
        !!p.videoUrl &&
        isPlayableVideoPost(p.raw),
    )
    .slice(0, limitCount);
}
