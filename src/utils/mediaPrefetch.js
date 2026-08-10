// mediaPrefetch.js
// Aggressive-but-safe warm path for feeds / profile / home rails.
// Videos go through videoCache (disk). Images use RN Image.prefetch (native disk).
// Separate image vs video queues so posters never starve first MP4 bytes (and
// heavy downloads never block avatar/poster first paint).
// Idle work runs after interactions so first paint / scroll stay snappy.
// Respects For You audio flicker fix: never touches AV mute/play — disk only.

import { Image, InteractionManager } from 'react-native';
import { prefetchVideoToCache } from './videoCache';
import { fixStorageUrl } from './urlUtils';
import { resolveFeedVideoUri } from './forYouFeedList';
import { isHlsVideoUri } from './feedVideoUri';

/** Image.prefetch is cheap — allow a few in parallel for poster-first paint. */
const MAX_INFLIGHT_IMG = 4;
/** Full MP4 disk warm is heavy (Flip/Fold memory) — keep tight. */
const MAX_INFLIGHT_VID = 2;
const seenImages = new Set();
const seenVideos = new Set();
/** In-flight / queued keys — failures stay retryable (unlike seenVideos). */
const pendingVideos = new Set();
let inflightImg = 0;
let inflightVid = 0;
const queueImg = [];
const queueVid = [];

function pumpImg() {
  while (inflightImg < MAX_INFLIGHT_IMG && queueImg.length) {
    const job = queueImg.shift();
    inflightImg += 1;
    Promise.resolve()
      .then(job)
      .catch(() => {})
      .finally(() => {
        inflightImg -= 1;
        pumpImg();
      });
  }
}

function pumpVid() {
  while (inflightVid < MAX_INFLIGHT_VID && queueVid.length) {
    const job = queueVid.shift();
    inflightVid += 1;
    Promise.resolve()
      .then(job)
      .catch(() => {})
      .finally(() => {
        inflightVid -= 1;
        pumpVid();
      });
  }
}

function enqueueImage(job) {
  queueImg.push(job);
  pumpImg();
}

/** Prefer next-ahead warm over behind; higher priority jobs jump the video queue. */
function enqueueVideo(job, { priority = false } = {}) {
  if (priority) queueVid.unshift(job);
  else queueVid.push(job);
  pumpVid();
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
    enqueueImage(() => {
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
    enqueueVideo(
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

/**
 * Home cold-start warm — poster-first, then progressive MP4s, never blocks UI.
 *
 * Phase 1 (same tick): enqueue posters/avatars on the image queue.
 * Phase 2 (same tick): kick first N For You + Continue watching MP4s on the
 *   video queue (parallel to posters; priority).
 * Phase 3 (after interactions): widen window + trending so first paint wins.
 */
export function warmHomeVideoRails({
  forYou = [],
  trending = [],
  watch = [],
  live = [],
  creators = [],
} = {}) {
  // Phase 1 — posters first so rail tiles paint with thumbs immediately.
  prefetchUriList(
    [
      ...(forYou || []).flatMap((p) => [
        p?.thumbnail,
        p?.imageUrl,
        p?.userPhotoURL,
        p?.user?.avatar,
        p?.user?.photoURL,
        ...(Array.isArray(p?.media) ? p.media.map((m) => m?.thumbnail || m?.url) : []),
      ]),
      ...(trending || []).flatMap((p) => [p?.thumbnail, p?.imageUrl]),
      ...(watch || []).map((w) => w?.thumbnail || w?.imageUrl),
      ...(live || []).map((l) => l?.thumbnail || l?.coverUrl || l?.photoURL),
      ...(creators || []).map((c) => c?.photoURL || c?.avatar),
    ],
    { idle: false },
  );

  // Phase 2 — first progressive MP4s ASAP (separate queue; UI already committed).
  const kickHotVideos = (list, limit) => {
    for (const p of (list || []).slice(0, limit)) {
      const v =
        postVideoUri(p) ||
        normalizeUri(p?.videoUrl) ||
        normalizeUri(p?.mediaUrl) ||
        null;
      if (v) prefetchVideoUri(v, { idle: false, priority: true });
    }
  };
  kickHotVideos(forYou, 3);
  kickHotVideos(watch, 4);

  // Phase 3 — wider disk warm after first interactions / paint settle.
  runWhenIdle(() => {
    if (Array.isArray(forYou) && forYou.length) {
      prefetchPostWindow(forYou, 0, { radius: 5, images: true });
    }
    kickHotVideos(trending, 6);
    for (const w of (watch || []).slice(0, 6)) {
      const thumb = normalizeUri(w?.thumbnail);
      if (thumb) prefetchImageUri(thumb, { idle: true });
    }
  });
}
