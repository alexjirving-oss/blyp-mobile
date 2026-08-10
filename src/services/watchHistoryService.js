// watchHistoryService.js
//
// "Continue watching" history. Records a compact snapshot of each post the user
// opens, most-recent-first, in AsyncStorage (per uid) with a tiny pub/sub and
// best-effort Firestore mirror for cross-device continuity.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';

const KEY = (uid) => `@blyp/watch/${uid || 'anon'}`;
const MAX_ITEMS = 30;

const cache = new Map();
const listeners = new Map();

const canSync = (uid) => firebaseEnabled && !!db?.collection && !!uid && uid !== 'anon';

function emit(uid, list) {
  const set = listeners.get(uid);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(list);
    } catch {
      /* ignore */
    }
  }
}

function compact(post) {
  if (!post || !post.id) return null;
  // Prefer progressive MP4 fields so Home Continue watching can warm-disk the
  // same URI the rail / MediaViewer will play (never stash HLS-only).
  const progressive =
    post.playbackUrl ||
    post.cdnUrl ||
    post.compressedUrl ||
    post.optimizedUrl ||
    post.videoUrl ||
    post.mediaUrl ||
    null;
  return {
    id: post.id,
    title: post.title || post.captionTitle || post.caption || post.description || 'Post',
    thumbnail:
      post.thumbnail ||
      post.imageUrl ||
      post.media?.[0]?.thumbnail ||
      post.media?.[0]?.url ||
      null,
    videoUrl: progressive,
    playbackUrl: post.playbackUrl || null,
    cdnUrl: post.cdnUrl || null,
    compressedUrl: post.compressedUrl || null,
    type: post.type || (progressive ? 'video' : 'post'),
    username: post.username || post.userDisplayName || post.user?.username || null,
    userId: post.userId || post.uid || null,
    watchedAt: Date.now(),
  };
}

async function persist(uid, list) {
  cache.set(uid, list);
  emit(uid, list);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(list));
  } catch (e) {
    console.warn('[WATCH] save failed', e?.message || String(e));
  }
  if (canSync(uid)) {
    db.collection('users').doc(uid).set({ blyp: { watch: list } }, { merge: true }).catch(() => {});
  }
}

export async function getWatchHistory(uid) {
  if (cache.has(uid)) return cache.get(uid);
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    cache.set(uid, list);
    hydrateFromRemote(uid);
    return list;
  } catch {
    cache.set(uid, []);
    return [];
  }
}

async function hydrateFromRemote(uid) {
  if (!canSync(uid)) return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const remote = snap?.data?.()?.blyp?.watch;
    if (!Array.isArray(remote) || remote.length === 0) return;
    const local = cache.get(uid) || [];
    if (local.length === 0) {
      cache.set(uid, remote);
      emit(uid, remote);
      try {
        await AsyncStorage.setItem(KEY(uid), JSON.stringify(remote));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function subscribeWatchHistory(uid, cb) {
  if (!listeners.has(uid)) listeners.set(uid, new Set());
  listeners.get(uid).add(cb);
  getWatchHistory(uid).then((l) => {
    try {
      cb(l);
    } catch {
      /* ignore */
    }
  });
  return () => {
    const set = listeners.get(uid);
    if (set) set.delete(cb);
  };
}

/** Record (or bump to front) a watched post. */
export async function recordWatch(uid, post) {
  const item = compact(post);
  if (!item) return;
  const list = await getWatchHistory(uid);
  const next = [item, ...list.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
  await persist(uid, next);
}

export async function clearWatchHistory(uid) {
  await persist(uid, []);
}

export default { getWatchHistory, subscribeWatchHistory, recordWatch, clearWatchHistory };
