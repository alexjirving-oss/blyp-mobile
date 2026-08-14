// forYouFeedList.js
// Pure helpers for the Home For You continuum: hard id dedupe, focus-pin survival,
// inventory stats, preferred playback URI, and a simple reload shuffle.

import { pickProgressiveFeedVideoUri } from './feedVideoUri';

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
 * Prefer progressive / CDN / compressed MP4 when the post document carries one.
 * HLS (hlsUrl / .m3u8) is last — feed disk cache + expo-av expect a file, not a playlist.
 */
export function resolveFeedVideoUri(post) {
  if (!post) return null;
  const media = Array.isArray(post.media) ? post.media : [];
  const videoMedia =
    media.find((m) => String(m?.type || '').includes('video')) || media[0] || null;
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
    // HLS last (and only if nothing progressive exists).
    post.hlsUrl,
    videoMedia?.hlsUrl,
  ]);
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
 * How many recently-seen / prior-head ids to push to the back of a shuffle.
 * Scales with pool size so larger catalogs rotate harder than a fixed "3".
 */
export function varietyAvoidCount(poolSize, explicit) {
  if (Number.isFinite(explicit) && explicit >= 0) return Math.trunc(explicit);
  const n = Math.max(0, Number(poolSize) || 0);
  if (n <= 1) return 0;
  // Prefer ~65% of the pool as "already seen / prior head" when possible,
  // but leave at least one clip eligible to lead.
  return Math.min(Math.max(3, Math.floor(n * 0.65)), n - 1);
}

/**
 * Keep ranked relative order, but push recently-seen / prior-head ids off the
 * front so refresh / reopen does not restart on the same clips.
 *
 * @param {any[]} posts
 * @param {{
 *   avoidFirstIds?: string[]|Set<string>,
 *   avoidCount?: number,
 *   remember?: boolean,
 * }} [opts]
 */
export function demoteAvoidedPosts(posts, opts = {}) {
  const list = dedupePostsById(posts);
  if (list.length <= 1) {
    if (opts.remember !== false) rememberFeedHead(list, opts.avoidCount ?? 3);
    return list;
  }
  const avoidCount = varietyAvoidCount(list.length, opts.avoidCount);
  const rawAvoid = opts.avoidFirstIds instanceof Set
    ? [...opts.avoidFirstIds]
    : (opts.avoidFirstIds || getLastFeedHeadIds());
  const avoidSlice = avoidCount > 0
    ? rawAvoid.map((id) => String(id || '')).filter(Boolean).slice(-avoidCount)
    : [];
  const avoid = new Set(avoidSlice);
  if (!avoid.size) {
    if (opts.remember !== false) rememberFeedHead(list, Math.min(3, avoidCount || 3));
    return list;
  }
  const fresh = [];
  const recent = [];
  for (const post of list) {
    if (avoid.has(String(post.id))) recent.push(post);
    else fresh.push(post);
  }
  const ordered = fresh.length ? [...fresh, ...recent] : list;
  if (opts.remember !== false) {
    rememberFeedHead(ordered, Math.min(3, avoidCount || 3));
  }
  return ordered;
}

/**
 * Shuffle feed candidates for a cold open / pull-refresh / rail rematch /
 * page append. Prefer unseen (or less-recently-seen) clips before repeating
 * the prior head / impression window.
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
  const avoidCount = varietyAvoidCount(list.length, opts.avoidCount);
  const rawAvoid = opts.avoidFirstIds instanceof Set
    ? [...opts.avoidFirstIds]
    : (opts.avoidFirstIds || getLastFeedHeadIds());
  // Prefer the *most recent* impressions when the avoid window is smaller than
  // the full seen history (slice from the end of an order array).
  const normalizedAvoid = rawAvoid
    .map((id) => String(id || ''))
    .filter(Boolean);
  const avoidSlice = avoidCount > 0
    ? normalizedAvoid.slice(-avoidCount)
    : [];
  const avoid = new Set(avoidSlice);

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
    // Tiny catalog: if every candidate was in the avoid window, just reshuffle
    // so the next cycle is not an identical loop of the prior order.
    ordered = fresh.length === 0
      ? shuffleArray(list, random)
      : [...shuffleArray(fresh, random), ...shuffleArray(recent, random)];
  }

  if (opts.remember !== false) {
    rememberFeedHead(ordered, Math.min(3, avoidCount || 3));
  }
  return ordered;
}

/**
 * After the unique corpus is exhausted, build a reshuffled continuation stamped
 * with a new cycle so FlatList keys (`id__cycle`) differ from the prior pass.
 * Prefer less-recently-seen clips at the front — never re-emit the same order.
 *
 * @param {any[]} posts
 * @param {{
 *   cycle?: number,
 *   recentlySeenIds?: string[]|Set<string>,
 *   random?: () => number,
 * }} [opts]
 */
export function buildCycleContinuation(posts, opts = {}) {
  const unique = dedupePostsById(posts);
  if (!unique.length) return [];
  const cycle = Number.isFinite(opts.cycle) ? Math.trunc(opts.cycle) : 0;
  const ordered = shufflePostsVaried(unique, {
    avoidFirstIds: opts.recentlySeenIds,
    avoidCount: varietyAvoidCount(unique.length),
    random: opts.random,
    remember: true,
  });
  return stampFeedKeys(ordered, cycle);
}
