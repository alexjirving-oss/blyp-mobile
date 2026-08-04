// bookmarkService.js
//
// Lightweight "save for later" system. Stores a compact snapshot of each saved
// post in AsyncStorage (per uid) so the Saved screen works offline and instantly,
// with a tiny pub/sub so Save buttons stay in sync across screens.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';
import { purgePostId } from './collectionsService';

const KEY = (uid) => `@blyp/bookmarks/${uid || 'anon'}`;
const MAX_BOOKMARKS = 300;

const cache = new Map(); // uid -> array
const listeners = new Map(); // uid -> Set<fn>

const canSync = (uid) => firebaseEnabled && !!db?.collection && !!uid && uid !== 'anon';

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const b of list) {
    if (!b || !b.id || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, MAX_BOOKMARKS);
}

async function syncToRemote(uid, list) {
  if (!canSync(uid)) return;
  try {
    await db.collection('users').doc(uid).set({ blyp: { bookmarks: list } }, { merge: true });
  } catch (e) {
    console.warn('[BOOKMARKS] remote sync failed', e?.message || String(e));
  }
}

// Pull remote bookmarks once and union with local, then emit if anything changed.
async function hydrateFromRemote(uid) {
  if (!canSync(uid)) return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const remote = snap?.data?.()?.blyp?.bookmarks;
    if (!Array.isArray(remote) || remote.length === 0) return;
    const local = cache.get(uid) || [];
    const merged = dedupeById([...local, ...remote]);
    if (merged.length !== local.length) {
      cache.set(uid, merged);
      emit(uid, merged);
      try {
        await AsyncStorage.setItem(KEY(uid), JSON.stringify(merged));
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[BOOKMARKS] hydrate failed', e?.message || String(e));
  }
}

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

async function persist(uid, list) {
  cache.set(uid, list);
  emit(uid, list);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(list));
  } catch (e) {
    console.warn('[BOOKMARKS] save failed', e?.message || String(e));
  }
  syncToRemote(uid, list);
}

// Keep only the fields the Saved grid needs so storage stays small.
function compact(post) {
  if (!post || !post.id) return null;
  return {
    id: post.id,
    title: post.title || post.captionTitle || post.caption || post.description || 'Post',
    thumbnail:
      post.thumbnail ||
      post.imageUrl ||
      post.media?.[0]?.thumbnail ||
      post.media?.[0]?.url ||
      post.videoUrl ||
      post.mediaUrl ||
      null,
    videoUrl: post.videoUrl || null,
    type: post.type || (post.videoUrl ? 'video' : 'post'),
    username: post.username || post.userDisplayName || post.user?.username || null,
    savedAt: Date.now(),
  };
}

export async function getBookmarks(uid) {
  if (cache.has(uid)) return cache.get(uid);
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    const list = raw ? JSON.parse(raw) : [];
    const safe = Array.isArray(list) ? list : [];
    cache.set(uid, safe);
    hydrateFromRemote(uid); // fire-and-forget; subscribers get any remote adds
    return safe;
  } catch (e) {
    console.warn('[BOOKMARKS] load failed', e?.message || String(e));
    cache.set(uid, []);
    return [];
  }
}

export function subscribeBookmarks(uid, cb) {
  if (!listeners.has(uid)) listeners.set(uid, new Set());
  listeners.get(uid).add(cb);
  getBookmarks(uid).then((l) => {
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

export async function isBookmarked(uid, postId) {
  if (!postId) return false;
  const list = await getBookmarks(uid);
  return list.some((b) => b.id === postId);
}

/** Toggle a post's saved state. Returns the new boolean (true = now saved). */
export async function toggleBookmark(uid, post) {
  const item = compact(post);
  if (!item) return false;
  const list = await getBookmarks(uid);
  const exists = list.some((b) => b.id === item.id);
  const next = exists
    ? list.filter((b) => b.id !== item.id)
    : [item, ...list].slice(0, MAX_BOOKMARKS);
  await persist(uid, next);
  if (exists) purgePostId(uid, item.id);
  return !exists;
}

export async function removeBookmark(uid, postId) {
  const list = await getBookmarks(uid);
  await persist(uid, list.filter((b) => b.id !== postId));
  purgePostId(uid, postId);
}

export default {
  getBookmarks,
  subscribeBookmarks,
  isBookmarked,
  toggleBookmark,
  removeBookmark,
};
