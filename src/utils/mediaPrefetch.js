// mediaPrefetch.js
// Aggressive-but-safe warm path for feeds / profile / home rails.
// Videos go through videoCache (disk). Images use RN Image.prefetch (native disk).
// Idle work runs after interactions so first paint / scroll stay snappy.
// Respects For You audio flicker fix: never touches AV mute/play — disk only.

import { Image, InteractionManager } from 'react-native';
import { prefetchVideoToCache } from './videoCache';
import { fixStorageUrl } from './urlUtils';

const MAX_INFLIGHT = 3;
const seenImages = new Set();
const seenVideos = new Set();
let inflight = 0;
const queue = [];

function pump() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const job = queue.shift();
    inflight += 1;
    Promise.resolve()
      .then(job)
      .catch(() => {})
      .finally(() => {
        inflight -= 1;
        pump();
      });
  }
}

function enqueue(job) {
  queue.push(job);
  pump();
}

function normalizeUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const fixed = fixStorageUrl(uri) || uri;
  const trimmed = String(fixed).trim();
  return trimmed.length ? trimmed : null;
}

/** Warm native image disk cache (avatars, posters, thumbnails). Deduped. */
export function prefetchImageUri(uri, { idle = false } = {}) {
  const key = normalizeUri(uri);
  if (!key || seenImages.has(key)) return;
  if (!(key.startsWith('http://') || key.startsWith('https://'))) return;
  seenImages.add(key);

  const run = () => {
    enqueue(() => {
      try {
        return Promise.resolve(Image.prefetch(key)).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    });
  };

  if (idle) {
    InteractionManager.runAfterInteractions(run);
  } else {
    run();
  }
}

/** Warm video disk cache. Deduped. Prefer idle for neighbors beyond ±1. */
export function prefetchVideoUri(uri, { idle = false } = {}) {
  const key = normalizeUri(uri);
  if (!key || seenVideos.has(key)) return;
  if (!(key.startsWith('http://') || key.startsWith('https://') || key.startsWith('file:') || key.startsWith('content:'))) {
    return;
  }
  if (key.startsWith('file:') || key.startsWith('content:')) {
    seenVideos.add(key);
    return;
  }
  seenVideos.add(key);

  const run = () => {
    enqueue(() => prefetchVideoToCache(key).catch(() => {}));
  };

  if (idle) {
    InteractionManager.runAfterInteractions(run);
  } else {
    run();
  }
}

function postVideoUri(post) {
  if (!post) return null;
  const fromMedia = post.media?.find?.((m) => String(m?.type || '').includes('video'))?.url;
  return normalizeUri(post.videoUrl || fromMedia);
}

function postImageUris(post) {
  if (!post) return [];
  const out = [];
  const push = (u) => {
    const n = normalizeUri(u);
    if (n) out.push(n);
  };
  push(post.thumbnail);
  push(post.imageUrl);
  push(post.userPhotoURL);
  push(post.user?.avatar);
  push(post.user?.photoURL);
  if (Array.isArray(post.media)) {
    for (const m of post.media) {
      if (String(m?.type || '').includes('video')) {
        push(m.thumbnail);
      } else {
        push(m.url || m.uri || m.imageUrl);
        push(m.thumbnail);
      }
    }
  }
  return out;
}

/**
 * Prefetch a window of feed/profile posts around `centerIndex`.
 * near = current ±1 (immediate), far = rest of window (idle).
 * Does not mutate React state — disk warm only (avoids list re-render thrash).
 */
export function prefetchPostWindow(list, centerIndex, { radius = 2, images = true } = {}) {
  if (!Array.isArray(list) || !list.length) return;
  const center = Math.min(Math.max(0, centerIndex | 0), list.length - 1);

  for (let d = 0; d <= radius; d += 1) {
    const indices = d === 0 ? [center] : [center + d, center - d];
    for (const i of indices) {
      if (i < 0 || i >= list.length) continue;
      const post = list[i];
      const idle = Math.abs(i - center) > 1;
      const video = postVideoUri(post);
      if (video) prefetchVideoUri(video, { idle });
      if (images) {
        for (const img of postImageUris(post)) {
          prefetchImageUri(img, { idle });
        }
      }
    }
  }
}

/** Prefetch avatar/thumb URIs from an arbitrary list (home rails, chat rows). */
export function prefetchUriList(uris, { idle = true } = {}) {
  if (!Array.isArray(uris)) return;
  for (const u of uris) {
    prefetchImageUri(u, { idle });
  }
}

/** Run heavy non-critical work after first paint / interactions settle. */
export function runWhenIdle(fn) {
  try {
    InteractionManager.runAfterInteractions(() => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  } catch {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}
