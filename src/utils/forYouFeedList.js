// forYouFeedList.js
// Pure helpers for the Home For You continuum: hard id dedupe, focus-pin survival,
// inventory stats, and preferred playback URI (CDN / compressed when present).

import { fixStorageUrl } from './urlUtils';

/** First-occurrence wins. Empty / missing ids are dropped. */
export function dedupePostsById(posts) {
  const seen = new Set();
  const out = [];
  for (const p of posts || []) {
    const id = p?.id != null ? String(p.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

/** Stable FlatList keys across soft re-ranks; cycle bumps only on hard refresh. */
export function stampFeedKeys(posts, cycle) {
  return (posts || []).map((p) => ({
    ...p,
    feedKey: `${p.id}__${cycle}`,
  }));
}

/**
 * Keep a Home-rail / deep-link focus post alive across list rebuilds.
 * If the id is already present, order is preserved (caller scrolls to index).
 * If missing and `post` is eligible, inject at the front.
 */
export function ensureFocusPostInList(
  posts,
  { postId, post, cycle = 0, isEligible } = {},
) {
  const list = dedupePostsById(posts);
  const id = postId != null ? String(postId) : '';
  if (!id) return stampFeedKeys(list, cycle);

  const idx = list.findIndex((p) => p && String(p.id) === id);
  if (idx >= 0) return stampFeedKeys(list, cycle);

  if (post && typeof isEligible === 'function' && !isEligible(post)) {
    return stampFeedKeys(list, cycle);
  }
  if (post && post.id != null) {
    const { feedKey: _fk, ...rest } = post;
    const restId = String(rest.id);
    return stampFeedKeys(
      [rest, ...list.filter((p) => p && String(p.id) !== restId)],
      cycle,
    );
  }
  return stampFeedKeys(list, cycle);
}

/**
 * Prefer progressive / CDN / compressed playback when the post document carries
 * one; fall back to the raw Firebase Storage videoUrl.
 */
export function resolveFeedVideoUri(post) {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const videoMedia =
    media.find((m) => String(m?.type || '').includes('video')) || media[0] || null;
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
    if (typeof c !== 'string') continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    return fixStorageUrl(trimmed) || trimmed;
  }
  return null;
}

/** Live list shape vs repeats — useful for diagnosing low-inventory loops. */
export function feedInventoryStats(posts) {
  const list = Array.isArray(posts) ? posts : [];
  const ids = new Set();
  const owners = new Set();
  let duplicates = 0;
  for (const p of list) {
    const id = p?.id != null ? String(p.id) : '';
    if (!id) continue;
    if (ids.has(id)) duplicates += 1;
    else ids.add(id);
    const owner = String(p?.userId || p?.uid || p?.authorId || '').trim();
    if (owner) owners.add(owner);
  }
  return {
    total: list.length,
    unique: ids.size,
    duplicates,
    creators: owners.size,
  };
}
