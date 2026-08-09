// forYouFeedList.js
// Pure helpers for the Home For You continuum: hard id dedupe, focus-pin survival,
// inventory stats, preferred playback URI, and a simple reload shuffle.

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

/** In-memory head from the last shuffle (process lifetime). */
let lastFeedHeadIds = [];

export function getLastFeedHeadIds() {
  return lastFeedHeadIds.slice();
}

export function rememberFeedHead(posts, count = 3) {
  const n = Math.max(0, Number(count) || 0);
  lastFeedHeadIds = (posts || [])
    .slice(0, n)
    .map((p) => (p?.id != null ? String(p.id) : ''))
    .filter(Boolean);
  return lastFeedHeadIds.slice();
}

/** Test-only reset for the in-memory head. */
export function resetLastFeedHeadIds() {
  lastFeedHeadIds = [];
}

/**
 * Fisher–Yates shuffle. Pass `random` for deterministic tests.
 * @template T
 * @param {T[]} items
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function shuffleArray(items, random = Math.random) {
  const next = [...(items || [])];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

/**
 * Apply a cold-open boot-widen list without yanking a mid-swipe viewer.
 *
 * Full reshuffle/replace is only safe while still on the provisional head
 * (discover index 0, no focus pin, head id unchanged). After the user leaves
 * index 0, keep the playing prefix and append unseen boot posts to the tail.
 *
 * @param {{
 *   currentList?: any[],
 *   widenedList?: any[],
 *   discoverIndex?: number,
 *   focusPinned?: boolean,
 *   provisionalHeadId?: string|null,
 * }} [opts]
 * @returns {{ mode: 'replace'|'append'|'skip', list: any[]|null }}
 */
export function resolveForYouBootWidenApply({
  currentList,
  widenedList,
  discoverIndex = 0,
  focusPinned = false,
  provisionalHeadId = null,
} = {}) {
  if (focusPinned) {
    return { mode: 'skip', list: null };
  }

  const current = Array.isArray(currentList) ? currentList : [];
  const widened = Array.isArray(widenedList) ? widenedList : [];
  if (!widened.length) {
    return { mode: 'skip', list: null };
  }

  const atHead = Number(discoverIndex) === 0;
  const liveHeadId = current[0]?.id != null ? String(current[0].id) : '';
  const expectedHead =
    provisionalHeadId != null && String(provisionalHeadId)
      ? String(provisionalHeadId)
      : '';
  const headUnchanged = !expectedHead || liveHeadId === expectedHead;

  // Cold open still at head: keep shuffle-on-reload variety.
  if (atHead && headUnchanged) {
    return { mode: 'replace', list: widened };
  }

  if (!current.length) {
    return { mode: 'replace', list: widened };
  }

  // Mid-swipe: never reshuffle under the finger — only widen the unseen tail.
  const seen = new Set(
    current
      .map((p) => (p?.id != null ? String(p.id) : ''))
      .filter(Boolean),
  );
  const tail = widened.filter((p) => p?.id != null && !seen.has(String(p.id)));
  if (!tail.length) {
    return { mode: 'skip', list: null };
  }
  return { mode: 'append', list: [...current, ...tail] };
}

/**
 * Shuffle feed candidates for a cold open / pull-refresh / rail rematch.
 * Light rule only: previous session's first N go after everything else when
 * the pool still has other clips (nothing elaborate).
 *
 * @param {any[]} posts
 * @param {{
 *   avoidFirstIds?: string[]|Set<string>,
 *   avoidCount?: number,
 *   random?: () => number,
 *   remember?: boolean,
 * }} [opts]
 */
export function shufflePostsVaried(posts, opts = {}) {
  const list = dedupePostsById(posts);
  if (list.length <= 1) {
    if (opts.remember !== false) rememberFeedHead(list, opts.avoidCount ?? 3);
    return list;
  }

  const random = typeof opts.random === 'function' ? opts.random : Math.random;
  const avoidCount = Math.max(0, Number.isFinite(opts.avoidCount) ? opts.avoidCount : 3);
  const rawAvoid = opts.avoidFirstIds instanceof Set
    ? [...opts.avoidFirstIds]
    : (opts.avoidFirstIds || getLastFeedHeadIds());
  const avoid = new Set(
    rawAvoid
      .map((id) => String(id || ''))
      .filter(Boolean)
      .slice(0, avoidCount || undefined),
  );

  let ordered;
  if (avoid.size === 0) {
    ordered = shuffleArray(list, random);
  } else {
    const fresh = [];
    const recent = [];
    for (const post of list) {
      if (avoid.has(String(post.id))) recent.push(post);
      else fresh.push(post);
    }
    // Tiny catalog: if every candidate was in the last head, just reshuffle.
    ordered = fresh.length === 0
      ? shuffleArray(list, random)
      : [...shuffleArray(fresh, random), ...shuffleArray(recent, random)];
  }

  if (opts.remember !== false) {
    rememberFeedHead(ordered, avoidCount || 3);
  }
  return ordered;
}
