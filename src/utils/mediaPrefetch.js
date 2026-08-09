// mediaPrefetch.js
// Aggressive-but-safe warm path for feeds / profile / home rails.
// Videos go through videoCache (disk). Images use RN Image.prefetch (native disk).
// Idle work runs after interactions so first paint / scroll stay snappy.
// Respects For You audio flicker fix: never touches AV mute/play — disk only.

import { Image, InteractionManager } from 'react-native';
import { prefetchVideoToCache } from './videoCache';
import { fixStorageUrl } from './urlUtils';
import { resolveFeedVideoUri } from './forYouFeedList';
import { isHlsVideoUri } from './feedVideoUri';

const MAX_INFLIGHT = 2; // Flip/Fold memory: never stampede downloads
const seenImages = new Set();
const seenVideos = new Set();
/** In-flight / queued keys — failures stay retryable (unlike seenVideos). */
const pendingVideos = new Set();
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

/** Prefer next-ahead warm over behind; higher priority jobs jump the queue. */
function enqueue(job, { priority = false } = {}) {
  if (priority) queue.unshift(job);
  else queue.push(job);
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

/** Warm video disk cache. Deduped on success; failures remain retryable. */
export function prefetchVideoUri(uri, { idle = false, priority = false } = {}) {
  const key = normalizeUri(uri);
  if (!key || seenVideos.has(key) || pendingVideos.has(key)) return;
  if (!(key.startsWith('http://') || key.startsWith('https://') || key.startsWith('file:') || key.startsWith('content:'))) {
    return;
  }
  if (key.startsWith('file:') || key.startsWith('content:')) {
    seenVideos.add(key);
    return;
  }
  // HLS cannot be warm-downloaded as a single file — skip (resolveFeedVideoUri prefers MP4).
  if (isHlsVideoUri(key)) {
    seenVideos.add(key);
    return;
  }

  pendingVideos.add(key);

  const run = () => {
    enqueue(
      () =>
        prefetchVideoToCache(key)
          .then((local) => {
            // Only permanent-dedupe real disk hits. Remote fallback stays retryable.
            if (
              local &&
              (String(local).startsWith('file:') || String(local).startsWith('content:'))
            ) {
              seenVideos.add(key);
            }
          })
          .catch(() => {})
          .finally(() => {
            pendingVideos.delete(key);
          }),
      { priority: !!priority && !idle },
    );
  };

  if (idle) {
    InteractionManager.runAfterInteractions(run);
  } else {
    run();
  }
}

function postVideoUri(post) {
  if (!post) return null;
  return normalizeUri(resolveFeedVideoUri(post));
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
 * near = current + next (immediate, priority), then previous, then far (idle).
 * Does not mutate React state — disk warm only (avoids list re-render thrash).
 */
export function prefetchPostWindow(list, centerIndex, { radius = 3, images = true } = {}) {
  if (!Array.isArray(list) || !list.length) return;
  const center = Math.min(Math.max(0, centerIndex | 0), list.length - 1);

  const order = [];
  // Current + ahead first (swipe direction), then behind.
  for (let d = 0; d <= radius; d += 1) {
    if (d === 0) order.push(center);
    else {
      order.push(center + d);
      order.push(center - d);
    }
  }

  for (const i of order) {
    if (i < 0 || i >= list.length) continue;
    const post = list[i];
    const dist = Math.abs(i - center);
    const idle = dist > 2; // keep next+2 snappy for fast paging
    const priority = i === center + 1 || i === center + 2; // ahead wins the queue
    const video = postVideoUri(post);
    if (video) prefetchVideoUri(video, { idle, priority });

    if (images) {
      for (const img of postImageUris(post)) {
        prefetchImageUri(img, { idle });
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
